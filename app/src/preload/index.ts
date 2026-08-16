import { contextBridge, ipcRenderer } from 'electron'
import type { EngineApi, EngineStatus, FilesApi, MenuAction } from '../shared/engine'

const engine: EngineApi = {
  call: (method, params) => ipcRenderer.invoke('engine:call', method, params),
  status: () => ipcRenderer.invoke('engine:status'),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: EngineStatus): void => listener(status)
    ipcRenderer.on('engine:status', handler)
    return () => ipcRenderer.removeListener('engine:status', handler)
  },
  onNotification: (listener) => {
    const handler = (_event: unknown, method: string, params: unknown): void => listener(method, params)
    ipcRenderer.on('engine:notification', handler)
    return () => ipcRenderer.removeListener('engine:notification', handler)
  }
}

const files: FilesApi = {
  open: () => ipcRenderer.invoke('file:open'),
  saveAs: (current) => ipcRenderer.invoke('file:saveAs', current),
  write: (path, content) => ipcRenderer.invoke('file:write', path, content),
  chooseDirectory: () => ipcRenderer.invoke('file:chooseDirectory'),
  reveal: (path) => ipcRenderer.invoke('file:reveal', path),
  onMenu: (listener) => {
    const handler = (_event: unknown, action: MenuAction): void => listener(action)
    ipcRenderer.on('menu', handler)
    return () => ipcRenderer.removeListener('menu', handler)
  },
  onOpened: (listener) => {
    const handler = (_event: unknown, file: { path: string; content: string }): void => listener(file)
    ipcRenderer.on('file:opened', handler)
    return () => ipcRenderer.removeListener('file:opened', handler)
  }
}

contextBridge.exposeInMainWorld('engine', engine)
contextBridge.exposeInMainWorld('files', files)
