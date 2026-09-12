import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first. The example has more rows than fit.
const launch = async () =>
  electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/size-and-rotation-breakdown.mnw') }
  })

test('the ruler, the corner and the playhead time stay put while the rows scroll', async () => {
  const app = await launch()
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const area = window.locator('.timeline-area')
    await expect(window.locator('.timeline-row-label').first()).toBeVisible()

    // Put the playhead somewhere its label is worth keeping.
    await window.locator('.timeline-ticks').click({ position: { x: 300, y: 9 } })
    const chrome = async (): Promise<number[]> =>
      Promise.all(
        ['.timeline-ticks', '.timeline-corner', '.playhead-time'].map(async (part) => (await window.locator(part).boundingBox())!.y)
      )

    const row = window.locator('.timeline-row-label').first()
    const rowY = async (): Promise<number> => (await row.boundingBox())!.y
    const restingRow = await rowY()
    const resting = await chrome()
    expect(await area.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    const scrolled = await area.evaluate((el) => {
      el.scrollTop = 200
      return el.scrollTop
    })
    expect(scrolled).toBeGreaterThan(0)
    // The rows moved up by what was scrolled; the chrome did not move at all.
    await expect.poll(rowY).toBe(restingRow - scrolled)
    expect(await chrome()).toEqual(resting)
  } finally {
    await app.close()
  }
})

test('the handle on the timeline edge resizes the panel, within limits', async () => {
  const app = await launch()
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    const panel = window.locator('.timeline')
    const grip = window.locator('.timeline-resizer')
    const height = async (): Promise<number> => (await panel.boundingBox())!.height
    const drag = async (by: number): Promise<void> => {
      const box = (await grip.boundingBox())!
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await window.mouse.down()
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - by, { steps: 8 })
      await window.mouse.up()
    }

    const resting = await height()
    await drag(120)
    await expect.poll(height).toBeGreaterThan(resting + 100)

    // Dragging far past the floor stops at it rather than collapsing the panel.
    await drag(-2000)
    await expect.poll(height).toBe(120)
  } finally {
    await app.close()
  }
})
