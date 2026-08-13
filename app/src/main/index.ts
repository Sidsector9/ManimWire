import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineSupervisor, spawnDevelopmentEngine } from './engine'

const here = path.dirname(fileURLToPath(import.meta.url))
// out/main -> app -> repository root
const repoRoot = path.resolve(here, '..', '..', '..')

const supervisor = new EngineSupervisor({
  spawn: () => spawnDevelopmentEngine(repoRoot),
  log: (line) => process.stderr.write(`[engine] ${line}`)
})

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#08090b',
    webPreferences: {
      preload: path.join(here, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      process.stderr.write(`[renderer ${event.level}] ${event.message}\n`)
    }
  })
  // Development aid: MNW_CAPTURE=<file.png> saves the window and quits.
  const capturePath = process.env['MNW_CAPTURE']
  if (capturePath) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await window.webContents.capturePage()
        await writeFile(capturePath, image.toPNG())
        app.quit()
      }, 4000)
    })
  }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(here, '../renderer/index.html'))
  }
  return window
}

ipcMain.handle('engine:call', (_event, method: string, params?: unknown) =>
  supervisor.call(method, params)
)
ipcMain.handle('engine:status', () => supervisor.getStatus())

app.whenReady().then(() => {
  supervisor.onStatus((status) => {
    process.stderr.write(`[engine status] ${JSON.stringify(status)}\n`)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('engine:status', status)
    }
  })
  supervisor.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => supervisor.stop())
