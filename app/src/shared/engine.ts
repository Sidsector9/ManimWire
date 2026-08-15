// Types shared by the main process, the preload bridge, and the renderer.
// Message payload types are generated from the engine's JSON Schema (pnpm generate).

import type { EngineInfo } from './generated/engine_info'

export type { Catalogue, ColorEntry, Descriptor, Parameter, PortType, TypeRef } from './generated/catalogue'
export type { EngineInfo }

export type EngineState = 'starting' | 'ready' | 'restarting' | 'stopped'

export interface EngineStatus {
  state: EngineState
  attempt: number
  info?: EngineInfo
  message?: string
}

export interface EngineApi {
  call(method: string, params?: unknown): Promise<unknown>
  onStatus(listener: (status: EngineStatus) => void): () => void
}
