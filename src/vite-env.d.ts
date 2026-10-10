/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string
/** tesseract.js + core versions: the folder under /ocr/ holding the reader's files (vite.config.ts) */
declare const __OCR_REV__: string

interface ImportMetaEnv {
  readonly SUPABASE_URL?: string
  readonly SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
