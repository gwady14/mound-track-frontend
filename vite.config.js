import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' registers the SW and silently updates it in the background.
      // The old SW (and its cached assets) stays active until the tab is closed/refreshed,
      // so the user at the ballpark never gets a mid-game asset swap.
      registerType: 'autoUpdate',

      // Cache all Vite-built assets (JS bundles, CSS, fonts) at install time.
      // The glob patterns below cover everything Vite emits into /assets/.
      workbox: {
        // Pre-cache the app shell (HTML entry + all built assets)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],

        // Runtime caching for API calls: use a NetworkFirst strategy so the app
        // always tries to get fresh data but falls back to cached responses
        // when offline.  This is a safety net — player data is already cached
        // in IndexedDB by the app's own cache layer; this caches the raw HTTP
        // responses as a second layer for anything that slips through.
        runtimeCaching: [
          {
            // All backend API calls
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 24 * 60 * 60, // 24 hours
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // MLB team logo SVGs from mlbstatic.com
            urlPattern: /mlbstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mlb-logos',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      // Web app manifest — needed for "Add to Home Screen" and PWA install prompt
      manifest: {
        name: 'Mound Track',
        short_name: 'Mound Track',
        description: 'Baseball broadcast assistant',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [
          { src: '/logo.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],

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
        target: process.env.VITE_API_TARGET || 'https://boothcast-backend-production.up.railway.app',
        changeOrigin: true,
      },
    },
  },
});
