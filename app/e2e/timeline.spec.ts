import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('timeline shows rows and bars, scrubs the preview, and edits run_time by dragging', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/lagged-dots.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await expect(window.locator('.timeline-row-label')).toHaveText(['scene', 'Dot 1', 'Dot 2', 'Dot 3'])
    await expect(window.locator('.timeline-bar')).toHaveCount(6)
    await expect(window.locator('.timeline-section')).toHaveText(['intro', 'grow'])
    await expect(window.locator('.frame img')).toBeVisible()

    // Scrub: click the tick strip at 1.5 s. Frames land on frame boundaries, so allow rounding.
    const ticks = window.locator('.timeline-ticks')
    const box = (await ticks.boundingBox())!
    await ticks.click({ position: { x: 108 + 1.5 * 96, y: box.height / 2 } })
    await expect(window.locator('.canvas-chip.time')).toContainText('t = 1.5')

    // Click the top-level FadeIn bar of the first dot: node selected, inspector shows it.
    const bar = window.locator('.timeline-bar', { hasText: 'FadeIn' }).first()
    await bar.click()
    await expect(window.locator('.inspector .panel-head')).toContainText('animation')
    await expect(window.locator('.inspector-path')).toHaveText('FadeIn')

    // Drag its right edge one second further: run_time 2 -> 3 in the generated code.
    const barBox = (await bar.boundingBox())!
    await window.mouse.move(barBox.x + barBox.width - 2, barBox.y + barBox.height / 2)
    await window.mouse.down()
    await window.mouse.move(barBox.x + barBox.width - 2 + 96, barBox.y + barBox.height / 2, { steps: 4 })
    await window.mouse.up()
    await window.getByRole('button', { name: 'Code' }).click()
    // The drop lands on a frame boundary, so accept a small rounding difference around 3 s.
    await expect(window.locator('.code-lines')).toContainText(/FadeIn\(dot, shift=UP, run_time=(2\.[89]\d*|3(\.[0-2]\d*)?)\)/)
  } finally {
    await app.close()
  }
})
