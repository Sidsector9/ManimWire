import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Runs against the built app: `pnpm build` first.
test('a connection goes away with the Delete key, or when its end is dragged off the socket', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, MNW_USER_DATA: mkdtempSync(path.join(tmpdir(), 'mnw-e2e-')) } })
  const window = await app.firstWindow()
  try {
    await expect(window.locator('.status')).toContainText('engine ready')
    await window.getByRole('button', { name: 'Start with a circle' }).click()
    const edges = window.locator('.react-flow__edge')
    await expect(edges).toHaveCount(2)

    // Click the connection, press Delete.
    await edges.first().click()
    await expect(window.locator('.react-flow__edge.selected')).toHaveCount(1)
    await window.keyboard.press('Delete')
    await expect(edges).toHaveCount(1)

    // Grab the remaining connection at the socket it plugs into, drag it away, release on empty space.
    const id = (await edges.first().getAttribute('data-id'))! // "source->target.port"
    const [target, port] = id.slice(id.indexOf('->') + 2).split('.')
    const handle = window.locator(`[data-nodeid="${target}"][data-handleid="${port}"]`)
    const box = (await handle.boundingBox())!
    await window.mouse.move(box.x - 6, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(box.x - 200, box.y + 200, { steps: 8 })
    await window.mouse.up()
    await expect(edges).toHaveCount(0)
  } finally {
    await app.close()
  }
})
