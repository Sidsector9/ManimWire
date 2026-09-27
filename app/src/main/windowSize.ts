import type { WindowSize } from '../shared/developer'

/** Fit in whole aspect-ratio units, rather than independently clamping each axis. */
export function fitContentSize(width: number, height: number, available: WindowSize): WindowSize {
  if (![width, height].every((n) => Number.isInteger(n) && n >= 320 && n <= 7680)) {
    throw new Error('Window dimensions must be whole numbers between 320 and 7680.')
  }
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const divisor = gcd(width, height)
  const unitW = width / divisor
  const unitH = height / divisor
  const units = Math.min(divisor, Math.floor(available.width / unitW), Math.floor(available.height / unitH))
  const result = { width: units * unitW, height: units * unitH }
  if (result.width < 200 || result.height < 200) throw new Error('This aspect ratio cannot fit on the current display.')
  return result
}
