// Types shared by the main process, the preload bridge, and the renderer.
// Message payload types are generated from the engine's JSON Schema (pnpm generate).

import type { EngineInfo } from './generated/engine_info'

export type { Catalogue, ColorEntry, Descriptor, Parameter, PortType, TypeRef } from './generated/catalogue'
export type { Issue } from './generated/issue'
export type { GeneratedCode } from './generated/generated_code'
export type { FrameResult } from './generated/frame_result'
export type { ExportResult } from './generated/export_result'
export type { TimelineLayout } from './generated/timeline_layout'
export type { CoverageReport } from './generated/coverage_report'
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
  /** Save text to a file the user picks; returns the path or null. */
  saveText(defaultName: string, extension: string, content: string): Promise<string | null>
  /** Read a file the user picks; returns null when cancelled. */
  openText(extension: string): Promise<{ path: string; content: string } | null>
  reveal(path: string): Promise<void>
  /** Open a web page in the user's browser. */
  openExternal(url: string): Promise<void>
  onMenu(listener: (action: MenuAction) => void): () => void
  onOpened(listener: (file: { path: string; content: string }) => void): () => void
}
