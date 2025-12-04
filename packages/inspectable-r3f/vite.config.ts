import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
    plugins: [
        react(),
        dts({ include: ['src'] }),
    ],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'InspectableR3F',
            fileName: 'inspectable-r3f',
        },
        rollupOptions: {
            external: ['react', 'react-dom', 'react/jsx-runtime', 'three', '@react-three/fiber'],
            output: {
                globals: {
                    react: 'React',
                    'react-dom': 'ReactDOM',
                    'react/jsx-runtime': 'jsxRuntime',
                    three: 'THREE',
                    '@react-three/fiber': 'ReactThreeFiber',
                },
            },
        },
    },
});
