import { defineConfig } from 'vite';
import { bakedScenes } from './tools/baked-plugin.ts';

export default defineConfig({
  // Scenes baked by `npm run bake` (tools/bake.ts), loaded by the production build instead of being built at page load.
  plugins: [bakedScenes()],
  // Pin IPv4 so the capture/verify tools (which use 127.0.0.1) always reach the dev server.
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: {
    rolldownOptions: {
      input: { main: 'index.html', pass0: 'pass0.html', pass3: 'pass3.html' },
    },
  },
});
