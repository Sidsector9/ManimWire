import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('add a selection together and remove individual objects through the Inspector', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  const all = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'
  const undo = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu', 'undo'))
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    for (const name of ['Circle', 'Square', 'Number']) {
      await window.getByPlaceholder(/^Search /).fill(name)
      await window.locator('.library-entry').filter({ has: window.getByText(name, { exact: true }) }).click()
    }
    const nodes = window.locator('.react-flow__node')
    const inspector = window.locator('.inspector')
    const timeline = window.locator('.timeline-meta')
    await expect(nodes).toHaveCount(3)
    await window.locator('.react-flow__pane').click({ position: { x: 12, y: 12 } })
    await window.keyboard.press(all)
    await expect(inspector).toContainText('3 nodes selected')
    await inspector.getByRole('button', { name: 'Add 2 objects to the scene', exact: true }).click()
    await expect(timeline).toContainText('1 steps')
    await expect(inspector.getByRole('button', { name: 'Remove 2 objects from the scene', exact: true })).toBeVisible()
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)
    await undo()
    await expect(timeline).toContainText('0 steps')
    await inspector.getByRole('button', { name: 'Add 2 objects to the scene', exact: true }).click()

    for (const [name, remaining] of [['Circle', 1], ['Square', 0]] as const) {
      await window.locator('.react-flow__pane').click({ position: { x: 12, y: 12 } })
      await nodes.filter({ has: window.locator('.node-title').getByText(name, { exact: true }) }).locator('.node-head').click()
      await inspector.getByRole('button', { name: 'Remove from the scene', exact: true }).click()
      await expect(inspector.getByRole('button', { name: 'Add to the scene', exact: true })).toBeVisible()
      await expect(nodes).toHaveCount(3)
      await expect(timeline).toContainText(`${remaining} steps`)
    }
    await undo()
    await expect(inspector.getByRole('button', { name: 'Remove from the scene', exact: true })).toBeVisible()
    await expect(timeline).toContainText('1 steps')
  } finally {
    await app.close()
  }
})
