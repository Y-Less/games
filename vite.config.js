import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// In development the Vite dev server (5173) proxies the API, sockets and uploaded files to the Node server (3000).
// Game modules live in modules/<id>/ and are loaded by the shell with import.meta.glob, so Vite's root is this folder.
export default defineConfig({
  plugins: [vue()],
  // Component tests (vitest) live next to the components as src/**/*.test.js; the server tests use node:test.
  test: { environment: 'jsdom', include: ['src/**/*.test.js', 'modules/*/client/**/*.test.js'] },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/assets': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
