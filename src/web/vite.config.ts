import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs, so the bundle works from whatever host the shell maps it to.
  base: './',
  server: { port: 5199, strictPort: true },
  build: { target: 'esnext', sourcemap: true },
});
