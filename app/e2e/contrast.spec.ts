import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
// WCAG 2.1 contrast: 4.5 for text, 3 for icons and other non-text.
const READABLE = 4.5

/** Contrast ratio of a foreground over a background, both as computed style strings. */
function ratio(foreground: number[], background: number[]): number {
  const luminance = (rgb: number[]): number => {
    const [r, g, b] = rgb.map((v) => {
      const channel = v / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

test('an active toolbar button stays readable while hovered', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const buttons = window.locator('.icon.active')
    await expect(buttons).not.toHaveCount(0)

    for (const button of await buttons.all()) {
      for (const hovered of [false, true]) {
        if (hovered) await button.hover()
        else await window.locator('.toolbar').hover({ position: { x: 4, y: 4 } })
        const colours = await button.evaluate((el) => {
          const style = getComputedStyle(el)
          // Painting each colour gives bytes whatever notation the stylesheet used,
          // including color(srgb ...) from color-mix.
          const paint = document.createElement('canvas').getContext('2d')!
          const read = (value: string): number[] => {
            paint.clearRect(0, 0, 1, 1)
            paint.fillStyle = value
            paint.fillRect(0, 0, 1, 1)
            return [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3)
          }
          return { text: read(style.color), background: read(style.backgroundColor) }
        })
        const contrast = ratio(colours.text, colours.background)
        expect(contrast, `${hovered ? 'hovered' : 'resting'}: ${colours.text} on ${colours.background}`).toBeGreaterThanOrEqual(READABLE)
      }
    }
  } finally {
    await app.close()
  }
})
