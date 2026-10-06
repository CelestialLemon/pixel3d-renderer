import { defineConfig } from 'vite';

// The library build (`npm run build:lib`): the renderer as one ES module in lib/, with three.js left to the game.
// The demo pages build separately into dist/ (vite.config.ts).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'lib',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: { entry: 'src/renderer/index.ts', formats: ['es'], fileName: 'pixel3d-renderer' },
    rolldownOptions: { external: (id) => id === 'three' || id.startsWith('three/') },
  },
});
