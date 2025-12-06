import { useRef, useCallback, ReactNode, CSSProperties, useEffect } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import * as THREE from 'three';
import { createRoot, Root } from 'react-dom/client';
import originalHtml2canvas from 'html2canvas';

interface CaptureInfo {
    element: HTMLElement;
    width: number;
    height: number;
    scale: number;
    mesh?: Mesh;
}

// Maps canvas → source element + capture settings for live updates
const containerRegistry = new WeakMap<HTMLCanvasElement, CaptureInfo>();

// Drop-in html2canvas replacement that tracks source elements
export async function html2canvas(
    element: HTMLElement,
    options?: Parameters<typeof originalHtml2canvas>[1]
): Promise<HTMLCanvasElement> {
    const canvas = await originalHtml2canvas(element, options);

    containerRegistry.set(canvas, {
        element,
        width: options?.width || element.offsetWidth,
        height: options?.height || element.offsetHeight,
        scale: options?.scale || 1,
    });

    return canvas;
}

// Links a mesh to its source element via the texture's canvas
function associateMeshWithCanvas(mesh: Mesh): CaptureInfo | undefined {
    const material = mesh.material as MeshBasicMaterial | MeshStandardMaterial;
    if (!material?.map?.source?.data) return undefined;

    const canvas = material.map.source.data;
    if (!(canvas instanceof HTMLCanvasElement)) return undefined;

    const info = containerRegistry.get(canvas);
    if (info) {
        info.mesh = mesh;
    }
    return info;
}

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

let contextMenuRoot: Root | null = null;
let contextMenuContainer: HTMLDivElement | null = null;

function ensureContextMenuContainer() {
    if (!contextMenuContainer) {
        contextMenuContainer = document.createElement('div');
        contextMenuContainer.id = 'inspectable-r3f-context-menu';
        document.body.appendChild(contextMenuContainer);
        contextMenuRoot = createRoot(contextMenuContainer);
    }
    return contextMenuRoot!;
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

const contextMenuStyle: CSSProperties = {
    position: 'fixed',
    backgroundColor: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '160px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    zIndex: 10000,
};

const contextMenuItemStyle: CSSProperties = {
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
};

interface ModalState {
    captureInfo: CaptureInfo;
    onClose: () => void;
}

interface ContextMenuState {
    x: number;
    y: number;
    onInspect: () => void;
    onClose: () => void;
}

function ContextMenuContent({ state }: { state: ContextMenuState }) {
    useEffect(() => {
        const handleClickOutside = () => state.onClose();
        const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') state.onClose(); };

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [state]);

    return (
        <div
            style={{ ...contextMenuStyle, left: state.x, top: state.y }}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                style={contextMenuItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a2a')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => { state.onInspect(); state.onClose(); }}
            >
                Inspect Texture
            </div>
        </div>
    );
}

function showContextMenu(state: ContextMenuState) {
    ensureContextMenuContainer().render(<ContextMenuContent state={state} />);
}

function hideContextMenu() {
    if (contextMenuRoot) contextMenuRoot.render(null);
}

function ModalContent({ state }: { state: ModalState }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const originalStyleRef = useRef<{ position: string; left: string } | null>(null);
    const { captureInfo } = state;

    useEffect(() => {
        const container = captureInfo.element;
        if (!contentRef.current) return;

        originalStyleRef.current = {
            position: container.style.position,
            left: container.style.left,
        };

        container.style.position = 'static';
        container.style.left = '0';
        contentRef.current.appendChild(container);

        const updateTexture = async () => {
            if (!captureInfo.mesh) return;

            try {
                const canvas = await originalHtml2canvas(container, {
                    width: captureInfo.width,
                    height: captureInfo.height,
                    scale: captureInfo.scale,
                    logging: false,
                });

                const texture = new THREE.CanvasTexture(canvas);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.needsUpdate = true;

                const material = captureInfo.mesh.material as MeshBasicMaterial | MeshStandardMaterial;
                if (material) {
                    material.map = texture;
                    material.needsUpdate = true;
                }
            } catch (e) {
                console.error('Live texture update failed:', e);
            }
        };

        // Watch for DOM changes and re-capture texture
        const observer = new MutationObserver(updateTexture);
        observer.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true
        });

        return () => {
            observer.disconnect();

            container.style.position = originalStyleRef.current?.position || 'absolute';
            container.style.left = originalStyleRef.current?.left || '-9999px';
            document.body.appendChild(container);
        };
    }, [captureInfo]);

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

export interface InspectableProps {
    children: ReactNode;
}

/**
 * Makes any R3F mesh inspectable. Just wrap your mesh and HTML content.
 */
export function Inspectable({ children }: InspectableProps) {
    const groupRef = useRef<Group>(null);

    const handleContextMenu = useCallback((event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();

        const mesh = event.object as Mesh;
        if (!mesh) return;

        let captureInfo: CaptureInfo | undefined;

        captureInfo = associateMeshWithCanvas(mesh);

        // Fallback: check userData for manually set container
        if (!captureInfo && mesh.userData?.inspectableContainer) {
            captureInfo = {
                element: mesh.userData.inspectableContainer,
                width: mesh.userData.inspectableContainer.offsetWidth || 200,
                height: mesh.userData.inspectableContainer.offsetHeight || 200,
                scale: 2,
                mesh,
            };
        }

        if (!captureInfo) return;

        captureInfo.mesh = mesh;

        const nativeEvent = event.nativeEvent;
        showContextMenu({
            x: nativeEvent.clientX,
            y: nativeEvent.clientY,
            onInspect: () => {
                showModal({
                    captureInfo,
                    onClose: hideModal,
                });
            },
            onClose: hideContextMenu,
        });
    }, []);

    return (
        <group ref={groupRef} onContextMenu={handleContextMenu}>
            {children}
        </group>
    );
}
