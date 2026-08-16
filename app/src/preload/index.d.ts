import type { EngineApi, FilesApi } from '../shared/engine'

declare global {
  interface Window {
    engine: EngineApi
    files: FilesApi
  }
}

export {}
