import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Integration tests that need the local stack running (powershell -File dev-local\start.ps1).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { environment: 'node', include: ['dev-local/**/*.integration.test.ts'], testTimeout: 120_000, fileParallelism: false },
})
