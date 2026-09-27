import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('expression completions follow the caret and preserve text', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mnw-completion-'))
  const file = path.join(directory, 'expression.mnw')
  writeFileSync(file, JSON.stringify({ version: 1,
    settings: { pixel_width: 640, pixel_height: 360, frame_rate: 15, background_color: 'BLACK', output_format: 'mp4' },
    scenes: [{ name: 'Scene', scene_type: 'Scene', nodes: [{ id: 'expr', catalogue: 'Expression', position: [100, 100], values: {} }], edges: [], steps: [] }], groups: [] }))
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: directory, MNW_OPEN: file } })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.status')).toContainText('engine ready')
    await page.getByRole('textbox', { name: 'Edit expression' }).first().click()
    const input = page.getByRole('textbox', { name: 'Expression', exact: true })
    await input.fill('2 * PI + x')
    await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6))
    await input.press('Control+Space')
    await expect(page.getByRole('option', { name: 'pi', exact: true })).toBeVisible()
    await input.press('Tab')
    await expect(input).toHaveValue('2 * pi + x')
    await input.fill('si')
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await input.press('Tab')
    await expect(input).toHaveValue('sinh')
    await input.fill('sq')
    const first = await page.getByRole('listbox').boundingBox()
    await input.fill('1 +\nsq')
    const second = await page.getByRole('listbox').boundingBox()
    expect(second!.y).toBeGreaterThan(first!.y)
    await input.press('Enter')
    await expect(input).toHaveValue('1 +\nsq\n')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await input.fill('sq')
    await input.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toBeVisible()
    await input.fill('1 + '.repeat(25) + 'sq')
    const beforeResize = await page.getByRole('listbox').boundingBox()
    await input.evaluate((el: HTMLTextAreaElement) => { el.style.width = '260px' })
    await expect.poll(async () => (await page.getByRole('listbox').boundingBox())!.y).not.toBe(beforeResize!.y)
    await input.fill('1 +\n'.repeat(15) + 'sq')
    await input.evaluate((el: HTMLTextAreaElement) => { el.scrollTop = el.scrollHeight })
    await expect(page.getByRole('listbox')).toBeVisible()
    await input.evaluate((el: HTMLTextAreaElement) => { el.scrollTop = 0 })
    await expect(page.getByRole('listbox')).toBeHidden()
  } finally { await app.close() }
})
