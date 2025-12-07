import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Inspectable } from 'inspectable-r3f';
import { Html2CanvasPlane, Canvas2DBox, MultiTextureCube } from './components';

function App() {
    return (
        <Canvas camera={{ position: [0, 2, 10], fov: 50 }} style={{ width: '100%', height: '100vh' }}>
            <ambientLight intensity={1} />

            <Inspectable />

            {/* CASE 1: html2canvas-based texture */}
            <Html2CanvasPlane />

            {/* CASE 2: Canvas 2D texture */}
            <Canvas2DBox />

            {/* CASE 3: Multi-face cube */}
            <MultiTextureCube />

            <OrbitControls enablePan={true} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} />
            <gridHelper args={[20, 20, '#555', '#333']} position={[0, -2, 0]} />
        </Canvas>
    );
}

export default App;
