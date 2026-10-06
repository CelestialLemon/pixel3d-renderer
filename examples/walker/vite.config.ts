import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The example game is served and built on its own (`npm run example`, port 5181) and imports the renderer by its package
// name. Here that name points at the built package in lib/ (`npm run build:lib`), so the game runs against exactly what a
// separate repo would install.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  resolve: { alias: { 'pixel3d-renderer': fileURLToPath(new URL('../../lib/pixel3d-renderer.js', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: { outDir: '../../dist-example', emptyOutDir: true },
});
