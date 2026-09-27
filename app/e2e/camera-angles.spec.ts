import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('camera angle expressions commit, generate, render, and save without losing their text', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mnw-angle-test-'))
  const file = path.join(directory, 'angles.mnw')
  writeFileSync(file, JSON.stringify({
    version: 1,
    settings: { pixel_width: 640, pixel_height: 360, frame_rate: 15, background_color: 'BLACK', output_format: 'mp4' },
    scenes: [{ name: 'Angles', scene_type: 'ThreeDScene', nodes: [{ id: 'circle', catalogue: 'Circle', position: [80, 100], values: {} }], edges: [], steps: [
      { kind: 'camera', action: 'orient', phi: 1.2, theta: -0.8 },
      { kind: 'add', mobjects: ['circle'] },
      { kind: 'wait', duration: 1 }
    ] }], groups: []
  }))
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: directory, MNW_OPEN: file } })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.status')).toContainText('engine ready')
    await page.getByTitle('camera camera orientation', { exact: true }).locator('.marker-label').click()
    await page.getByRole('textbox', { name: 'phi', exact: true }).fill('75 * DEGREES')
    await page.getByRole('textbox', { name: 'phi', exact: true }).press('Enter')
    await page.getByRole('textbox', { name: 'theta', exact: true }).fill('30 * DEGREES')
    await page.getByRole('textbox', { name: 'theta', exact: true }).press('Tab')
    await page.getByTitle('Code', { exact: true }).click()
    await expect(page.locator('.code-lines')).toContainText('self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)')
    await page.getByTitle('Canvas', { exact: true }).click()
    await expect(page.getByAltText('Manim frame')).toBeVisible()
    await expect(page.locator('.error-card')).toHaveCount(0)
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).scenes[0].steps[0].phi).toBe('75 * DEGREES')
    expect(JSON.parse(readFileSync(file, 'utf8')).scenes[0].steps[0].theta).toBe('30 * DEGREES')
    // Report invalid expressions at the step, then recover when corrected.
    await page.getByRole('textbox', { name: 'phi', exact: true }).fill('75 *')
    await page.getByRole('textbox', { name: 'phi', exact: true }).press('Enter')
    await expect(page.locator('.error-card')).toContainText('phi:')
    await page.getByRole('textbox', { name: 'phi', exact: true }).fill('PI / 2')
    await page.getByRole('textbox', { name: 'phi', exact: true }).press('Enter')
    await expect(page.locator('.error-card')).toHaveCount(0)
    // Reopen the saved project through the same event as File → Open.
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).scenes[0].steps[0].phi).toBe('PI / 2')
    await app.evaluate(({ BrowserWindow }, saved) => BrowserWindow.getAllWindows()[0]!.webContents.send('file:opened', saved), { path: file, content: readFileSync(file, 'utf8') })
    await page.getByTitle('camera camera orientation', { exact: true }).locator('.marker-label').click()
    await expect(page.getByRole('textbox', { name: 'phi', exact: true })).toHaveValue('PI / 2')
    await expect(page.getByRole('textbox', { name: 'theta', exact: true })).toHaveValue('30 * DEGREES')
  } finally {
    await app.close()
  }
})
