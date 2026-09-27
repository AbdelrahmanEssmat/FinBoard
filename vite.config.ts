import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

import pkg from './package.json' with { type: 'json' }

/**
 * In development, answer /api/<name> with the same Vercel function file (api/<name>.ts) that runs in
 * production, so features that need a server (e.g. gold prices) work with `npm run dev` too.
 */
function vercelFunctionsInDev(): Plugin {
  return {
    name: 'vercel-functions-in-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z0-9-]+)(?:\?|$)/)
        if (!match || req.method !== 'GET') return next()
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`)
          if (typeof mod.GET !== 'function') return next()
          const response: Response = await mod.GET(new Request(`http://localhost${req.url}`))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, errors: [String(e)] }))
        }
      })
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Expose SUPABASE_* as well as VITE_* so either naming works on the hosting provider.
  envPrefix: ['VITE_', 'SUPABASE_'],
  plugins: [
    react(),
    tailwindcss(),
    vercelFunctionsInDev(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FinBoard',
        short_name: 'FinBoard',
        description: 'Your net worth, accounts, debts and spending in one place',
        theme_color: '#2b5ce6',
        background_color: '#f4f5f8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // long-press the app icon (Android, Windows) to jump straight to the daily price round
        shortcuts: [{ name: 'Update prices', short_name: 'Prices', url: '/investments/prices', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] }],
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/~/, /^\/api\//],
        runtimeCaching: [
          {
            // Supabase REST reads: serve from network, fall back to cache when offline.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, host: true },
})
