import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('clear disk cache in settings, then scrub and play again', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-cache-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const canvas = window.locator('.frame canvas')
    await expect(canvas).toHaveAttribute('data-frame', /http:/)
    const previous = await canvas.getAttribute('data-frame')
    await window.getByTitle('Settings', { exact: true }).click()
    const clear = window.getByRole('button', { name: 'Clear disk cache', exact: true })
    await expect(clear).toBeEnabled()
    await clear.click()
    await expect(window.getByRole('status').filter({ hasText: 'Disk cache cleared.' })).toBeVisible()
    await window.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(window.locator('.node')).toHaveCount(3)
    const zero = (await window.locator('.timeline-ticks .tick').filter({ hasText: /^0s$/ }).boundingBox())!
    const one = (await window.locator('.timeline-ticks .tick').filter({ hasText: /^1s$/ }).boundingBox())!
    const ruler = (await window.locator('.timeline-ticks').boundingBox())!
    await window.mouse.click(zero.x + (one.x - zero.x) * .5, ruler.y + ruler.height / 2)
    await expect(window.locator('.playhead-time')).toHaveText('0.50')
    await expect(canvas).not.toHaveAttribute('data-frame', previous!)
    await window.getByTitle('Play', { exact: true }).click()
    await expect(window.locator('.playhead-time')).toHaveText('2.00')
    await expect(window.getByTitle('Play', { exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
