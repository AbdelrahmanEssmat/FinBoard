/**
 * The OCR reader (tesseract.js) running in a web worker on this device. Its files (about 7 MB:
 * the engine and the English model) are served from our own site under /ocr/<version>/ and cached
 * by the service worker the first time, so later scans work offline. Loaded only when a scan starts,
 * so the app itself doesn't grow.
 */
import type { ScanWord } from '@/domain/priceScan'

export interface OcrProgress {
  stage: 'download' | 'init' | 'recognize'
  /** 0–100 */
  percent: number
}

/** Where the reader's files live; the version is baked in by vite.config.ts so a package update can't mix old and new files. */
export const OCR_BASE = `/ocr/${__OCR_REV__}`
export const OCR_WORKER_URL = `${OCR_BASE}/worker.min.js`

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>

let workerPromise: Promise<TesseractWorker> | null = null
let sink: ((p: OcrProgress) => void) | null = null

function report(m: { status?: string; progress?: number }) {
  if (!sink) return
  const p = Math.max(0, Math.min(1, m.progress ?? 0))
  const status = m.status ?? ''
  // the engine (about 4 MB) is most of the download, the model the rest
  if (status.startsWith('loading tesseract core')) sink({ stage: 'download', percent: Math.round(p * 55) })
  else if (status.startsWith('loading language')) sink({ stage: 'download', percent: Math.round(55 + p * 45) })
  else if (status.startsWith('initializ')) sink({ stage: 'init', percent: Math.round(p * 100) })
  else if (status.startsWith('recognizing')) sink({ stage: 'recognize', percent: Math.round(p * 100) })
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js')
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: OCR_WORKER_URL,
        corePath: OCR_BASE,
        langPath: OCR_BASE,
        // the service worker already keeps a copy; a second one in IndexedDB would just use space
        cacheMethod: 'none',
        // our Content-Security-Policy allows workers from our own site only, not from blob: URLs
        workerBlobURL: false,
        logger: report,
      })
      // sparse text: find words wherever they are, instead of expecting a page of paragraphs. On a
      // Thndr screenshot this reads every ticker; the single-block mode lost most of them to the logos
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' })
      return worker
    })()
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

/** Reads every word in the picture with its box. One scan at a time. */
export async function recognizeScreenshot(png: Blob, onProgress: (p: OcrProgress) => void): Promise<ScanWord[]> {
  sink = onProgress
  try {
    const worker = await getWorker()
    onProgress({ stage: 'recognize', percent: 0 })
    const { data } = await worker.recognize(png, {}, { text: false, blocks: true })
    const words: ScanWord[] = []
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const word of line.words) {
            if (!word.text.trim()) continue
            words.push({ text: word.text, confidence: word.confidence, x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 })
          }
    return words
  } finally {
    sink = null
  }
}

/** Frees the reader's memory (about 100 MB); the next scan starts it again from the cached files. */
export async function releaseOcrWorker(): Promise<void> {
  const p = workerPromise
  workerPromise = null
  if (!p) return
  try {
    const worker = await p
    await worker.terminate()
  } catch {
    // it never started
  }
}

/** True when the reader's files are already on this device (so a scan works offline). */
export async function ocrAssetsCached(): Promise<boolean> {
  try {
    if (!('caches' in window)) return false
    return Boolean(await caches.match(OCR_WORKER_URL))
  } catch {
    return false
  }
}
