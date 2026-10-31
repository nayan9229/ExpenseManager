import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Palette token: Warm White. Mirrors --color-warm-white in src/app.css.
const warmWhite = '#F3EDE1'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.ico'],
      manifest: {
        id: '/',
        name: 'Family Expenses',
        short_name: 'Expenses',
        description: 'Household expense ledger stored in the Admin’s Google Drive',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: warmWhite,
        background_color: warmWhite,
        lang: 'en-IN',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell: everything Vite emits plus the public icons.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // The HEIC converter (~3 MB, ticket 06) is fetched only when a HEIC
        // file is picked, so it stays out of the precache and is cached on
        // first use instead (runtime rule below).
        globIgnores: ['**/heic-to-*.js', 'receipt-upload-proof.html'],
        // SPA navigations fall back to the shell, but never for API routes.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // API routes are network-only. Offline behaviour comes from Dexie
        // (ticket 09), never from the service worker.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => /^\/assets\/heic-to-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'heic-converter', expiration: { maxEntries: 2 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // The lazily-loaded HEIC converter is one 3.2 MB chunk by design.
    chunkSizeWarningLimit: 3300,
  },
  server: {
    // `vercel dev` starts Vite through `npm run dev` and expects it on the
    // port it hands over in $PORT; without this it never detects the server.
    port: Number(process.env['PORT']) || 5173,
    strictPort: Boolean(process.env['PORT']),
    // `vercel dev` caches a whole Go toolchain under .vercel/; keep the
    // watcher (and its tsconfig detection) out of it.
    watch: { ignored: ['**/.vercel/**'] },
    // `vercel dev` serves this app on :3000 and proxies to Vite itself, so
    // this proxy only matters when running `npm run dev` directly: it sends
    // /api/* to a `vercel dev` instance running alongside.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
