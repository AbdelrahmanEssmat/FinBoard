// Generates the PWA icons without native dependencies (pure Node PNG writer).
// Design: deep-blue rounded tile, a gold coin and three rising white bars – "your money, growing".
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// signed distance helpers (pixel units)
const sdRoundRect = (px, py, x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2 - r, hh = (y1 - y0) / 2 - r
  const dx = Math.abs(px - cx) - hw, dy = Math.abs(py - cy) - hh
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d))
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t)

/** Shapes in unit coordinates (0..1) so every size renders the same picture. */
function shapes(s, inset) {
  const u = (v) => inset + v * (s - 2 * inset)
  const barW = 0.15, bottom = 0.79
  return {
    bars: [
      [u(0.19), u(bottom - 0.24), u(0.19 + barW), u(bottom)],
      [u(0.425), u(bottom - 0.39), u(0.425 + barW), u(bottom)],
      [u(0.66), u(bottom - 0.56), u(0.66 + barW), u(bottom)],
    ],
    barR: u(0.035) - inset,
    coin: { cx: u(0.30), cy: u(0.30), r: u(0.11) - inset },
  }
}

function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const inset = maskable ? size * 0.12 : 0 // maskable icons keep art inside the safe zone
  const radius = maskable ? 0 : size * 0.225
  const top = [43, 92, 230], bot = [24, 52, 150] // blue gradient
  const white = [255, 255, 255], gold = [255, 196, 61], goldDark = [214, 150, 20]
  const sh = shapes(size, inset)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const p = x + 0.5, q = y + 0.5
      const tile = maskable ? 0 : sdRoundRect(p, q, 0, 0, size, size, radius)
      const alpha = maskable ? 1 : cover(tile)
      if (alpha <= 0) { px[i + 3] = 0; continue }
      let c = mix(top, bot, q / size)
      for (const [x0, y0, x1, y1] of sh.bars) c = mix(c, white, cover(sdRoundRect(p, q, x0, y0, x1, y1, sh.barR)))
      // coin: gold disc with a darker inner ring for a bit of depth
      const dc = sdCircle(p, q, sh.coin.cx, sh.coin.cy, sh.coin.r)
      c = mix(c, gold, cover(dc))
      const ring = Math.abs(dc + sh.coin.r * 0.3) - sh.coin.r * 0.07
      c = mix(c, goldDark, cover(ring) * 0.9)
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round(alpha * 255)
    }
  }
  return png(size, px)
}

mkdirSync('public', { recursive: true })
writeFileSync('public/pwa-192x192.png', render(192))
writeFileSync('public/pwa-512x512.png', render(512))
writeFileSync('public/pwa-maskable-512x512.png', render(512, { maskable: true }))
writeFileSync('public/apple-touch-icon.png', render(180, { maskable: true }))
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b5ce6"/><stop offset="1" stop-color="#183496"/></linearGradient></defs>
  <rect width="64" height="64" rx="14.4" fill="url(#g)"/>
  <circle cx="19.2" cy="19.2" r="7" fill="#ffc43d"/>
  <circle cx="19.2" cy="19.2" r="4.9" fill="none" stroke="#d69614" stroke-width="0.9"/>
  <rect x="12.2" y="35.2" width="9.6" height="15.4" rx="2.2" fill="#fff"/>
  <rect x="27.2" y="25.6" width="9.6" height="25" rx="2.2" fill="#fff"/>
  <rect x="42.2" y="14.7" width="9.6" height="35.9" rx="2.2" fill="#fff"/>
</svg>`,
)
console.log('icons written to public/')
