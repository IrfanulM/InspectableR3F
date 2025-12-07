import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { html2canvas } from 'inspectable-r3f'; // Automatic tracking: use this wrapper instead of 'html2canvas'

function useHtmlTexture(
    htmlContent: JSX.Element,
    width: number,
    height: number,
    meshRef: React.RefObject<THREE.Mesh>
) {
    useEffect(() => {
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        document.body.appendChild(container);

        const root = createRoot(container);
        root.render(htmlContent);

        const timer = setTimeout(async () => {
            try {
                const canvas = await html2canvas(container, { width, height, scale: 2, logging: false });
                const texture = new THREE.CanvasTexture(canvas);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.needsUpdate = true;

                if (meshRef.current) {
                    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
                    mat.map = texture;
                    mat.needsUpdate = true;
                }
            } catch (e) {
                console.error('html2canvas failed:', e);
            }
        }, 100);

        return () => {
            clearTimeout(timer);
            root.unmount();
        };
    }, [htmlContent, width, height, meshRef]);
}

function createCanvas2DTexture(text: string, bgColor: string, width = 200, height = 200) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function useCanvas2DWithHtml(
    text: string,
    bgColor: string,
    width: number,
    height: number,
    meshRef: React.RefObject<THREE.Mesh>
) {
    useEffect(() => {
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        document.body.appendChild(container);

        const root = createRoot(container);
        root.render(
            <div style={{
                width,
                height,
                background: bgColor,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Arial',
            }}>
                <h2>{text}</h2>
            </div>
        );

        return () => {
            root.unmount();
        };
    }, [text, bgColor, width, height, meshRef]);
}

export function Html2CanvasPlane() {
    const meshRef = useRef<THREE.Mesh>(null);

    const htmlContent = (
        <div style={{
            width: 320,
            height: 240,
            background: '#0f172a',
            color: 'white',
            padding: 24,
            boxSizing: 'border-box',
            fontFamily: '"Satoshi", system-ui, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
        }}>
            <link href="https://api.fontshare.com/v2/css?f[]=satoshi@700,500,400&display=swap" rel="stylesheet" />
            <h1 style={{
                margin: '0 0 20px 0',
                fontSize: 26,
                fontWeight: 700,
                color: '#38bdf8',
                letterSpacing: '-0.5px',
            }}>
                InspectableR3F
            </h1>
            <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.8 }}>
                <div style={{
                    marginBottom: 6,
                    padding: '6px 16px',
                    background: '#1e293b',
                    borderRadius: 6,
                    border: '1px solid #334155',
                }}>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>1.</span> Right-click on mesh
                </div>
                <div style={{
                    marginBottom: 6,
                    padding: '6px 16px',
                    background: '#1e293b',
                    borderRadius: 6,
                    border: '1px solid #334155',
                }}>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>2.</span> Click "Inspect Texture"
                </div>
                <div style={{
                    padding: '6px 16px',
                    background: '#1e293b',
                    borderRadius: 6,
                    border: '1px solid #334155',
                }}>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>3.</span> Open DevTools (F12)
                </div>
            </div>
        </div>
    );

    useHtmlTexture(htmlContent, 320, 240, meshRef);

    return (
        <mesh ref={meshRef} position={[0, 0, 0]}>
            <planeGeometry args={[3.2, 2.4]} />
            <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>
    );
}

export function Canvas2DBox() {
    const meshRef = useRef<THREE.Mesh>(null);
    const texture = createCanvas2DTexture('Canvas 2D', '#059669');

    useCanvas2DWithHtml('Canvas 2D', '#059669', 200, 200, meshRef);

    return (
        <mesh ref={meshRef} position={[-4, 0, 0]}>
            <boxGeometry args={[2, 2, 2]} />
            <meshBasicMaterial map={texture} />
        </mesh>
    );
}

const faceData = [
    { pos: [0, 0, 1] as [number, number, number], rot: [0, 0, 0] as [number, number, number], color: '#e74c3c', label: 'Front' },
    { pos: [0, 0, -1] as [number, number, number], rot: [0, Math.PI, 0] as [number, number, number], color: '#3498db', label: 'Back' },
    { pos: [1, 0, 0] as [number, number, number], rot: [0, Math.PI / 2, 0] as [number, number, number], color: '#2ecc71', label: 'Right' },
    { pos: [-1, 0, 0] as [number, number, number], rot: [0, -Math.PI / 2, 0] as [number, number, number], color: '#f39c12', label: 'Left' },
    { pos: [0, 1, 0] as [number, number, number], rot: [-Math.PI / 2, 0, 0] as [number, number, number], color: '#9b59b6', label: 'Top' },
    { pos: [0, -1, 0] as [number, number, number], rot: [Math.PI / 2, 0, 0] as [number, number, number], color: '#1abc9c', label: 'Bottom' },
];

function CubeFace({ face }: { face: typeof faceData[0] }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const texture = createCanvas2DTexture(face.label, face.color);

    useCanvas2DWithHtml(face.label, face.color, 200, 200, meshRef);

    return (
        <mesh ref={meshRef} position={face.pos} rotation={face.rot}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
        </mesh>
    );
}

export function MultiTextureCube() {
    return (
        <group position={[4, 0, 0]}>
            {faceData.map((face, i) => (
                <CubeFace key={i} face={face} />
            ))}
        </group>
    );
}
