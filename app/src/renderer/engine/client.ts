// The engine RPC as seen from the renderer. Errors keep the engine's code and
// location data, which a rejected IPC call would drop.

export class EngineError extends Error {
  code: number
  data: unknown

  constructor(error: { code: number; message: string; data?: unknown }) {
    super(error.message)
    this.name = 'EngineError'
    this.code = error.code
    this.data = error.data
  }
}

export async function call<T>(method: string, params?: unknown): Promise<T> {
  const result = await window.engine.call(method, params)
  if (result.ok) return result.result as T
  throw new EngineError(result.error)
}
