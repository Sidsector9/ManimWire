export interface WindowSize {
  width: number
  height: number
}

export interface DeveloperApi {
  setEnabled(enabled: boolean): Promise<void>
  resize(width: number, height: number): Promise<WindowSize>
  begin(): Promise<void>
  append(chunk: ArrayBuffer): Promise<void>
  finish(): Promise<void>
  save(): Promise<string | null>
  discard(): Promise<void>
}
