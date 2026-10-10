/**
 * Gets a screenshot ready for the OCR: decoded, sized so the text is about the height Tesseract
 * reads best, turned to grey, flipped to dark-on-light when it was a dark theme, and the contrast
 * stretched. Everything happens in memory on this device; nothing is stored or sent anywhere.
 */

export const LIMITS = {
  minWidth: 1200,
  maxWidth: 2000,
  /** after scaling */
  maxPixels: 8_000_000,
  /** before scaling: bigger than any phone or desktop screenshot */
  maxSourcePixels: 40_000_000,
  maxFileBytes: 30_000_000,
}

export type ScanImageErrorCode = 'not-image' | 'too-large' | 'decode'

export class ScanImageError extends Error {
  constructor(public code: ScanImageErrorCode) {
    super(code)
    this.name = 'ScanImageError'
  }
}

export interface PreparedImage {
  png: Blob
  width: number
  height: number
  /** the screenshot was a dark theme and was inverted */
  inverted: boolean
}

/**
 * Grey, inverted when dark, contrast stretched between the 2nd and 98th percentile. Works on the
 * RGBA bytes in place and says what it did. Pure, so it can be tested without a browser.
 */
export function enhance(px: Uint8ClampedArray): { inverted: boolean; mean: number } {
  const n = px.length / 4
  if (!n) return { inverted: false, mean: 0 }
  const grey = new Uint8Array(n)
  const hist = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!)
    grey[i] = g
    hist[g]!++
    total += g
  }
  const mean = total / n
  const inverted = mean < 128
  // the 2nd and 98th percentiles become black and white, so faint grey text gets some contrast
  const pick = (fraction: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!
      if (acc >= fraction * n) return v
    }
    return 255
  }
  let lo = pick(0.02)
  let hi = pick(0.98)
  if (hi - lo < 32) {
    lo = 0
    hi = 255
  }
  for (let i = 0; i < n; i++) {
    let v = Math.round(((grey[i]! - lo) * 255) / (hi - lo))
    v = v < 0 ? 0 : v > 255 ? 255 : v
    if (inverted) v = 255 - v
    px[i * 4] = v
    px[i * 4 + 1] = v
    px[i * 4 + 2] = v
    px[i * 4 + 3] = 255
  }
  return { inverted, mean }
}

/** The scale that brings the width into [minWidth, maxWidth] without passing maxPixels; 1 when it is close enough already. */
export function scaleFor(width: number, height: number, limits = LIMITS): number {
  if (width <= 0 || height <= 0) return 1
  const target = Math.min(limits.maxWidth, Math.max(limits.minWidth, width))
  let s = target / width
  if (width * height * s * s > limits.maxPixels) s = Math.sqrt(limits.maxPixels / (width * height))
  return s > 0.92 && s < 1.08 ? 1 : s
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // older Safari: an <img> honours the orientation too
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } catch {
      throw new ScanImageError('decode')
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function prepareScreenshot(file: Blob, limits = LIMITS): Promise<PreparedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new ScanImageError('not-image')
  if (file.size > limits.maxFileBytes) throw new ScanImageError('too-large')
  const source = await decode(file)
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height
  const release = () => {
    if ('close' in source) source.close()
  }
  if (!sw || !sh) {
    release()
    throw new ScanImageError('decode')
  }
  if (sw * sh > limits.maxSourcePixels) {
    release()
    throw new ScanImageError('too-large')
  }
  const s = scaleFor(sw, sh, limits)
  const width = Math.round(sw * s)
  const height = Math.round(sh * s)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    release()
    throw new ScanImageError('decode')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  release()
  const data = ctx.getImageData(0, 0, width, height)
  const { inverted } = enhance(data.data)
  ctx.putImageData(data, 0, 0)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  if (!png) throw new ScanImageError('decode')
  return { png, width, height, inverted }
}
