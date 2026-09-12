import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('a value the engine reads reaches the preview', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const image = window.locator('.frame img')
    await expect(image).toBeVisible()
    const shown = async (): Promise<string> => (await image.getAttribute('src'))!
    // Whether a canvas-only edit skips the sync is covered by the revision unit tests:
    // the engine caches frames, so a redundant sync is invisible from here.
    // Two equal reads a beat apart mean the opening render has landed.
    const settled = async (): Promise<string> => {
      let previous = ''
      await expect.poll(async () => {
        const now = await shown()
        const same = now === previous
        previous = now
        return same
      }, { intervals: [400, 400, 400, 400, 400, 400] }).toBe(true)
      return previous
    }
    const first = await settled()

    const node = window.locator('.react-flow__node').first()
    await node.click()
    const radius = window.locator('.inspector .field').filter({ has: window.locator('.field-label', { hasText: /^radius$/ }) }).locator('input')
    await radius.fill('0.5')
    await radius.press('Enter')
    await expect.poll(shown, { message: 'the preview followed the radius' }).not.toBe(first)
  } finally {
    await app.close()
  }
})
