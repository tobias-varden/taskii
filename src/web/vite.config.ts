import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs, so the bundle works from whatever host the shell maps it to.
  base: './',
  server: { port: 5199, strictPort: true },
  build: {
    target: 'esnext',
    sourcemap: true,
    // Two pages: the main window and the quick capture bar.
    rollupOptions: { input: { main: 'index.html', capture: 'capture.html' } },
  },
});
