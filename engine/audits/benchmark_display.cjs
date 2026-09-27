/** Real Electron replay benchmark on every connected display.
 * Build the target app first. Run serially with no other GPU tests:
 * node engine/audits/benchmark_display.cjs examples/00000.mnw /tmp/display.json
 * Optional BENCH_ROOT and PYTHONPATH target an isolated older checkout.
 * Measures image updates/HTTP delivery, not physical display scanout.
 * The first pass after a size change can include frame/cache preparation.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const repository = path.resolve(__dirname, '../..')
const { _electron: electron, expect } = require(path.join(repository, 'app/node_modules/@playwright/test'))

function stats(values) {
  values.sort((a, b) => a - b)
  return {
    n: values.length,
    median: values[Math.floor(values.length / 2)],
    p95: values[Math.floor(values.length * .95)],
    max: values.at(-1)
  }
}
const gaps = (values) => values.slice(1).map((value, index) => value - values[index])

async function main() {
  const root = process.env.BENCH_ROOT || repository
  const project = path.resolve(process.argv[2] || 'examples/00000.mnw')
  const output = path.resolve(process.argv[3] || 'display-playback.json')
  const app = await electron.launch({
    args: [path.join(root, 'app')],
    env: { ...process.env, MNW_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'mnw-display-')), MNW_OPEN: project }
  })
  try {
    const page = await app.firstWindow()
    const displays = await app.evaluate(({ screen, app }) => ({
      displays: screen.getAllDisplays(), gpu: app.getGPUFeatureStatus()
    }))
    console.log(JSON.stringify(displays))
    await expect(page.locator('.status')).toContainText('engine ready', { timeout: 60000 })
    await expect(page.locator('.frame canvas, .frame img')).toBeVisible({ timeout: 60000 })
    await page.evaluate(() => {
      window.measure = { enabled: false, paints: [], transfers: [], rafs: [] }
      for (const method of ['putImageData', 'drawImage']) {
        const original = CanvasRenderingContext2D.prototype[method]
        CanvasRenderingContext2D.prototype[method] = function (...args) {
          const start = performance.now()
          const result = original.apply(this, args)
          if (window.measure.enabled) window.measure.paints.push({ at: start, ms: performance.now() - start })
          return result
        }
      }
      // The pre-migration app uses <img>; the current app uses canvas.
      document.addEventListener('load', (event) => {
        if (window.measure.enabled && event.target.matches?.('.frame img')) {
          window.measure.paints.push({ at: performance.now(), ms: 0 })
        }
      }, true)
      const originalFetch = window.fetch
      window.fetch = async (...args) => {
        const start = performance.now()
        const response = await originalFetch(...args)
        for (const method of ['arrayBuffer', 'blob']) {
          const original = response[method].bind(response)
          response[method] = async () => {
            const body = await original()
            if (window.measure.enabled) window.measure.transfers.push({
              at: start, ms: performance.now() - start,
              bytes: body.byteLength ?? body.size, url: String(args[0])
            })
            return body
          }
        }
        return response
      }
      const tick = (time) => {
        if (window.measure.enabled) window.measure.rafs.push(time)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const rows = []
    for (const display of displays.displays) {
      for (const size of ['same', 'large']) {
        const area = display.workArea
        const width = size === 'same' ? 1400 : Math.min(area.width, 3200)
        const height = size === 'same' ? 850 : Math.min(area.height, 1450)
        await app.evaluate(({ BrowserWindow }, bounds) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds(bounds)
          window.focus()
        }, { x: area.x + 20, y: area.y + 20, width, height })
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await page.evaluate(() => window.engine.call('ping'))
        for (let pass = 0; pass < 3; pass++) {
          await page.getByTitle('Play', { exact: true }).click()
          await page.evaluate(() => {
            window.measure = { enabled: true, paints: [], transfers: [], rafs: [], start: performance.now() }
          })
          await expect(page.getByTitle('Play', { exact: true })).toBeVisible({ timeout: 60000 })
          const measured = await page.evaluate(() => {
            window.measure.enabled = false
            return {
              ...window.measure, end: performance.now(), dpr: devicePixelRatio,
              width: document.querySelector('.frame canvas')?.width, view: [innerWidth, innerHeight]
            }
          })
          const row = {
            display: display.label, size, pass, duration: measured.end - measured.start,
            dpr: measured.dpr, width: measured.width, view: measured.view,
            paints: stats(gaps(measured.paints.map((sample) => sample.at))),
            draw: stats(measured.paints.map((sample) => sample.ms)),
            raf: stats(gaps(measured.rafs)),
            transfer: stats(measured.transfers.map((sample) => sample.ms)),
            unique: new Set(measured.transfers.map((sample) => sample.url)).size,
            bytes: measured.transfers.reduce((total, sample) => total + sample.bytes, 0)
          }
          rows.push(row)
          console.log(JSON.stringify(row))
        }
      }
    }
    fs.writeFileSync(output, JSON.stringify({ displays, rows }, null, 2))
  } finally {
    await app.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
