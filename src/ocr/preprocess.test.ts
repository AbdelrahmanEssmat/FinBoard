import { describe, expect, it } from 'vitest'
import { enhance, scaleFor } from '@/ocr/preprocess'

const rgba = (...pixels: [number, number, number][]) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 200]))

describe('preparing a screenshot', () => {
  it('a light theme stays dark-on-light, stretched to full contrast', () => {
    const px = rgba([250, 250, 250], [240, 240, 240], [60, 60, 60], [20, 20, 20])
    const r = enhance(px)
    expect(r.inverted).toBe(false)
    expect(px[0]).toBe(255) // the lightest pixel is white
    expect(px[12]).toBe(0) // the darkest is black
    expect(px[3]).toBe(255) // alpha is solid
    expect(px[1]).toBe(px[0]) // grey: r = g = b
  })
  it('a dark theme is flipped so the text is dark on light', () => {
    const px = rgba([20, 20, 20], [30, 30, 30], [25, 25, 25], [230, 230, 230])
    const r = enhance(px)
    expect(r.inverted).toBe(true)
    expect(px[0]).toBe(255) // the dark background became white
    expect(px[12]).toBe(0) // the light text became black
  })
  it('a flat picture is left alone instead of being blown up', () => {
    const px = rgba([128, 128, 128], [130, 130, 130], [132, 132, 132])
    enhance(px)
    expect(px[0]).toBe(128)
  })
  it('scales the width into the readable range, within the pixel budget', () => {
    expect(scaleFor(1170, 2532)).toBe(1) // an iPhone screenshot is already fine
    expect(scaleFor(390, 844)).toBeCloseTo(1200 / 390, 5) // a small image is enlarged
    expect(scaleFor(4000, 3000)).toBeCloseTo(0.5, 5) // a big one is shrunk to 2000 wide
    expect(scaleFor(2000, 6000) * 2000 * 6000 * scaleFor(2000, 6000)).toBeLessThanOrEqual(8_000_001) // and never past 8 MP
    expect(scaleFor(0, 10)).toBe(1)
  })
})
