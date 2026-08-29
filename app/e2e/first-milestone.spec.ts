import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('start with a circle, see the preview, read the generated code', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()

    await expect(window.locator('.node')).toHaveCount(3)
    const image = window.locator('.frame img')
    await expect(image).toBeVisible()
    await expect(image).toHaveJSProperty('naturalWidth', 960)
    await expect(window.locator('.canvas-chip.time')).toContainText('t = 2.00 s')

    await window.getByRole('button', { name: 'Code' }).click()
    await expect(window.locator('.code-lines')).toContainText('self.play(Create(circle, run_time=2))')
    await expect(window.locator('.code-lines')).toContainText('class Scene1(Scene):')
  } finally {
    await app.close()
  }
})
