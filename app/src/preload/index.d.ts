import type { EngineApi, EngineStatus } from '../shared/engine'

declare global {
  interface Window {
    engine: EngineApi & { status(): Promise<EngineStatus> }
  }
}

export {}
