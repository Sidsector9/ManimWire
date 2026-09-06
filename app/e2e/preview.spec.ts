import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('moving a node leaves the preview alone; changing a value still re-renders it', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const image = window.locator('.frame img')
    await expect(image).toBeVisible()
    const shown = async (): Promise<string> => (await image.getAttribute('src'))!
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

    // Drag the circle across the graph. Where a node sits never reaches the engine.
    const node = window.locator('.react-flow__node').first()
    const box = (await node.boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + 8)
    await window.mouse.down()
    await window.mouse.move(box.x + box.width / 2 + 120, box.y + 90, { steps: 10 })
    await window.mouse.up()
    await expect
      .poll(async () => (await node.boundingBox())!.x, { message: 'the node moved' })
      .toBeGreaterThan(box.x + 60)
    await window.waitForTimeout(600) // longer than the sync debounce
    expect(await shown()).toBe(first)

    // A value the engine does read still reaches the preview.
    await node.click()
    const radius = window.locator('.inspector .field').filter({ has: window.locator('.field-label', { hasText: /^radius$/ }) }).locator('input')
    await radius.fill('0.5')
    await radius.press('Enter')
    await expect.poll(shown, { message: 'the preview followed the radius' }).not.toBe(first)
  } finally {
    await app.close()
  }
})
