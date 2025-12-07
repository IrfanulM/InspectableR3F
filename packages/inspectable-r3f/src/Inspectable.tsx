import { useRef, useCallback, useEffect, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import * as THREE from 'three';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import originalHtml2canvas from 'html2canvas';

interface CaptureInfo {
    element: HTMLElement;
    width: number;
    height: number;
    scale: number;
    mesh?: Mesh;
    backdrop?: string;
    isRawSource?: boolean;
    wasConnected?: boolean;
    textureSourceCanvas?: HTMLCanvasElement;
    ghostContainer?: HTMLElement;
}

// Global registry mapping canvas elements back to their source DOM nodes and capture settings
const containerRegistry = new WeakMap<HTMLCanvasElement | Texture, CaptureInfo>();

declare global {
    interface HTMLCanvasElement {
        __inspectable_ghost?: HTMLElement;
        __inspectable_matrix?: DOMMatrix;
        __inspectable_stack?: Array<{
            matrix: DOMMatrix;
            font: string;
            textAlign: CanvasTextAlign;
            textBaseline: CanvasTextBaseline;
        }>;
    }
    interface Window {
        __r3f_inspectable_patched?: boolean;
    }
}

function projectPoint(matrix: DOMMatrix, x: number, y: number) {
    const point = new DOMPoint(x, y);
    return point.matrixTransform(matrix);
}

// Lazily create a ghost DOM container for a canvas to hold mirrored elements
function ensureGhost(canvas: HTMLCanvasElement): HTMLElement {
    if (!canvas.__inspectable_ghost) {
        const ghost = document.createElement('div');
        ghost.style.position = 'absolute';
        ghost.style.top = '0';
        ghost.style.left = '0';
        ghost.style.width = '100%';
        ghost.style.height = '100%';
        ghost.style.pointerEvents = 'none';
        ghost.style.overflow = 'hidden';
        canvas.__inspectable_ghost = ghost;

        canvas.__inspectable_matrix = new DOMMatrix();
        canvas.__inspectable_stack = [];
    }
    return canvas.__inspectable_ghost;
}

// Patch Canvas 2D to build a ghost DOM that mirrors canvas content for text selection and DevTools inspection
if (typeof window !== 'undefined' && !window.__r3f_inspectable_patched) {
    window.__r3f_inspectable_patched = true;

    const ctxProto = CanvasRenderingContext2D.prototype;

    // Track transform state to position ghost elements correctly
    const originalSave = ctxProto.save;
    ctxProto.save = function () {
        const canvas = this.canvas;
        if (canvas.__inspectable_matrix && canvas.__inspectable_stack) {
            canvas.__inspectable_stack.push({
                matrix: DOMMatrix.fromMatrix(canvas.__inspectable_matrix),
                font: this.font,
                textAlign: this.textAlign,
                textBaseline: this.textBaseline
            });
        }
        return originalSave.apply(this, arguments as any);
    };

    const originalRestore = ctxProto.restore;
    ctxProto.restore = function () {
        const canvas = this.canvas;
        if (canvas.__inspectable_stack && canvas.__inspectable_stack.length > 0) {
            const state = canvas.__inspectable_stack.pop()!;
            canvas.__inspectable_matrix = state.matrix;
        }
        return originalRestore.apply(this, arguments as any);
    };

    // Mirror transform methods to keep ghost positioning in sync
    const originalTranslate = ctxProto.translate;
    ctxProto.translate = function (x, y) {
        ensureGhost(this.canvas);
        this.canvas.__inspectable_matrix!.translateSelf(x, y);
        return originalTranslate.apply(this, arguments as any);
    };

    const originalRotate = ctxProto.rotate;
    ctxProto.rotate = function (angle) {
        ensureGhost(this.canvas);
        this.canvas.__inspectable_matrix!.rotateSelf(angle * (180 / Math.PI));
        return originalRotate.apply(this, arguments as any);
    };

    const originalScale = ctxProto.scale;
    ctxProto.scale = function (x, y) {
        ensureGhost(this.canvas);
        this.canvas.__inspectable_matrix!.scaleSelf(x, y);
        return originalScale.apply(this, arguments as any);
    };

    const originalTransform = ctxProto.transform;
    ctxProto.transform = function (a, b, c, d, e, f) {
        ensureGhost(this.canvas);
        const m = new DOMMatrix();
        m.a = a; m.b = b; m.c = c; m.d = d; m.e = e; m.f = f;
        this.canvas.__inspectable_matrix!.multiplySelf(m);
        return originalTransform.apply(this, arguments as any);
    };

    const originalSetTransform = ctxProto.setTransform;
    ctxProto.setTransform = function (a?: any, b?: any, c?: any, d?: any, e?: any, f?: any) {
        ensureGhost(this.canvas);
        if (arguments.length === 0) {
            this.canvas.__inspectable_matrix = new DOMMatrix();
        } else if (arguments.length === 1 && typeof a === 'object') {
            try {
                this.canvas.__inspectable_matrix = DOMMatrix.fromMatrix(a);
            } catch (e) {
                this.canvas.__inspectable_matrix = new DOMMatrix();
            }
        } else {
            const m = new DOMMatrix();
            m.a = a as number; m.b = b as number; m.c = c as number;
            m.d = d as number; m.e = e as number; m.f = f as number;
            this.canvas.__inspectable_matrix = m;
        }
        return originalSetTransform.apply(this, arguments as any);
    };

    // Reset ghost DOM when canvas is cleared
    const originalClearRect = ctxProto.clearRect;
    ctxProto.clearRect = function (x, y, w, h) {
        const ghost = ensureGhost(this.canvas);
        if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) {
            ghost.innerHTML = '';
        }
        return originalClearRect.apply(this, arguments as any);
    };

    // Position an element in the ghost DOM at the current transform
    const recordElement = (
        ctx: CanvasRenderingContext2D,
        el: HTMLElement,
        x: number,
        y: number,
        isInteractive: boolean,
        zIndex: number = 0,
        opacity: string = '0'
    ) => {
        const ghost = ensureGhost(ctx.canvas);
        const matrix = ctx.canvas.__inspectable_matrix!;
        const p = projectPoint(matrix, x, y);

        el.style.position = 'absolute';
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.pointerEvents = isInteractive ? 'auto' : 'none';
        el.style.zIndex = zIndex.toString();
        el.style.transformOrigin = '0 0';
        el.style.opacity = opacity;

        el.setAttribute('draggable', 'false');
        el.ondragstart = (e) => e.preventDefault();

        el.style.userSelect = el.getAttribute('data-inspectable-type')?.includes('text') ? 'text' : 'none';

        const m = matrix;
        el.style.transform = `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, 0, 0)`;

        ghost.appendChild(el);
    };

    // Create selectable text overlays
    const originalFillText = ctxProto.fillText;
    ctxProto.fillText = function (text, x, y, _maxWidth) {
        const metrics = this.measureText(text);

        const width = metrics.width;
        const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
        const height = ascent + descent;

        const el = document.createElement('div');
        el.textContent = text;

        el.style.font = this.font;
        el.style.whiteSpace = 'pre';
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        el.style.lineHeight = 'normal';

        el.setAttribute('data-inspectable-type', 'text');
        el.style.color = 'transparent';
        el.style.cursor = 'text';

        let xOff = 0;
        let yOff = 0;

        if (this.textAlign === 'center') xOff = -width / 2;
        if (this.textAlign === 'right') xOff = -width;

        yOff = -ascent;

        recordElement(this, el, x, y, true, 1, '1');

        const existingTransform = el.style.transform;
        el.style.transform = `${existingTransform} translate(${xOff}px, ${yOff}px)`;

        return originalFillText.apply(this, arguments as any);
    };

    const originalStrokeText = ctxProto.strokeText;
    ctxProto.strokeText = function (text, x, y, _maxWidth) {
        const metrics = this.measureText(text);
        const width = metrics.width;
        const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
        const height = ascent + descent;

        const el = document.createElement('div');
        el.textContent = text;
        el.style.font = this.font;
        el.style.whiteSpace = 'pre';
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        el.style.lineHeight = 'normal';

        el.setAttribute('data-inspectable-type', 'text-stroke');
        el.style.color = 'transparent';
        el.style.cursor = 'text';

        let xOff = 0;
        let yOff = 0;

        if (this.textAlign === 'center') xOff = -width / 2;
        if (this.textAlign === 'right') xOff = -width;
        yOff = -ascent;

        recordElement(this, el, x, y, true, 1, '1');

        const existingTransform = el.style.transform;
        el.style.transform = `${existingTransform} translate(${xOff}px, ${yOff}px)`;

        return originalStrokeText.apply(this, arguments as any);
    };

    const originalFillRect = ctxProto.fillRect;
    ctxProto.fillRect = function (x, y, w, h) {
        // Detect full canvas clear via fillRect and reset ghost DOM
        if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) {
            const ghost = ensureGhost(this.canvas);
            ghost.innerHTML = '';
        }

        const el = document.createElement('div');
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.setAttribute('data-inspectable-type', 'rect-fill');
        recordElement(this, el, x, y, false, 0, '0');
        return originalFillRect.apply(this, arguments as any);
    };

    const originalStrokeRect = ctxProto.strokeRect;
    ctxProto.strokeRect = function (x, y, w, h) {
        const el = document.createElement('div');
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.setAttribute('data-inspectable-type', 'rect-stroke');
        recordElement(this, el, x, y, false, 0, '0');
        return originalStrokeRect.apply(this, arguments as any);
    };

    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;

    // Patch drawImage to propagate tracking info when a tracked canvas is drawn onto another (composition)
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: any[]) {
        try {
            const image = args[0];
            const el = document.createElement('div');
            let dx = 0, dy = 0, dw = 0, dh = 0;

            if (args.length === 3) { dx = args[1]; dy = args[2]; dw = image.width; dh = image.height; }
            else if (args.length === 5) { dx = args[1]; dy = args[2]; dw = args[3]; dh = args[4]; }
            else if (args.length === 9) { dx = args[5]; dy = args[6]; dw = args[7]; dh = args[8]; }

            el.style.width = `${dw}px`;
            el.style.height = `${dh}px`;
            el.setAttribute('data-inspectable-type', 'image');

            const canvasArea = this.canvas.width * this.canvas.height;
            const imgArea = dw * dh;
            const isOverlay = imgArea > (canvasArea * 0.85);

            if (image instanceof HTMLImageElement) {
                const clone = image.cloneNode() as HTMLImageElement;
                clone.style.width = '100%';
                clone.style.height = '100%';
                clone.style.opacity = '0';
                el.appendChild(clone);
            } else {
                const placeholder = document.createElement('div');
                placeholder.style.width = '100%';
                placeholder.style.height = '100%';
                el.appendChild(placeholder);
            }

            // Container opacity 1 for hit test, inner content remains invisible
            recordElement(this, el, dx, dy, !isOverlay, 0, '1');
        } catch (e) { }

        const imageSource = args[0];

        const isTrackingSource = imageSource instanceof HTMLCanvasElement && containerRegistry.has(imageSource);
        const isNewDestination = this.canvas instanceof HTMLCanvasElement && !containerRegistry.has(this.canvas);

        // If drawing onto a new canvas, snapshot its existing content (e.g., background layers) so the inspector can render the full composite view later.
        if (isTrackingSource && isNewDestination) {
            try {
                const currentBackdrop = this.canvas.toDataURL();
                const sourceInfo = containerRegistry.get(imageSource as HTMLCanvasElement);
                if (sourceInfo) {
                    containerRegistry.set(this.canvas, {
                        ...sourceInfo,
                        backdrop: currentBackdrop
                    });
                }
            } catch (e) {
                // Ignore tainted canvases
            }
        }

        return originalDrawImage.apply(this, args as any);
    } as any;
}

// Drop-in wrapper for html2canvas that automatically registers the result
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

// Heuristic to find which DOM element generated the texture on a clicked mesh
function associateMeshWithCanvas(mesh: Mesh, event?: ThreeEvent<MouseEvent>): CaptureInfo | undefined {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    let searchMaterials = materials;

    // Filter to the specific material index clicked if available
    if (event?.face?.materialIndex !== undefined && materials[event.face.materialIndex]) {
        searchMaterials = [materials[event.face.materialIndex]];
    }

    // Pass 1: Check for explicit overrides or tracked registry items
    for (const mat of searchMaterials) {
        const material = mat as MeshStandardMaterial;

        // Priority: Manual override via userData (for complex/composite materials)
        if (material.userData?.inspectableContainer) {
            return {
                element: material.userData.inspectableContainer,
                width: material.userData.inspectableContainer.offsetWidth || 512,
                height: material.userData.inspectableContainer.offsetHeight || 683,
                scale: 2,
                mesh: mesh
            };
        }

        // Standard: check if the material's texture source is in our registry
        if (!material?.map?.source?.data) continue;
        const canvas = material.map.source.data;

        if (canvas instanceof HTMLCanvasElement) {
            const info = containerRegistry.get(canvas);
            if (info) {
                info.mesh = mesh;
                return info;
            }

            if (canvas.__inspectable_ghost) {
                return {
                    element: canvas.__inspectable_ghost,
                    width: canvas.width,
                    height: canvas.height,
                    scale: 1,
                    textureSourceCanvas: canvas,
                    ghostContainer: canvas.__inspectable_ghost
                };
            }
        }
    }

    // Pass 2: Fallback for generic textures not in registry
    for (const mat of searchMaterials) {
        const material = mat as MeshStandardMaterial;
        if (!material?.map?.source?.data) continue;
        const canvas = material.map.source.data;

        if (canvas instanceof HTMLElement) {
            return {
                element: canvas,
                width: (canvas as any).width || (canvas as any).videoWidth || 0,
                height: (canvas as any).height || (canvas as any).videoHeight || 0,
                scale: 1,
                mesh: mesh,
                isRawSource: true,
                wasConnected: canvas.isConnected
            };
        }
    }

    return undefined;
}

// Singleton roots for UI portals to prevent re-creation overhead
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
    maxHeight: '90vh',
    overflow: 'hidden'
};

const headerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid #333',
    gap: '20px'
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
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const handleSnapshot = () => {
        const el = captureInfo.element;
        let url = '';

        try {
            if (el instanceof HTMLCanvasElement) {
                url = el.toDataURL('image/png');
            } else if (el instanceof HTMLImageElement) {
                const canvas = document.createElement('canvas');
                canvas.width = el.naturalWidth;
                canvas.height = el.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(el, 0, 0);
                url = canvas.toDataURL('image/png');
            } else if (el instanceof HTMLVideoElement) {
                const canvas = document.createElement('canvas');
                canvas.width = el.videoWidth;
                canvas.height = el.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(el, 0, 0);
                url = canvas.toDataURL('image/png');
            } else if (captureInfo.textureSourceCanvas) {
                url = captureInfo.textureSourceCanvas.toDataURL('image/png');
            }

            if (url) {
                const link = document.createElement('a');
                link.download = `texture-snapshot-${Date.now()}.png`;
                link.href = url;
                link.click();
            }
        } catch (e) {
            console.error('Snapshot failed:', e);
        }
    };

    useEffect(() => {
        const container = captureInfo.ghostContainer || captureInfo.element;
        if (!contentRef.current) return;

        // Restore composite background if one was captured during drawImage
        if (captureInfo.backdrop) {
            contentRef.current.style.backgroundImage = `url(${captureInfo.backdrop})`;
            contentRef.current.style.backgroundSize = '100% 100%';
            contentRef.current.style.backgroundRepeat = 'no-repeat';
        }

        // Store original position to restore later
        originalStyleRef.current = {
            position: container.style.position,
            left: container.style.left,
        };

        if (captureInfo.textureSourceCanvas) {
            const canvasBg = document.createElement('canvas');
            canvasBg.width = captureInfo.textureSourceCanvas.width;
            canvasBg.height = captureInfo.textureSourceCanvas.height;
            const ctx = canvasBg.getContext('2d');
            if (ctx) ctx.drawImage(captureInfo.textureSourceCanvas, 0, 0);

            canvasBg.style.position = 'absolute';
            canvasBg.style.top = '0';
            canvasBg.style.left = '0';
            canvasBg.style.zIndex = '0';
            canvasBg.style.pointerEvents = 'none';
            contentRef.current.appendChild(canvasBg);

            // Set explicit dimensions on container so absolute children are visible
            contentRef.current.style.width = `${captureInfo.textureSourceCanvas.width}px`;
            contentRef.current.style.height = `${captureInfo.textureSourceCanvas.height}px`;

            container.style.zIndex = '1';
        }

        // Physically move the DOM node into the modal for interaction
        container.style.position = 'relative';
        container.style.left = '0';
        container.style.transform = 'none';
        contentRef.current.appendChild(container);

        // Update dimensions state
        let contentWidth = captureInfo.width;
        let contentHeight = captureInfo.height;

        if (container instanceof HTMLVideoElement) {
            contentWidth = container.videoWidth;
            contentHeight = container.videoHeight;
            container.controls = true; // Enable controls for debugging
        } else if (container instanceof HTMLImageElement) {
            contentWidth = container.naturalWidth;
            contentHeight = container.naturalHeight;
        }

        setDimensions({ width: contentWidth, height: contentHeight });

        const maxWidth = Math.min(window.innerWidth * 0.9, 1200);
        const maxHeight = window.innerHeight * 0.8;

        if (contentWidth > maxWidth || contentHeight > maxHeight) {
            const scale = Math.min(maxWidth / contentWidth, maxHeight / contentHeight);
            contentRef.current.style.transform = `scale(${scale})`;
            contentRef.current.style.transformOrigin = 'top left';
            contentRef.current.style.width = `${contentWidth}px`;
            contentRef.current.style.height = `${contentHeight}px`;

            if (contentRef.current.parentElement) {
                contentRef.current.parentElement.style.width = `${contentWidth * scale + 32}px`;
                contentRef.current.parentElement.style.height = `${contentHeight * scale + 100}px`;
            }
        }

        // Live Sync: Monitor DOM changes in the modal and update the 3D texture
        if (!captureInfo.isRawSource && captureInfo.mesh && !captureInfo.textureSourceCanvas) {
            const updateTexture = async () => {
                if (!captureInfo.mesh) return;

                try {
                    const canvas = await originalHtml2canvas(container, {
                        width: captureInfo.width,
                        height: captureInfo.height,
                        scale: captureInfo.scale,
                        logging: false,
                        backgroundColor: null,
                    });

                    const texture = new THREE.CanvasTexture(canvas);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.needsUpdate = true;

                    // Find and update the correct material slot
                    const materials = Array.isArray(captureInfo.mesh.material)
                        ? captureInfo.mesh.material
                        : [captureInfo.mesh.material];

                    const targetMaterial = materials.find(m => {
                        const mat = m as MeshStandardMaterial;
                        return mat.map;
                    }) as MeshStandardMaterial | undefined;

                    if (targetMaterial) {
                        targetMaterial.map = texture;
                        targetMaterial.needsUpdate = true;
                    }
                } catch (e) {
                    console.error('Live texture update failed:', e);
                }
            };

            const observer = new MutationObserver(updateTexture);
            observer.observe(container, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true
            });

            // Cleanup: Return the DOM node to its original location
            return () => {
                observer.disconnect();
                restoreElement();
            };
        } else {
            // Simple cleanup for raw sources
            return () => {
                restoreElement();
            }
        }

        function restoreElement() {
            if (container instanceof HTMLVideoElement) {
                container.controls = false;
            }

            if (captureInfo.wasConnected) {
                container.style.position = originalStyleRef.current?.position || 'absolute';
                container.style.left = originalStyleRef.current?.left || '-9999px';
                document.body.appendChild(container);
            } else if (container.parentNode === contentRef.current) {
                container.remove();
            }
        }
    }, [captureInfo]);

    return (
        <div
            style={overlayStyle}
            onClick={(e) => e.target === e.currentTarget && state.onClose()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            <div style={modalStyle}>
                <div style={headerStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>
                            {captureInfo.isRawSource ? 'Texture Source' : 'Inspect (F12)'}
                        </p>
                        <p style={{ color: '#555', fontSize: '10px', margin: 0, fontFamily: 'monospace' }}>
                            {dimensions.width} x {dimensions.height}
                        </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                            onClick={handleSnapshot}
                            style={{ background: '#333', border: 'none', color: '#ccc', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                            title="Save Snapshot"
                        >
                            Snapshot
                        </button>
                        <button onClick={state.onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '18px', cursor: 'pointer' }}>✕</button>
                    </div>
                </div>
                <div ref={contentRef} style={{ display: 'flex', justifyContent: 'center', position: 'relative' }} />
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
 * Wraps R3F meshes to enable "Inspect Element" functionality on textures
 * generated from HTML via the exported html2canvas wrapper.
 */
export function Inspectable({ children }: InspectableProps) {
    const groupRef = useRef<Group>(null);

    const handleContextMenu = useCallback((event: ThreeEvent<MouseEvent>) => {
        // Prevent R3F event propagation and the browser's native context menu
        event.stopPropagation();
        event.nativeEvent.preventDefault();

        const mesh = event.object as Mesh;
        if (!mesh) return;

        let captureInfo: CaptureInfo | undefined;

        // Attempt to find tracking info via the texture registry or fallback logic
        captureInfo = associateMeshWithCanvas(mesh, event);

        // Fallback for manual associations (userData)
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
                    captureInfo: captureInfo!,
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