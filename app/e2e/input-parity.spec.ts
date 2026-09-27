import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('Write timing inputs and additional options are usable in the Inspector', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mnw-input-parity-'))
  const file = path.join(directory, 'write.mnw')
  writeFileSync(file, JSON.stringify({ version: 1,
    settings: { pixel_width: 256, pixel_height: 144, frame_rate: 15, background_color: 'BLACK', output_format: 'mp4' },
    scenes: [{ name: 'Writing', scene_type: 'Scene', nodes: [
      { id: 'c', catalogue: 'Circle', position: [50, 50], values: {} },
      { id: 'w', catalogue: 'Write', position: [350, 50], values: {} }
    ], edges: [{ source: 'c', target: 'w', port: 'vmobject' }], steps: [{ kind: 'play', animations: ['w'] }] }], groups: [] }))
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: directory, MNW_OPEN: file } })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.status')).toContainText('engine ready')
    await page.locator('.node-head').filter({ hasText: 'Write' }).click()
    const inspector = page.locator('.inspector')
    for (const [name, value] of [['run_time', '1'], ['lag_ratio', '0.01']]) {
      const row = inspector.locator('.field').filter({ has: page.locator('.field-label').getByText(name!, { exact: true }) })
      await row.locator('input').fill(value!)
      await row.locator('input').press('Tab')
    }
    await expect(inspector.getByRole('heading', { name: 'Additional options' })).toBeVisible()
    await inspector.locator('[data-section="additional-options"]').getByRole('button', { name: '+ Config' }).click()
    await expect(page.locator('.node-title').getByText('Config', { exact: true })).toBeVisible()
    await page.getByTitle('Code', { exact: true }).click()
    await expect(page.locator('.code-lines')).toContainText('run_time=1')
    await expect(page.locator('.code-lines')).toContainText('lag_ratio=0.01')
    await expect(page.locator('.code-lines')).toContainText('**config')
  } finally { await app.close() }
})
