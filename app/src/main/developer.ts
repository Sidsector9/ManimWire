import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import { mkdtemp, open, copyFile, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { fitContentSize } from './windowSize'

interface State {
  enabled: boolean
  directory?: string
  file?: FileHandle
  ready: boolean
}

export function registerDeveloperTools(): void {
  const states = new Map<number, State>()
  const clean = async (state: State): Promise<void> => {
    await state.file?.close()
    state.file = undefined
    if (state.directory) await rm(state.directory, { recursive: true, force: true })
    state.directory = undefined
    state.ready = false
  }
  const context = (event: Electron.IpcMainInvokeEvent, requireEnabled = true): [BrowserWindow, State] => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown app window.')
    let state = states.get(event.sender.id)
    if (!state) {
      state = { enabled: false, ready: false }
      states.set(event.sender.id, state)
      const owned = state
      const id = event.sender.id
      // Avoid losing an unfinished or unsaved recording on window close/reload.
      event.sender.on('will-prevent-unload', (unload) => {
        if (!owned.directory) unload.preventDefault()
      })
      window.on('closed', () => {
        states.delete(id)
        void clean(owned).catch(console.error)
      })
    }
    if (requireEnabled && !state.enabled) throw new Error('Enable Developer mode first.')
    return [window, state]
  }
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.mainFrame === request.frame)
    const state = window && states.get(window.webContents.id)
    if (request.frame && state?.enabled && state.file && request.videoRequested && !request.audioRequested) {
      callback({ video: request.frame })
    } else callback({})
  })
  ipcMain.handle('developer:enabled', (event, enabled: boolean) => {
    const [window, state] = context(event, false)
    if (typeof enabled !== 'boolean') throw new Error('Invalid setting.')
    if (!enabled && state.directory) throw new Error('Save or discard the recording before disabling Developer mode.')
    state.enabled = enabled
    window.setMinimumSize(enabled ? 200 : 960, enabled ? 200 : 600)
  })
  ipcMain.handle('developer:resize', (event, width: number, height: number) => {
    const [window, state] = context(event)
    if (state.file) throw new Error('Stop recording before resizing the window.')
    if (window.isFullScreen()) throw new Error('Exit full screen before changing window dimensions.')
    if (window.isMaximized()) window.unmaximize()
    const bounds = window.getBounds()
    const content = window.getContentBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const size = fitContentSize(width, height, { width: area.width - (bounds.width - content.width), height: area.height - (bounds.height - content.height) })
    window.setContentSize(size.width, size.height)
    window.center()
    const [actualWidth, actualHeight] = window.getContentSize()
    return { width: actualWidth, height: actualHeight }
  })
  ipcMain.handle('developer:begin', async (event) => {
    const [window, state] = context(event)
    if (state.directory) throw new Error('Save or discard the previous recording first.')
    state.directory = await mkdtemp(path.join(app.getPath('temp'), 'manimwire-recording-'))
    try {
      state.file = await open(path.join(state.directory, 'capture.webm'), 'w')
      window.setResizable(false)
      window.setMaximizable(false)
      window.setFullScreenable(false)
    } catch (error) {
      await clean(state)
      throw error
    }
  })
  ipcMain.handle('developer:append', async (event, chunk: ArrayBuffer) => {
    const [, state] = context(event)
    if (!state.file || !(chunk instanceof ArrayBuffer) || chunk.byteLength > 32 * 1024 * 1024) throw new Error('Invalid recording chunk.')
    await state.file.writeFile(new Uint8Array(chunk))
  })
  const unlock = (window: BrowserWindow): void => {
    window.setResizable(true)
    window.setMaximizable(true)
    window.setFullScreenable(true)
  }
  ipcMain.handle('developer:finish', async (event) => {
    const [window, state] = context(event)
    if (!state.file) throw new Error('No recording is running.')
    await state.file.close()
    state.file = undefined
    state.ready = true
    unlock(window)
  })
  ipcMain.handle('developer:save', async (event) => {
    const [window, state] = context(event)
    if (!state.ready || !state.directory) throw new Error('Stop the recording before saving.')
    const result = await dialog.showSaveDialog(window, {
      defaultPath: path.join(app.getPath('videos'), `ManimWire-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`),
      filters: [{ name: 'WebM video', extensions: ['webm'] }]
    })
    if (result.canceled || !result.filePath) return null
    await copyFile(path.join(state.directory, 'capture.webm'), result.filePath)
    await clean(state)
    return result.filePath
  })
  ipcMain.handle('developer:discard', async (event) => {
    const [window, state] = context(event)
    await clean(state)
    unlock(window)
  })
}
