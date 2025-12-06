import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Inspectable } from 'inspectable-r3f';

// Custom R3F Component to test child detection logic
function CustomBox(props: any) {
    return (
        <mesh {...props}>
            <boxGeometry args={[2, 2, 2]} />
            <meshBasicMaterial />
        </mesh>
    );
}

// Multi-face cube made of 6 inspectable planes
function MultiTextureCube() {
    const size = 2;
    const half = size / 2;

    const faces = [
        { pos: [0, 0, half] as [number, number, number], rot: [0, 0, 0] as [number, number, number], color: '#e74c3c', label: 'Front' },
        { pos: [0, 0, -half] as [number, number, number], rot: [0, Math.PI, 0] as [number, number, number], color: '#3498db', label: 'Back' },
        { pos: [half, 0, 0] as [number, number, number], rot: [0, Math.PI / 2, 0] as [number, number, number], color: '#2ecc71', label: 'Right' },
        { pos: [-half, 0, 0] as [number, number, number], rot: [0, -Math.PI / 2, 0] as [number, number, number], color: '#f39c12', label: 'Left' },
        { pos: [0, half, 0] as [number, number, number], rot: [-Math.PI / 2, 0, 0] as [number, number, number], color: '#9b59b6', label: 'Top' },
        { pos: [0, -half, 0] as [number, number, number], rot: [Math.PI / 2, 0, 0] as [number, number, number], color: '#1abc9c', label: 'Bottom' },
    ];

    return (
        <group position={[4, 0, 0]}>
            {faces.map((face, i) => (
                <Inspectable key={i}>
                    <mesh position={face.pos} rotation={face.rot}>
                        <planeGeometry args={[size, size]} />
                        <meshBasicMaterial side={THREE.DoubleSide} />
                    </mesh>
                    <div style={{
                        width: 200,
                        height: 200,
                        background: face.color,
                        color: 'white',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'Arial',
                    }}>
                        <h2 style={{ margin: 0 }}>{face.label}</h2>
                        <p style={{ margin: '8px 0 0 0', opacity: 0.8 }}>Face {i + 1}</p>
                    </div>
                </Inspectable>
            ))}
        </group>
    );
}

function App() {
    return (
        <Canvas camera={{ position: [0, 2, 10], fov: 50 }} style={{ width: '100%', height: '100vh' }}>
            <ambientLight intensity={1} />

            <Inspectable>
                <mesh position={[-4, 0, 0]}>
                    <planeGeometry args={[3, 2]} />
                    <meshBasicMaterial side={THREE.DoubleSide} />
                </mesh>
                <div style={{ width: 300, height: 200, background: '#4f46e5', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial' }}>
                    <h1>Hello World</h1>
                </div>
            </Inspectable>

            <Inspectable>
                <CustomBox position={[0, 0, 0]} />
                <div style={{ width: 200, height: 200, background: '#059669', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia' }}>
                    <h2>Edit Me</h2>
                </div>
            </Inspectable>

            <MultiTextureCube />

            <OrbitControls />
            <gridHelper args={[20, 20, '#555', '#333']} position={[0, -2, 0]} />
        </Canvas>
    );
}

export default App;
