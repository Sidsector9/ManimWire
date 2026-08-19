import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineCallResult } from '../../shared/engine'
import { emptyDocument, type Doc } from '../model/document'
import { useEngineResults } from './preview'

/** A controllable stand-in for the engine RPC, the only external boundary here. */
function fakeEngine() {
  const calls: Array<{ method: string; params: { document: Doc; time?: number }; resolve(value: unknown): void }> = []
  const call = (method: string, params: unknown): Promise<EngineCallResult> =>
    new Promise((resolve) => {
      calls.push({ method, params: params as { document: Doc }, resolve: (value) => resolve({ ok: true, result: value }) })
    })
  return { calls, call }
}

const generated = (name: string) => ({ code: `class ${name}`, source_map: { nodes: {}, steps: {}, variables: {} }, issues: [] })
const emptyLayout = { rows: [], steps: [], bars: [], markers: [], sections: [], total: 0 }
const withName = (name: string): Doc => ({ ...emptyDocument(), scenes: [{ name, nodes: [], edges: [], steps: [] }] })

describe('engine results sync', () => {
  const engine = fakeEngine()

  beforeEach(() => {
    vi.stubGlobal('window', { engine: { call: engine.call } })
    engine.calls.length = 0
    useEngineResults.setState({ inFlight: false, pending: null, rendering: false, frame: null, code: '' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('runs one sync at a time and keeps only the latest request while busy', async () => {
    const store = useEngineResults.getState()
    void store.sync(withName('A'), 0)
    void store.sync(withName('B'), 0)
    void store.sync(withName('C'), 0)
    expect(engine.calls.map((c) => c.params.document.scenes[0]!.name)).toEqual(['A'])
    expect(useEngineResults.getState().rendering).toBe(true)

    engine.calls[0]!.resolve(generated('A'))
    await vi.waitFor(() => expect(engine.calls).toHaveLength(2))
    expect(engine.calls[1]!.method).toBe('timeline.layout')
    engine.calls[1]!.resolve(emptyLayout)
    await vi.waitFor(() => expect(engine.calls).toHaveLength(3))
    expect(engine.calls[2]!.method).toBe('render.frame')
    engine.calls[2]!.resolve({ path: '/tmp/a.png', time: 1, bounds: [] })

    // A finished, so only C (not B) runs next.
    await vi.waitFor(() => expect(engine.calls).toHaveLength(4))
    expect(engine.calls[3]!.params.document.scenes[0]!.name).toBe('C')
    engine.calls[3]!.resolve(generated('C'))
    await vi.waitFor(() => expect(engine.calls).toHaveLength(5))
    engine.calls[4]!.resolve(emptyLayout)
    await vi.waitFor(() => expect(engine.calls).toHaveLength(6))
    engine.calls[5]!.resolve({ path: '/tmp/c.png', time: 2, bounds: [] })

    await vi.waitFor(() => expect(useEngineResults.getState().rendering).toBe(false))
    expect(useEngineResults.getState().code).toBe('class C')
    expect(useEngineResults.getState().frame?.path).toBe('/tmp/c.png')
  })

  it('keeps the engine error location for the canvas and code view', async () => {
    vi.stubGlobal('window', {
      engine: {
        call: async (method: string): Promise<EngineCallResult> =>
          method === 'document.generate'
            ? { ok: true, result: generated('A') }
            : method === 'timeline.layout'
              ? { ok: true, result: emptyLayout }
              : { ok: false, error: { code: -32000, message: 'ValueError: bad', data: { node: 'n1', step: null, line: 7 } } }
      }
    })
    await useEngineResults.getState().sync(withName('A'), 0)
    expect(useEngineResults.getState().failure).toEqual({ message: 'ValueError: bad', node: 'n1', step: null, line: 7 })
  })

  it('shows validation issues without rendering', async () => {
    const seen: string[] = []
    vi.stubGlobal('window', {
      engine: {
        call: async (method: string): Promise<EngineCallResult> => {
          seen.push(method)
          if (method === 'timeline.layout') return { ok: true, result: emptyLayout }
          return { ok: true, result: { ...generated('A'), code: '', issues: [{ code: 'missing_required', message: 'needs mobject', node: 'n', port: 'mobject', step: null }] } }
        }
      }
    })
    await useEngineResults.getState().sync(withName('A'), 0)
    expect(seen).toEqual(['document.generate', 'timeline.layout'])
    expect(useEngineResults.getState().issues).toHaveLength(1)
    expect(useEngineResults.getState().failure).toBeNull()
  })
})
