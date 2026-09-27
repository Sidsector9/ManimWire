import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { EngineApi } from '../src/shared/engine'

test('reports the selected Python renderer and renders a scene', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: {
    ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-renderer-'))
  } })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.status')).toContainText('engine ready')
    const status = await page.evaluate(() => (window as unknown as { engine: EngineApi }).engine.status())
    const rendering = status.info?.rendering
    expect(rendering).toBeTruthy()
    await expect(page.locator('.status')).toContainText(rendering!.renderer === 'opengl' ? 'OpenGL' : 'Cairo · CPU')
    if (rendering!.renderer === 'opengl') {
      await expect(page.locator('.status')).toContainText(rendering!.device!)
    }
    await page.getByRole('button', { name: 'Start with a circle' }).click()
    await expect(page.locator('.frame canvas')).toBeVisible()
    await expect(page.locator('.frame canvas')).toHaveAttribute('data-frame', /^http:\/\/127\.0\.0\.1:/)
    // Revisit a prepared frame to exercise browser PNG decoding, not just the
    // immediate raw fallback used before background encoding finishes.
    const zero = (await page.locator('.timeline-ticks .tick').filter({ hasText: /^0s$/ }).boundingBox())!
    const one = (await page.locator('.timeline-ticks .tick').filter({ hasText: /^1s$/ }).boundingBox())!
    const ruler = (await page.locator('.timeline-ticks').boundingBox())!
    await page.mouse.click(one.x, ruler.y + ruler.height / 2)
    await expect(page.locator('.canvas-chip.time')).toContainText('1.00')
    const prepared = (await page.locator('.frame canvas').getAttribute('data-frame'))!
    await expect.poll(() => page.evaluate(async (url) => (await fetch(url, { headers: { Accept: 'image/png' } })).headers.get('Content-Type'), prepared)).toBe('image/png')
    await page.mouse.click(zero.x + (one.x - zero.x) / 2, ruler.y + ruler.height / 2)
    await expect(page.locator('.frame canvas')).not.toHaveAttribute('data-frame', prepared)
    const delivery = page.waitForResponse((response) => response.url() === prepared && response.headers()['content-type'] === 'image/png')
    await page.mouse.click(one.x, ruler.y + ruler.height / 2)
    await delivery
    await expect(page.locator('.frame canvas')).toHaveAttribute('data-frame', prepared)
    // The browser displays the engine's actual RGBA bytes, with correct row and
    // channel ordering, rather than merely mounting a blank canvas.
    expect(await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.frame canvas')!
      const displayed = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const response = await fetch(canvas.dataset['frame']!)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.length === displayed.length && bytes.every((value, i) => value === displayed[i])
    })).toBe(true)
    await expect(page.locator('.timeline')).not.toContainText('error')
  } finally {
    await app.close()
  }
})
