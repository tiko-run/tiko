import { describe, expect, it } from 'vitest'
import { averageColor, copyWidth, placedSize, rowAround, sortFiles } from '@/canvas/images'

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type })

describe('sortFiles', () => {
  it('keeps pictures and says why the rest are left out', () => {
    const shot = file('shot.png', 'image/png')
    const { pictures, refused } = sortFiles([
      shot,
      file('logo.svg', 'image/svg+xml'),
      file('photo.heic', 'image/heic'),
    ])
    expect(pictures).toEqual([shot])
    expect(refused).toEqual([
      'logo.svg: only PNG, JPEG, WebP and GIF',
      'photo.heic: only PNG, JPEG, WebP and GIF',
    ])
  })

  it('refuses a picture over the limit before it is sent', () => {
    const big = file('big.jpg', 'image/jpeg', 25 * 1024 * 1024 + 1)
    expect(sortFiles([big]).refused).toEqual(['big.jpg: over 25 MB'])
  })
})

describe('copyWidth', () => {
  it('takes the narrowest copy as sharp as the screen needs', () => {
    expect(copyWidth(800, 0.2, 2)).toBe(512)
    expect(copyWidth(800, 1, 1)).toBe(1024)
    expect(copyWidth(800, 1, 2)).toBe(2048)
  })

  it('takes the original past the widest copy', () => {
    expect(copyWidth(800, 3, 2)).toBe(Infinity)
  })
})

describe('placedSize', () => {
  it('fits a 4K screenshot into the view and leaves a small picture as it is', () => {
    expect(placedSize(3840, 2160)).toEqual({ width: 800, height: 450 })
    expect(placedSize(1080, 1920)).toEqual({ width: 450, height: 800 })
    expect(placedSize(300, 200)).toEqual({ width: 300, height: 200 })
  })
})

describe('rowAround', () => {
  it('lays pictures side by side around the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 100 },
    ]
    expect(rowAround({ x: 0, y: 0 }, sizes)).toEqual([
      { x: -162, y: -25 },
      { x: -38, y: -50 },
    ])
  })
})

describe('averageColor', () => {
  it('averages what can be seen', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0])
    expect(averageColor(pixels)).toBe('#800080')
  })

  it('falls back to grey for a see-through picture', () => {
    expect(averageColor(new Uint8ClampedArray([1, 2, 3, 0]))).toBe('#808080')
  })
})
