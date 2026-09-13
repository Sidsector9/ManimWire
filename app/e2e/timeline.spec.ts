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

test('play renders the scene once, then replays it in real time from the cache', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/blue-circle.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.frame img')).toBeVisible()
    await window.getByRole('button', { name: 'Play' }).click()
    await expect(window.getByRole('button', { name: 'Pause' })).toBeVisible()
    // The first pass ends when every frame is rendered; the button reads Play again.
    await expect(window.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 60000 })
    await expect(window.locator('.canvas-chip.time')).toContainText('t = 2.00 s')

    // Second pass: after one second of real time the playhead sits near one second.
    await window.getByRole('button', { name: 'Play' }).click()
    await window.waitForTimeout(1000)
    const chip = await window.locator('.canvas-chip.time').innerText()
    const shown = Number(/t = ([\d.]+) s/.exec(chip)?.[1])
    expect(shown).toBeGreaterThan(0.5)
    expect(shown).toBeLessThan(1.6)
    await window.getByRole('button', { name: 'Stop: back to the start' }).click()
    await expect(window.getByRole('button', { name: 'Play' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the first play runs at the scene speed, not at the speed frames are rendered', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/derivative.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await expect(window.locator('.frame img')).toBeVisible()
    const total = Number(/\/ ([\d.]+) s/.exec(await window.locator('.timeline-head').innerText())![1])
    expect(total).toBeGreaterThan(4)

    // The first pass renders as it goes and the second reads the cache, so they take
    // different work but must take the same time.
    const play = window.locator('.timeline-head .icon[title="Play"]')
    const timePass = async (): Promise<number> => {
      const began = Date.now()
      await play.click()
      await expect(play).toBeVisible({ timeout: 120000 })
      return (Date.now() - began) / 1000
    }
    for (const pass of [1, 2]) {
      const took = await timePass()
      expect(took, `pass ${pass} took ${took.toFixed(1)} s for a ${total} s scene`).toBeGreaterThan(total * 0.8)
      expect(took, `pass ${pass} took ${took.toFixed(1)} s for a ${total} s scene`).toBeLessThan(total * 1.6)
    }
  } finally {
    await app.close()
  }
})
