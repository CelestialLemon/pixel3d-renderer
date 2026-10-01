import { defineConfig } from 'vite';

export default defineConfig({
  // Pin IPv4 so the capture/verify tools (which use 127.0.0.1) always reach the dev server.
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: {
    rolldownOptions: {
      input: { main: 'index.html', pass0: 'pass0.html', pass3: 'pass3.html' },
    },
  },
});
