import { _electron as electron, expect as baseExpect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const expect = baseExpect.configure({ timeout: 10_000 })

test('copy and paste nodes with native shortcuts, internal edges, selection, and undo', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  // Invoke the same clipboard commands and renderer messages used by Edit.
  // Playwright key events do not trigger custom native menu accelerators.
  const edit = (action: 'copy' | 'paste' | 'undo' | 'redo') => app.evaluate(({ BrowserWindow }, action) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    if (action === 'copy') contents.copy()
    else if (action === 'paste') contents.paste()
    else contents.send('menu', action)
  }, action)
  const savedClipboard = await app.evaluateHandle(async ({ clipboard, ClipboardItem }) => Promise.all(
    (await clipboard.read()).map(async (item) => new ClipboardItem(Object.fromEntries(
      await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))
    )))
  ))
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const nodes = window.locator('.react-flow__node')
    const selected = window.locator('.react-flow__node.selected')
    const edges = window.locator('.react-flow__edge')
    await expect(nodes).toHaveCount(3)

    await window.locator('.react-flow__node[data-id="circle"] .node-head').click()
    await window.keyboard.press(`${modifier}+c`)
    await expect.poll(async () => app.evaluate(async ({ clipboard }) => {
      try { return JSON.parse(await clipboard.readText()).nodes.length } catch { return 0 }
    }), { timeout: 10000 }).toBe(1)
    const pane = window.locator('.react-flow__pane')
    const area = (await pane.boundingBox())!
    await window.mouse.move(area.x + 30, area.y + area.height - 100)
    await edit('paste')
    await expect(nodes).toHaveCount(4)
    await expect(selected).toHaveCount(1)
    await expect(selected).not.toHaveAttribute('data-id', 'circle')
    await expect(edges).toHaveCount(2)
    await edit('undo')
    await expect(nodes).toHaveCount(3)

    await pane.click({ position: { x: 12, y: 12 } })
    await window.keyboard.press(`${modifier}+a`)
    await expect(selected).toHaveCount(3)
    await edit('copy')
    await window.keyboard.press(`${modifier}+v`)
    await expect(nodes).toHaveCount(6)
    await expect(edges).toHaveCount(4)
    await expect(selected).toHaveCount(3)
    const firstIds = await selected.evaluateAll((items) => items.map((item) => item.getAttribute('data-id')))
    const firstX = (await selected.first().boundingBox())!.x
    // A second paste at the same pointer position creates independent, offset copies.
    await window.keyboard.press(`${modifier}+v`)
    await expect(nodes).toHaveCount(9)
    await expect(edges).toHaveCount(6)
    await expect(selected).toHaveCount(3)
    const nextIds = await selected.evaluateAll((items) => items.map((item) => item.getAttribute('data-id')))
    expect(nextIds.some((id) => firstIds.includes(id))).toBe(false)
    expect((await selected.first().boundingBox())!.x).toBeGreaterThan(firstX)
    await edit('undo')
    await expect(nodes).toHaveCount(6)
    await edit('redo')
    await expect(nodes).toHaveCount(9)
    await expect(edges).toHaveCount(6)

    // Clipboard events from an input inside the graph must keep native text editing.
    const radius = window.locator('.react-flow__node[data-id="circle"] input').first()
    await radius.fill('2')
    await radius.press(`${modifier}+a`)
    await radius.press(`${modifier}+c`)
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('2')
    await radius.press(`${modifier}+v`)
    await expect(radius).toHaveValue('2')
    await expect(nodes).toHaveCount(9)
    // Plain clipboard text does not create graph nodes.
    await pane.click({ position: { x: 12, y: 12 } })
    await window.keyboard.press(`${modifier}+v`)
    await expect(nodes).toHaveCount(9)
  } finally {
    try {
      await app.evaluate(({ clipboard }, saved) => clipboard.write(saved), savedClipboard)
    } finally {
      await app.close()
    }
  }
})
