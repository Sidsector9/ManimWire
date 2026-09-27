import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import type { DeveloperApi } from '../src/shared/developer'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('developer mode gates capture, fits window presets and records app interactions', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mnw-recording-test-'))
  const output = path.join(directory, 'capture.webm')
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: directory } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await expect(window.getByRole('group', { name: 'Screen recording' })).toHaveCount(0)
    expect(await window.evaluate(() => (globalThis as unknown as { developer: DeveloperApi }).developer.begin().then(() => '', (error: Error) => error.message))).toContain('Enable Developer mode')
    await window.getByTitle('Settings', { exact: true }).click()
    await window.getByRole('checkbox', { name: 'Developer mode', exact: true }).check()
    await window.getByRole('button', { name: 'Apply size', exact: true }).click()
    const landscape = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
    expect(landscape[0]! / landscape[1]!).toBe(16 / 9)
    await window.getByLabel('Window size preset').selectOption('4')
    await window.getByRole('button', { name: 'Apply size', exact: true }).click()
    await expect.poll(async () => {
      const [w, h] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
      return w! / h!
    }).toBe(9 / 16)
    await window.screenshot({ path: path.join(directory, 'portrait.png') })
    await window.getByLabel('Window size preset').selectOption('0')
    await window.getByRole('button', { name: 'Apply size', exact: true }).click()
    await window.getByRole('button', { name: 'Done', exact: true }).click()
    await window.reload()
    await expect(window.getByRole('button', { name: 'Record app', exact: true })).toBeVisible()
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await window.getByRole('button', { name: 'Record app', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Start with a circle', exact: true }).click()
    await expect(window.locator('.recording-pointer')).toBeVisible()
    await expect(window.locator('.react-flow__node')).toHaveCount(3)
    await expect(window.locator('.developer-recording')).toContainText('00:02')
    await window.getByRole('button', { name: 'Pause recording', exact: true }).click()
    await expect(window.locator('.recording-highlights')).toHaveCount(0)
    expect(await window.evaluate(() => (globalThis as unknown as { developer: DeveloperApi }).developer.resize(1280, 720).then(() => '', (error: Error) => error.message))).toContain('Stop recording')
    await window.getByRole('button', { name: 'Resume recording', exact: true }).click()
    await expect(window.locator('.developer-recording')).toContainText('00:03')
    await window.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Save recording', exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, output)
    await window.getByRole('button', { name: 'Save recording', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Show recording', exact: true })).toBeVisible()
    expect(statSync(output).size).toBeGreaterThan(10_000)
    expect(readFileSync(output).subarray(0, 4).toString('hex')).toBe('1a45dfa3')
    // Decode every frame with the same video library used by the Manim engine.
    const python = path.resolve(process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python')
    const decoded = JSON.parse(execFileSync(python, ['-c',
      'import av,json,sys; c=av.open(sys.argv[1]); frames=list(c.decode(video=0)); print(json.dumps({"width":frames[0].width,"height":frames[0].height,"frames":len(frames)}))', output
    ], { encoding: 'utf8' })) as { width: number; height: number; frames: number }
    expect([decoded.width, decoded.height]).toEqual(landscape)
    expect(decoded.frames).toBeGreaterThan(10)
    await window.getByTitle('Settings', { exact: true }).click()
    await window.getByRole('checkbox', { name: 'Developer mode', exact: true }).uncheck()
    await expect(window.getByRole('group', { name: 'Screen recording' })).toHaveCount(0)
    console.log(`Recording and portrait screenshot: ${directory}`)
  } catch (error) {
    console.log(await window.locator('.developer-recording').innerText().catch(() => 'No controls'))
    await window.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => undefined)
    throw error
  } finally {
    // Ensure cleanup even if a recording assertion fails while beforeunload is guarded.
    await window.evaluate(() => (globalThis as unknown as { developer: DeveloperApi }).developer.discard()).catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
    await app.close()
  }
})
