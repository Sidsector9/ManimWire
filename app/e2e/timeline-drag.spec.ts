import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
const steps = async (head: { innerText: () => Promise<string> }): Promise<number> =>
  Number(/(\d+) steps/.exec(await head.innerText())![1])

/** How many animation bars sit inside a span of the strip. */
async function barsWithin(bars: { all: () => Promise<Array<{ boundingBox: () => Promise<{ x: number; width: number } | null> }>> }, from: number, to: number): Promise<number> {
  const boxes = await Promise.all((await bars.all()).map((bar) => bar.boundingBox()))
  return boxes.filter((box) => box !== null && box.x + box.width / 2 >= from && box.x + box.width / 2 < to).length
}

test('dragging an animation to a step boundary opens a gap and lands as its own step', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/size-and-rotation-breakdown.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const head = window.locator('.timeline-head')
    await expect(head).toContainText('steps')
    const before = await steps(head)

    const bar = window.locator('.timeline-bar.depth-0:not(.group):not(.scene-level)').first()
    await bar.scrollIntoViewIfNeeded()
    const box = (await bar.boundingBox())!
    const boundary = (await window.locator('.timeline-step').nth(2).boundingBox())!

    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(boundary.x + 3, box.y + box.height / 2, { steps: 8 })

    // The carried copy follows the pointer, its place stays dimmed, and the gap opens.
    await expect(window.locator('.timeline-bar.carried')).toHaveCount(1)
    await expect(window.locator('.timeline-bar.held')).toHaveCount(1)
    await expect(window.locator('.timeline-drop-gap')).toHaveCount(1)

    await window.mouse.up()
    await expect(window.locator('.timeline-drop-gap')).toHaveCount(0)
    await expect(window.locator('.timeline-bar.carried')).toHaveCount(0)
    await expect.poll(() => steps(head)).toBe(before + 1)
  } finally {
    await app.close()
  }
})

test('dropping an animation onto the middle of another play step joins it', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/size-and-rotation-breakdown.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const head = window.locator('.timeline-head')
    await expect(head).toContainText('steps')
    const before = await steps(head)

    const bar = window.locator('.timeline-bar.depth-0:not(.group):not(.scene-level)').first()
    await bar.scrollIntoViewIfNeeded()
    const box = (await bar.boundingBox())!
    // A play step is the only kind an animation can join, and the last one is never the source.
    const into = (await window.locator('.timeline-step.step-play').last().boundingBox())!
    const bars = window.locator('.timeline-bar')
    const inside = await barsWithin(bars, into.x, into.x + into.width)

    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(into.x + into.width / 2, box.y + box.height / 2, { steps: 8 })
    await expect(window.locator('.timeline-drop-gap')).toHaveCount(0)
    await expect(window.locator('.timeline-step.drop')).toHaveCount(1)
    await window.mouse.up()

    // It joined that step rather than making a new one: no step was added, and that
    // step now holds one more bar.
    await expect.poll(() => steps(head)).toBeLessThanOrEqual(before)
    await expect.poll(() => barsWithin(bars, into.x, into.x + into.width)).toBe(inside + 1)
  } finally {
    await app.close()
  }
})

test('a drop is abandoned when the pointer leaves the timeline, and by Escape', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/size-and-rotation-breakdown.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const head = window.locator('.timeline-head')
    await expect(head).toContainText('steps')
    const before = await steps(head)

    const bar = window.locator('.timeline-bar.depth-0:not(.group):not(.scene-level)').first()
    await bar.scrollIntoViewIfNeeded()
    const box = (await bar.boundingBox())!
    const graph = (await window.locator('.graph').boundingBox())!
    const boundary = (await window.locator('.timeline-step').nth(2).boundingBox())!

    // Released over the graph rather than the strip: nothing moves.
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(boundary.x + 3, graph.y + graph.height / 2, { steps: 8 })
    await window.mouse.up()
    await expect(window.locator('.timeline-bar.carried')).toHaveCount(0)
    expect(await steps(head)).toBe(before)

    // Escape during the drag drops the gesture and leaves the steps alone.
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(boundary.x + 3, box.y + box.height / 2, { steps: 8 })
    await expect(window.locator('.timeline-drop-gap')).toHaveCount(1)
    await window.keyboard.press('Escape')
    await expect(window.locator('.timeline-drop-gap')).toHaveCount(0)
    await expect(window.locator('.timeline-bar.carried')).toHaveCount(0)
    await window.mouse.up()
    expect(await steps(head)).toBe(before)
  } finally {
    await app.close()
  }
})
