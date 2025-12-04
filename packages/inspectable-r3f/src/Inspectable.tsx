import { useState, useEffect, useRef, useCallback, ReactNode, CSSProperties, Children, isValidElement } from 'react';
import { ThreeEvent, useThree } from '@react-three/fiber';
import { Group } from 'three';
import * as THREE from 'three';
import html2canvas from 'html2canvas';
import { createRoot, Root } from 'react-dom/client';

export interface InspectableProps {
    children: ReactNode;
}

// R3F element types
const R3F_ELEMENTS = new Set([
    'mesh', 'group', 'object3D', 'primitive',
    'line', 'lineSegments', 'lineLoop', 'points',
    'sprite', 'instancedMesh', 'skinnedMesh',
    'bone', 'skeleton', 'lod',
    'ambientLight', 'directionalLight', 'pointLight', 'spotLight', 'hemisphereLight', 'rectAreaLight',
    'perspectiveCamera', 'orthographicCamera',
    'planeGeometry', 'boxGeometry', 'sphereGeometry', 'cylinderGeometry', 'coneGeometry', 'torusGeometry',
    'meshBasicMaterial', 'meshStandardMaterial', 'meshPhongMaterial', 'meshLambertMaterial',
    'meshNormalMaterial', 'meshDepthMaterial', 'meshToonMaterial', 'meshPhysicalMaterial',
    'lineBasicMaterial', 'lineDashedMaterial', 'pointsMaterial', 'spriteMaterial', 'shaderMaterial',
]);

// Global modal state
let modalRoot: Root | null = null;
let modalContainer: HTMLDivElement | null = null;

function ensureModalContainer() {
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'inspectable-r3f-modal';
        document.body.appendChild(modalContainer);
        modalRoot = createRoot(modalContainer);
    }
    return modalRoot!;
}

const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
};

const modalStyle: CSSProperties = {
    backgroundColor: '#111',
    borderRadius: '8px',
    padding: '16px',
    position: 'relative',
    border: '1px solid #333',
};

const headerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid #333',
};

interface ModalState {
    container: HTMLDivElement;
    onTextureUpdate: (texture: THREE.CanvasTexture) => void;
    onClose: () => void;
}

function ModalContent({ state }: { state: ModalState }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const originalParentRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const container = state.container;
        if (!contentRef.current) return;

        originalParentRef.current = container.parentElement;
        container.style.position = 'static';
        container.style.left = '0';
        contentRef.current.appendChild(container);

        return () => {
            if (originalParentRef.current) {
                container.style.position = 'absolute';
                container.style.left = '-9999px';
                originalParentRef.current.appendChild(container);
            }
        };
    }, [state.container]);

    useEffect(() => {
        const container = state.container;
        const width = container.offsetWidth;
        const height = container.offsetHeight;

        const recapture = async () => {
            try {
                const canvas = await html2canvas(container, { width, height, scale: 2, logging: false });
                const texture = new THREE.CanvasTexture(canvas);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.needsUpdate = true;
                state.onTextureUpdate(texture);
            } catch (e) {
                console.error('Recapture failed:', e);
            }
        };

        const observer = new MutationObserver(recapture);
        observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
        return () => observer.disconnect();
    }, [state]);

    return (
        <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && state.onClose()}>
            <div style={modalStyle}>
                <div style={headerStyle}>
                    <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>Inspect with DevTools (F12)</p>
                    <button onClick={state.onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '18px', cursor: 'pointer' }}>✕</button>
                </div>
                <div ref={contentRef} />
            </div>
        </div>
    );
}

function showModal(state: ModalState) {
    ensureModalContainer().render(<ModalContent state={state} />);
}

function hideModal() {
    if (modalRoot) modalRoot.render(null);
}

/**
 * Makes any R3F mesh inspectable. Just wrap your mesh and HTML content.
 */
export function Inspectable({ children }: InspectableProps) {
    const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const groupRef = useRef<Group>(null);
    const initialized = useRef(false);
    const { gl } = useThree();

    // Separate R3F children from HTML children
    const r3fChildren: ReactNode[] = [];
    const htmlChildren: ReactNode[] = [];

    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            const type = child.type;
            if (typeof type === 'string' && !R3F_ELEMENTS.has(type)) {
                htmlChildren.push(child);
            } else if (typeof type === 'string' && R3F_ELEMENTS.has(type)) {
                r3fChildren.push(child);
            } else {
                const name = typeof type === 'function' ? type.name : '';
                if (name && name[0] === name[0].toUpperCase()) {
                    htmlChildren.push(child);
                } else {
                    r3fChildren.push(child);
                }
            }
        }
    });

    useEffect(() => {
        if (initialized.current || htmlChildren.length === 0) return;
        initialized.current = true;

        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        document.body.appendChild(container);
        containerRef.current = container;

        const root = createRoot(container);
        root.render(<>{htmlChildren}</>);

        setTimeout(async () => {
            try {
                const width = container.offsetWidth || 300;
                const height = container.offsetHeight || 200;
                const canvas = await html2canvas(container, { width, height, scale: 2, logging: false });
                const tex = new THREE.CanvasTexture(canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.needsUpdate = true;
                setTexture(tex);
            } catch (e) {
                console.error('Initial capture failed:', e);
            }
        }, 100);
    }, []);

    const updateMeshTexture = useCallback((newTexture: THREE.CanvasTexture) => {
        setTexture(newTexture);
        if (groupRef.current) {
            groupRef.current.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    const mat = child.material as THREE.MeshBasicMaterial;
                    mat.map = newTexture;
                    mat.needsUpdate = true;
                }
            });
        }
    }, []);

    const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (containerRef.current) {
            showModal({
                container: containerRef.current,
                onTextureUpdate: updateMeshTexture,
                onClose: hideModal,
            });
        }
    }, [updateMeshTexture]);

    const handlePointerOver = useCallback(() => { gl.domElement.style.cursor = 'pointer'; }, [gl]);
    const handlePointerOut = useCallback(() => { gl.domElement.style.cursor = 'auto'; }, [gl]);

    useEffect(() => {
        if (!texture || !groupRef.current) return;
        groupRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
                const mat = child.material as THREE.MeshBasicMaterial;
                mat.map = texture;
                mat.needsUpdate = true;
            }
        });
    }, [texture]);

    if (htmlChildren.length === 0) {
        return (
            <group ref={groupRef} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
                {r3fChildren}
            </group>
        );
    }

    if (!texture) return null;

    return (
        <group ref={groupRef} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
            {r3fChildren}
        </group>
    );
}
