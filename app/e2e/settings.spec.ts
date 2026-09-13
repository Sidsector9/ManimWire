import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('the two chips edit what they name; only the gear opens the settings dialog', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const popover = window.locator('.popover')
    const dialog = window.locator('.dialog')
    const sceneChip = window.getByTitle('Scene type')
    const qualityChip = window.getByTitle('Quality preset')

    // No caret: the chip never promised a menu it does not have.
    await expect(sceneChip).not.toContainText('▾')

    // The scene chip changes the scene type without the dialog.
    await sceneChip.click()
    await expect(popover).toContainText('Scene type')
    await expect(dialog).toHaveCount(0)
    await popover.getByText('ThreeDScene', { exact: true }).click()
    await expect(popover).toHaveCount(0)
    await window.getByRole('button', { name: 'Code' }).click()
    await expect(window.locator('.code-lines')).toContainText('ThreeDScene')

    // The quality chip changes the preset, and the chip itself reports it.
    await expect(qualityChip).toContainText('1920×1080')
    await qualityChip.click()
    await expect(popover).toContainText('Quality preset')
    await popover.getByText('medium', { exact: true }).click()
    await expect(popover).toHaveCount(0)
    await expect(qualityChip).toContainText('1280×720')

    // The gear is the only one that opens the whole dialog.
    await window.locator('.icon[title="Settings"]').click()
    await expect(dialog).toContainText('Project and scene')
  } finally {
    await app.close()
  }
})
