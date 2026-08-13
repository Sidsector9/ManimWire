import { contextBridge, ipcRenderer } from 'electron'
import type { EngineApi, EngineStatus } from '../shared/engine'

const engine: EngineApi & { status(): Promise<EngineStatus> } = {
  call: (method, params) => ipcRenderer.invoke('engine:call', method, params),
  status: () => ipcRenderer.invoke('engine:status'),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: EngineStatus): void => listener(status)
    ipcRenderer.on('engine:status', handler)
    return () => ipcRenderer.removeListener('engine:status', handler)
  }
}

contextBridge.exposeInMainWorld('engine', engine)
