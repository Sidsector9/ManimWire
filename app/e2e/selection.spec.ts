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
    const box = window.locator('.react-flow__selection')
    // Asserted while the button is still down, with the retrying form: the box appears
    // a frame or two after the move.
    const sweep = async (boxes: number): Promise<void> => {
      await window.mouse.move(area.x + 8, area.y + 8)
      await window.mouse.down()
      await window.mouse.move(area.x + area.width - 8, area.y + area.height - 8, { steps: 10 })
      await expect(box).toHaveCount(boxes)
      await window.mouse.up()
    }
    const left = async (): Promise<number[]> => Promise.all((await nodes.all()).map(async (n) => (await n.boundingBox())!.x))
    const allPast = async (marks: number[]): Promise<boolean> => (await left()).every((x, i) => x > marks[i]! + 40)

    await window.getByRole('button', { name: 'Select: drag to draw a selection box' }).click()
    await sweep(1)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)

    // Dragging one selected node carries the others with it.
    const before = await left()
    const first = (await nodes.first().boundingBox())!
    await window.mouse.move(first.x + first.width / 2, first.y + 8)
    await window.mouse.down()
    await window.mouse.move(first.x + first.width / 2 + 70, first.y + 8, { steps: 10 })
    await window.mouse.up()
    await expect.poll(() => allPast(before), { message: 'every selected node moved' }).toBe(true)
    const moved = await left()

    // The hand tool draws no box; the drag moves the view, so the nodes shift on screen.
    await window.getByRole('button', { name: 'Hand: drag to move the view' }).click()
    await sweep(0)
    await expect(window.locator('.react-flow__node.selected')).toHaveCount(3)
    await expect.poll(() => allPast(moved), { message: 'the view panned' }).toBe(true)
  } finally {
    await app.close()
  }
})

test('V and H pick the tool from anywhere, but not while typing', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const hand = window.getByRole('button', { name: /^Hand:/ })
    const select = window.getByRole('button', { name: /^Select:/ })
    await expect(hand).toHaveClass(/active/)

    // From the page body, with the pointer away from any field.
    await window.locator('.timeline').click({ position: { x: 5, y: 5 } })
    await window.keyboard.press('v')
    await expect(select).toHaveClass(/active/)
    await window.keyboard.press('h')
    await expect(hand).toHaveClass(/active/)

    // Typing the same letters into a field must leave the tool alone.
    const search = window.getByPlaceholder(/^Search /)
    await search.click()
    await search.type('vh')
    await expect(search).toHaveValue('vh')
    await expect(hand).toHaveClass(/active/)
  } finally {
    await app.close()
  }
})

test('select all takes every node while the graph has focus, and nothing outside it', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  const all = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const nodes = window.locator('.react-flow__node')
    await expect(nodes).toHaveCount(3)
    const selected = window.locator('.react-flow__node.selected')

    // Focus elsewhere: nothing is selected, and the page is not selected either.
    await window.locator('.timeline').click({ position: { x: 5, y: 5 } })
    await window.keyboard.press(all)
    await expect(selected).toHaveCount(0)
    expect(await window.evaluate(() => globalThis.getSelection()?.toString() ?? '')).toBe('')

    await window.locator('.react-flow__pane').click({ position: { x: 12, y: 12 } })
    await window.keyboard.press(all)
    await expect(selected).toHaveCount(3)

    // A text field keeps its own select all.
    const search = window.getByPlaceholder(/^Search /)
    await search.fill('circle')
    await search.press(all)
    await search.press('x')
    await expect(search).toHaveValue('x')
  } finally {
    await app.close()
  }
})
