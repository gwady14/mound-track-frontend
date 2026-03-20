import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-v3.js',
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT) || 3000,
    // Proxy all /api requests to the backend so the frontend never touches
    // CORS-restricted APIs directly, and keys stay server-side.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
