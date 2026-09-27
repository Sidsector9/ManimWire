import type { EngineApi, FilesApi } from '../shared/engine'

import type { DeveloperApi } from '../shared/developer'

declare global {
  interface Window {
    developer: DeveloperApi
    engine: EngineApi
    files: FilesApi
  }
}

export {}
