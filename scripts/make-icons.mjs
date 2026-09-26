// Generates the PWA icons without any native dependencies (pure Node PNG writer).
// Design: rounded indigo-blue square with a soft white coin ring and a bar.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function render(size, { maskable = false, transparentCorners = true } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const pad = maskable ? size * 0.1 : 0
  const radius = maskable ? 0 : size * 0.22
  const bg = [37, 99, 235] // accent blue
  const bg2 = [30, 64, 175]
  const cx = size / 2
  const cy = size / 2
  const ringR = size * 0.27
  const ringW = size * 0.075
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // rounded-square mask
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius))
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius))
      const inside = maskable || Math.hypot(dx, dy) <= radius
      if (!inside && transparentCorners) {
        px[i + 3] = 0
        continue
      }
      // vertical gradient
      const t = y / size
      let r = bg[0] * (1 - t) + bg2[0] * t
      let g = bg[1] * (1 - t) + bg2[1] * t
      let b = bg[2] * (1 - t) + bg2[2] * t
      // coin ring
      const d = Math.hypot(x - cx, y - cy + size * 0.02)
      const ring = Math.abs(d - ringR) < ringW / 2 ? 1 : Math.max(0, 1 - (Math.abs(d - ringR) - ringW / 2) / 1.5)
      // bar (net worth up-tick) inside the ring
      const barX0 = cx - ringR * 0.55, barX1 = cx + ringR * 0.55
      const barY = cy + size * 0.02 + ringR * 0.35
      const slope = (x - barX0) / (barX1 - barX0)
      const lineY = barY - slope * ringR * 0.7
      const bar = x >= barX0 && x <= barX1 && Math.abs(y - lineY) < ringW / 2.4 ? 1 : 0
      const w = Math.min(1, ring + bar)
      r = r * (1 - w) + 255 * w
      g = g * (1 - w) + 255 * w
      b = b * (1 - w) + 255 * w
      void pad
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  return png(size, size, px)
}

mkdirSync('public', { recursive: true })
writeFileSync('public/pwa-192x192.png', render(192))
writeFileSync('public/pwa-512x512.png', render(512))
writeFileSync('public/pwa-maskable-512x512.png', render(512, { maskable: true }))
writeFileSync('public/apple-touch-icon.png', render(180, { maskable: true }))
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#1e40af"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><circle cx="32" cy="33" r="17" fill="none" stroke="#fff" stroke-width="4.8"/><path d="M23 39 L41 27" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/></svg>`,
)
console.log('icons written to public/')
