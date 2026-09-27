import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('scrubbing works after playing from the middle to the end', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    await expect(window.locator('.frame canvas')).toBeVisible()
    const head = window.locator('.playhead-time')
    const ruler = window.locator('.timeline-ticks')
    const zero = window.locator('.timeline-ticks .tick').filter({ hasText: /^0s$/ })
    const one = window.locator('.timeline-ticks .tick').filter({ hasText: /^1s$/ })
    const scrub = async (time: number): Promise<void> => {
      const start = (await zero.boundingBox())!
      const second = (await one.boundingBox())!
      const strip = (await ruler.boundingBox())!
      await window.mouse.click(start.x + (second.x - start.x) * time, strip.y + strip.height / 2)
      await expect(head).toHaveText(time.toFixed(2))
    }

    await scrub(0.5)
    await window.getByTitle('Play', { exact: true }).click()
    await expect(head).toHaveText('2.00')
    await expect(window.getByTitle('Play', { exact: true })).toBeVisible({ timeout: 5000 })
    const before = await window.locator('.frame canvas').getAttribute('data-frame')
    await scrub(0.75)
    await expect(window.locator('.frame canvas')).not.toHaveAttribute('data-frame', before!)
    // Let any surviving playback ticks run: they must not overwrite the scrub.
    await window.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    await expect(head).toHaveText('0.75')
    await scrub(0.25)
  } finally {
    await app.close()
  }
})
