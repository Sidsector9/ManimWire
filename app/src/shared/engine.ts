// Types shared by the main process, the preload bridge, and the renderer.
// From phase 1 on, message types are generated from the engine's JSON Schema.

export interface EngineInfo {
  python: string
  manim: string
  latex: boolean
  dvisvgm: boolean
}

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
