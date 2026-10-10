import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { createReadStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import pkg from './package.json' with { type: 'json' }

/**
 * The on-device OCR (tesseract.js) runs in a web worker that loads its engine (WebAssembly) and the
 * English model by URL. Our Content-Security-Policy allows our own site only, so those files are
 * served from /ocr/<versions>/ here: copied out of node_modules into the build, and served straight
 * from node_modules by the dev server. They are never precached (about 7 MB); the service worker
 * keeps a copy after the first scan (see the "ocr-assets" runtime cache below).
 */
const require = createRequire(import.meta.url)
const OCR_FILES: Record<string, string> = {
  'worker.min.js': require.resolve('tesseract.js/dist/worker.min.js'),
  ...Object.fromEntries(
    ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'].map((f) => [f, join(dirname(require.resolve('tesseract.js-core/package.json')), f)]),
  ),
  'eng.traineddata.gz': join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int', 'eng.traineddata.gz'),
}
const OCR_REV = `${require('tesseract.js/package.json').version}-${require('tesseract.js-core/package.json').version}`
const OCR_DIR = `ocr/${OCR_REV}`

function ocrAssets(): Plugin {
  const type = (name: string) => (name.endsWith('.js') ? 'application/javascript' : 'application/gzip')
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith(`/${OCR_DIR}/`) ? req.url.slice(OCR_DIR.length + 2).split('?')[0] : undefined
        const file = name ? OCR_FILES[name] : undefined
        if (!file) return next()
        res.setHeader('Content-Type', type(name!))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `${OCR_DIR}/${name}`, source: readFileSync(file) })
    },
  }
}

/** Request headers that describe the connection rather than the request; not passed on to the functions. */
const HOP_BY_HOP_HEADERS = new Set(['connection', 'content-length', 'expect', 'host', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

/**
 * In development, answer /api/<name> with the same Vercel function file (api/<name>.ts) that runs in
 * production, so features that need a server (e.g. gold prices, reminders) work with `npm run dev` too.
 * GET and POST reach the module's exported GET / POST handler with their headers and body. Like on
 * Vercel, the functions see the project's environment variables: here the .env files Vite reads for
 * the current mode (e.g. .env.localstack with `npm run dev:local`); variables set in the shell win.
 */
function vercelFunctionsInDev(): Plugin {
  return {
    name: 'vercel-functions-in-dev',
    configureServer(server) {
      for (const [key, value] of Object.entries(loadEnv(server.config.mode, server.config.envDir, ''))) process.env[key] ??= value
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z0-9-]+)(?:\?|$)/)
        const method = req.method === 'POST' ? 'POST' : req.method === 'GET' ? 'GET' : undefined
        if (!match || !method) return next()
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`)
          if (typeof mod[method] !== 'function') {
            if (method === 'GET') return next()
            res.statusCode = 405
            res.setHeader('Allow', ['GET', 'POST'].filter((m) => typeof mod[m] === 'function').join(', '))
            return res.end()
          }
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined && !HOP_BY_HOP_HEADERS.has(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
          let body: Uint8Array | undefined
          if (method === 'POST') {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            body = new Uint8Array(Buffer.concat(chunks))
          }
          const response: Response = await mod[method](new Request(`http://localhost${req.url}`, { method, headers, body }))
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
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __OCR_REV__: JSON.stringify(OCR_REV) },
  // Expose SUPABASE_* as well as VITE_* so either naming works on the hosting provider.
  envPrefix: ['VITE_', 'SUPABASE_'],
  plugins: [
    react(),
    tailwindcss(),
    vercelFunctionsInDev(),
    ocrAssets(),
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
        // reminders: shows pushed notifications and opens the app when one is tapped (public/push-sw.js)
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // the OCR reader (about 7 MB) is fetched on the first scan, not with the app
        globIgnores: ['ocr/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/~/, /^\/api\//, /^\/ocr\//],
        runtimeCaching: [
          {
            // the OCR reader's engine and model: kept once downloaded, so scanning works offline
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [200] } },
          },
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
