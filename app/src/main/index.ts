import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { EngineCallResult, MenuAction } from '../shared/engine'
import { EngineSupervisor, spawnDevelopmentEngine } from './engine'

const here = path.dirname(fileURLToPath(import.meta.url))
// out/main -> app -> repository root
const repoRoot = path.resolve(here, '..', '..', '..')

const supervisor = new EngineSupervisor({
  spawn: () => spawnDevelopmentEngine(repoRoot),
  log: (line) => process.stderr.write(`[engine] ${line}`)
})

// Preview frames live in the engine's temporary cache. The renderer loads them
// through this scheme because file: URLs are blocked from the app's own origin.
protocol.registerSchemesAsPrivileged([{ scheme: 'mnw', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const temporaryRoot = realpathSync(os.tmpdir())

function frameFile(url: string): string | null {
  const filePath = decodeURI(new URL(url).pathname)
  if (!filePath.endsWith('.png')) return null
  try {
    return realpathSync(filePath).startsWith(temporaryRoot) ? filePath : null
  } catch {
    return null
  }
}

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
      }, Number(process.env['MNW_CAPTURE_DELAY'] ?? 4000))
    })
  }
  // Development and test aid: MNW_OPEN=<file.mnw> opens a project at start.
  const openPath = process.env['MNW_OPEN']
  if (openPath) {
    window.webContents.once('did-finish-load', async () => {
      window.webContents.send('file:opened', { path: openPath, content: await readFile(openPath, 'utf8') })
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

function send(action: MenuAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu', action)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Errors are returned as data: a rejected handle() keeps only the message,
// and the renderer needs the engine's error code and location data.
ipcMain.handle('engine:call', async (_event, method: string, params?: unknown): Promise<EngineCallResult> => {
  try {
    return { ok: true, result: await supervisor.call(method, params) }
  } catch (error) {
    const failure = error as { code?: number; message?: string; data?: unknown }
    return { ok: false, error: { code: failure.code ?? -1, message: failure.message ?? String(error), data: failure.data } }
  }
})
ipcMain.handle('engine:status', () => supervisor.getStatus())

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog({ filters: [{ name: 'Manim Node project', extensions: ['mnw'] }], properties: ['openFile'] })
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return null
  return { path: filePath, content: await readFile(filePath, 'utf8') }
})
ipcMain.handle('file:saveAs', async (_event, current: string | null) => {
  const result = await dialog.showSaveDialog({
    defaultPath: current ?? path.join(app.getPath('documents'), 'untitled.mnw'),
    filters: [{ name: 'Manim Node project', extensions: ['mnw'] }]
  })
  return result.canceled || !result.filePath ? null : result.filePath
})
ipcMain.handle('file:write', (_event, filePath: string, content: string) => writeFile(filePath, content, 'utf8'))
ipcMain.handle('file:chooseDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  const directory = result.filePaths[0]
  return result.canceled || !directory ? null : directory
})
ipcMain.handle('file:saveText', async (_event, defaultName: string, extension: string, content: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: `${extension} file`, extensions: [extension] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, content, 'utf8')
  return result.filePath
})
ipcMain.handle('file:openText', async (_event, extension: string) => {
  const result = await dialog.showOpenDialog({ filters: [{ name: `${extension} file`, extensions: [extension] }], properties: ['openFile'] })
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return null
  return { path: filePath, content: await readFile(filePath, 'utf8') }
})
ipcMain.handle('file:openExternal', (_event, url: string) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : Promise.resolve()))
ipcMain.handle('file:reveal', (_event, filePath: string) => shell.showItemInFolder(filePath))

// Tests and scratch sessions can keep their preferences apart from the user's.
if (process.env['MNW_USER_DATA']) app.setPath('userData', process.env['MNW_USER_DATA'])

app.whenReady().then(() => {
  protocol.handle('mnw', (request) => {
    const file = frameFile(request.url)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('not found', { status: 404 })
  })
  supervisor.onStatus((status) => {
    process.stderr.write(`[engine status] ${JSON.stringify(status)}\n`)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('engine:status', status)
    }
  })
  supervisor.onNotification((method, params) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('engine:notification', method, params)
    }
  })
  buildMenu()
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
