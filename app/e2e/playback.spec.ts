import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { EngineApi } from '../src/shared/engine'

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

test('opening the sine example prepares backwards scrubbing without Play', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-seek-')) } })
  const window = await app.firstWindow()
  const file = path.resolve('../examples/7.sine-curve-unit-circle.mnw')
  const content = readFileSync(file, 'utf8')
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.evaluate(() => {
      const host = globalThis as unknown as { engine: EngineApi; warmStarted?: boolean }
      host.engine.onNotification((method) => { if (method === 'render.sequence_started') host.warmStarted = true })
    })
    await app.evaluate(({ BrowserWindow }, opened) => BrowserWindow.getAllWindows()[0]!.webContents.send('file:opened', opened), { path: file, content })
    await expect(window.locator('.canvas-chip.time')).toContainText('9.50')
    const canvas = window.locator('.frame canvas')
    await expect(canvas).toHaveAttribute('data-frame', /http:/)
    await window.waitForFunction(() => (globalThis as unknown as { warmStarted?: boolean }).warmStarted)
    const zero = (await window.locator('.timeline-ticks .tick').filter({ hasText: /^0s$/ }).boundingBox())!
    const one = (await window.locator('.timeline-ticks .tick').filter({ hasText: /^1s$/ }).boundingBox())!
    const ruler = (await window.locator('.timeline-ticks').boundingBox())!
    for (const time of [8, 4, 1]) {
      const result = await window.evaluate(async ({ document, time }) => (globalThis as unknown as { engine: EngineApi }).engine.call('render.frame', { document, scene: document.scenes[0].name, width: 960, time }), { document: JSON.parse(content), time })
      expect(result.ok && (result.result as { render_ms: number }).render_ms).toBe(0)
      await window.mouse.click(zero.x + (one.x - zero.x) * time, ruler.y + ruler.height / 2)
      await expect(window.locator('.playhead-time')).toHaveText(time.toFixed(2))
      await expect(canvas).toHaveAttribute('data-frame', result.ok ? (result.result as { path: string }).path : '', { timeout: 1000 })
      await expect(window.getByTitle('Play', { exact: true })).toBeVisible()
    }
  } finally {
    await app.close()
  }
})
