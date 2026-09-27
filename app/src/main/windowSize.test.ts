import { describe, expect, it } from 'vitest'
import { fitContentSize } from './windowSize'

describe('recording window dimensions', () => {
  it('keeps the requested size when it fits', () => {
    expect(fitContentSize(1280, 720, { width: 1400, height: 850 })).toEqual({ width: 1280, height: 720 })
  })
  it('fits landscape and portrait with exact aspect ratios', () => {
    expect(fitContentSize(1920, 1080, { width: 1400, height: 850 })).toEqual({ width: 1392, height: 783 })
    expect(fitContentSize(1080, 1920, { width: 1400, height: 850 })).toEqual({ width: 477, height: 848 })
  })
  it('rejects invalid sizes and ratios that cannot fit', () => {
    for (const [w, h] of [[NaN, 720], [320.1, 720], [0, 0], [8000, 1080], [1279, 719]]) {
      expect(() => fitContentSize(w!, h!, { width: 1000, height: 700 })).toThrow()
    }
  })
})
