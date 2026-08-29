import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first. The derivative scene from goal.md section 35.
test('live edges become updaters: bands on the timeline, always_redraw in the code, dot moves when scrubbed', async () => {
  const app = await electron.launch({
    args: [path.resolve('.')],
    env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')), MNW_OPEN: path.resolve('../examples/derivative.mnw') }
  })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await expect(window.locator('.timeline-row-label')).toHaveText(['scene', 'Axes', 'plot f', 'plot df', 'x', 'Dot', 'TangentLine'])
    await expect(window.locator('.timeline-band')).toHaveCount(2)
    await expect(window.locator('.react-flow__edge.live')).toHaveCount(3)
    await expect(window.locator('.frame img')).toBeVisible()

    // Scrub into the sweep: the dot's live position is rendered at that time.
    const ticks = window.locator('.timeline-ticks')
    const box = (await ticks.boundingBox())!
    await ticks.click({ position: { x: 108 + 5 * 96, y: box.height / 2 } })
    await expect(window.locator('.canvas-chip.time')).toContainText('t = 5.0')
    await expect(window.locator('.frame img')).toBeVisible()

    // The Animate node shows its chain; its inspector lists the call with the value.
    await window.locator('.node', { hasText: 'sweep x' }).click()
    await expect(window.locator('.inspector .chain-call')).toContainText('.set_value()')
    await expect(window.locator('.inspector .chain-call input')).toHaveValue('3')

    await window.getByRole('button', { name: 'Code' }).click()
    const code = window.locator('.code-lines')
    await expect(code).toContainText('dot = always_redraw(lambda: Dot(point=axes.coords_to_point(x.get_value(), x.get_value() ** 2), color=YELLOW))')
    await expect(code).toContainText('self.play(x.animate(run_time=4, rate_func=linear).set_value(3))')

    // A live object offers updater steps; adding one puts a marker on the timeline.
    await window.locator('.timeline-row-label', { hasText: 'Dot' }).click()
    await window.getByRole('button', { name: 'suspend updating' }).click()
    await expect(window.locator('.timeline-marker.kind-suspend')).toHaveCount(1)
    await expect(code).toContainText('dot.suspend_updating()')
  } finally {
    await app.close()
  }
})
