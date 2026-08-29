import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first. A Map over a Range, from examples/dots.mnw.
test('a Map over a Range becomes a loop, and the settings dialog edits the scene type', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/dots.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await expect(window.locator('.node.container')).toHaveCount(1)
    await expect(window.locator('.node.container .node-tag')).toHaveText('for each item')
    await expect(window.locator('.frame img')).toBeVisible()

    await window.getByRole('button', { name: 'Code' }).click()
    const code = window.locator('.code-lines')
    await expect(code).toContainText('for index, item in enumerate(range):')
    await expect(code).toContainText('dots.append(dot)')
    await expect(code).toContainText('vgroup = VGroup(*dots)')

    // The settings dialog changes the scene type; the generated class follows.
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.locator('.dialog .chip', { hasText: 'MovingCameraScene' }).click()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(code).toContainText('class Dots(MovingCameraScene):')

    // The Library offers logic nodes and reports the parity metric.
    await window.locator('.library-search input').fill('Repeat')
    await expect(window.locator('.library-entry', { hasText: 'Repeat' })).toHaveCount(1)
    await expect(window.locator('.library-foot')).toContainText('not yet presentable')
  } finally {
    await app.close()
  }
})
