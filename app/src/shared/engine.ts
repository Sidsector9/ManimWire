// Types shared by the main process, the preload bridge, and the renderer.
// Message payload types are generated from the engine's JSON Schema (pnpm generate).

import type { EngineInfo } from './generated/engine_info'

export type { Catalogue, ColorEntry, Descriptor, Parameter, PortType, TypeRef } from './generated/catalogue'
export type { Issue } from './generated/issue'
export type { GeneratedCode } from './generated/generated_code'
export type { FrameResult } from './generated/frame_result'
export type { ExportResult } from './generated/export_result'
export type { TimelineLayout } from './generated/timeline_layout'
export type { EngineInfo }

export type EngineState = 'starting' | 'ready' | 'restarting' | 'stopped'

export interface EngineStatus {
  state: EngineState
  attempt: number
  info?: EngineInfo
  message?: string
}

export type EngineCallResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string; data?: unknown } }

export interface EngineApi {
  call(method: string, params?: unknown): Promise<EngineCallResult>
  status(): Promise<EngineStatus>
  onStatus(listener: (status: EngineStatus) => void): () => void
  onNotification(listener: (method: string, params: unknown) => void): () => void
}

export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'undo' | 'redo' | 'export'

export interface FilesApi {
  open(): Promise<{ path: string; content: string } | null>
  saveAs(current: string | null): Promise<string | null>
  write(path: string, content: string): Promise<void>
  chooseDirectory(): Promise<string | null>
  reveal(path: string): Promise<void>
  onMenu(listener: (action: MenuAction) => void): () => void
  onOpened(listener: (file: { path: string; content: string }) => void): () => void
}
