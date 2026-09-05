import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('the select tool boxes several nodes and drags them together; the hand tool pans instead', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const nodes = window.locator('.react-flow__node')
    await expect(nodes).toHaveCount(3)

    const area = (await window.locator('.react-flow__pane').boundingBox())!
    const sweep = async (): Promise<number> => {
      await window.mouse.move(area.x + 8, area.y + 8)
      await window.mouse.down()
      await window.mouse.move(area.x + area.width - 8, area.y + area.height - 8, { steps: 10 })
      const boxes = await window.locator('.react-flow__selection').count()
      await window.mouse.up()
      return boxes
    }
    const left = async (): Promise<number[]> => Promise.all((await nodes.all()).map(async (n) => (await n.boundingBox())!.x))

    await window.getByRole('button', { name: 'Select: drag to draw a selection box' }).click()
    expect(await sweep()).toBe(1)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)

    // Dragging one selected node carries the others with it.
    const before = await left()
    const first = (await nodes.first().boundingBox())!
    await window.mouse.move(first.x + first.width / 2, first.y + 8)
    await window.mouse.down()
    await window.mouse.move(first.x + first.width / 2 + 70, first.y + 8, { steps: 10 })
    await window.mouse.up()
    const moved = await left()
    for (let i = 0; i < moved.length; i++) expect(moved[i]).toBeGreaterThan(before[i]! + 40)

    // The hand tool draws no box; the drag moves the view, so the nodes shift on screen.
    await window.getByRole('button', { name: 'Hand: drag to move the view' }).click()
    expect(await sweep()).toBe(0)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)
    const panned = await left()
    for (let i = 0; i < panned.length; i++) expect(panned[i]).toBeGreaterThan(moved[i]! + 40)
  } finally {
    await app.close()
  }
})
