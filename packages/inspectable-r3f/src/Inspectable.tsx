import { useState, useEffect, useRef, useCallback, ReactNode, CSSProperties, Children, isValidElement } from 'react';
import { ThreeEvent, useThree } from '@react-three/fiber';
import { Group } from 'three';
import * as THREE from 'three';
import html2canvas from 'html2canvas';
import { createRoot, Root } from 'react-dom/client';

export interface InspectableProps {
    children: ReactNode;
}

// Standard HTML tags to detect 2D content
const HTML_TAGS = new Set([
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'button', 'input', 'form', 'label', 'ul', 'li', 'ol',
    'table', 'tr', 'td', 'th', 'thead', 'tbody', 'section', 'article',
    'header', 'footer', 'nav', 'aside', 'main', 'canvas', 'video', 'audio',
    'iframe', 'a', 'strong', 'em', 'b', 'i', 'small', 'code', 'pre'
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

// Context menu state
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
    container: HTMLDivElement;
    onTextureUpdate: (texture: THREE.CanvasTexture) => void;
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
    useThree();

    // Separate R3F children from HTML children
    const r3fChildren: ReactNode[] = [];
    const htmlChildren: ReactNode[] = [];

    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            const type = child.type;
            if (typeof type === 'string' && HTML_TAGS.has(type)) {
                htmlChildren.push(child);
            } else {
                r3fChildren.push(child);
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

    const openInspector = useCallback(() => {
        if (containerRef.current) {
            showModal({
                container: containerRef.current,
                onTextureUpdate: updateMeshTexture,
                onClose: hideModal,
            });
        }
    }, [updateMeshTexture]);

    const handleContextMenu = useCallback((event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const nativeEvent = event.nativeEvent;
        showContextMenu({
            x: nativeEvent.clientX,
            y: nativeEvent.clientY,
            onInspect: openInspector,
            onClose: hideContextMenu,
        });
    }, [openInspector]);

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
            <group ref={groupRef} onContextMenu={handleContextMenu}>
                {r3fChildren}
            </group>
        );
    }

    if (!texture) return null;

    return (
        <group ref={groupRef} onContextMenu={handleContextMenu}>
            {r3fChildren}
        </group>
    );
}
