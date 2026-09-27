// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineCallResult } from '../../shared/engine'
import { emptyDocument } from '../model/document'
import { useDocumentStore } from '../store/document'
import { cacheKey, useEngineResults } from '../store/preview'
import { usePlayback } from './usePlayback'

describe('playback from the playhead', () => {
  let now: number
  let ticks: FrameRequestCallback[]
  const listeners = new Set<(method: string, params: unknown) => void>()
  const requests: Array<{ method: string; params: Record<string, unknown>; resolve(value: EngineCallResult): void }> = []

  const tick = (milliseconds: number): void => {
    act(() => {
      now += milliseconds
      const pending = ticks
      ticks = []
      pending.forEach((callback) => callback(now))
    })
  }

  const frameReady = (time: number): void => {
    act(() => {
      const frame = { scene: 'Scene1', time, path: `/tmp/frame-${time}.png`, bounds: [], render_ms: 0 }
      listeners.forEach((listener) => listener('render.frame_ready', frame))
    })
  }

  beforeEach(() => {
    now = 0
    ticks = []
    requests.length = 0
    listeners.clear()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => ticks.push(callback))
    vi.stubGlobal('engine', {
      call: (method: string, params: Record<string, unknown>) => new Promise<EngineCallResult>((resolve) => requests.push({ method, params, resolve })),
      onNotification: (listener: (method: string, params: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    })
    useDocumentStore.setState({ doc: emptyDocument(), sceneIndex: 0 })
    useEngineResults.setState({
      ...useEngineResults.getInitialState(),
      code: 'scene',
      previewTime: 1.2,
      layout: {
        rows: [], bars: [], markers: [], sections: [], total: 2,
        steps: [
          { index: 0, kind: 'wait', start: 0, end: 1, label: 'first' },
          { index: 1, kind: 'wait', start: 1, end: 2, label: 'second' }
        ]
      }
    })
  })

  afterEach(async () => {
    cleanup()
    await act(async () => {
      useEngineResults.getState().setPlaying(false)
      requests.forEach((request) => request.resolve({ ok: true, result: {} }))
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('holds the scrub position while rendering, then plays only the remaining interval', async () => {
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'render.sequence', params: { start: 1.2, end: 2 } })

    tick(300)
    expect(useEngineResults.getState().previewTime).toBe(1.2)
    frameReady(1.2)
    frameReady(1.3)
    tick(100)
    expect(useEngineResults.getState().previewTime).toBeCloseTo(1.3)
    expect(useEngineResults.getState().frame?.time).toBe(1.3)

    frameReady(2)
    await act(async () => requests[0]!.resolve({ ok: true, result: {} }))
    tick(800)
    expect(useEngineResults.getState().playing).toBe(false)
    expect(useEngineResults.getState().previewTime).toBe(2)
    expect(useEngineResults.getState().prerendered).toBeNull()
  })

  it('renders multiple timeline steps in one scene execution', async () => {
    useEngineResults.getState().setPreviewTime(0)
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'render.sequence', params: { start: 0, end: 2 } })
    frameReady(2)
    await act(async () => requests[0]!.resolve({ ok: true, result: { cache_complete: false } }))
    tick(2500)
    expect(useEngineResults.getState().playing).toBe(false)
    expect(useEngineResults.getState().prerendered).toBeNull()
    expect(requests).toHaveLength(1)
  })

  it('cancels a busy sequence through the independent control channel', () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    act(() => listeners.forEach((listener) => listener('render.sequence_started', {
      request_id: 1, cancel_url: 'http://127.0.0.1:1234/token/cancel/run'
    })))
    act(() => useEngineResults.getState().setPlaying(false))
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:1234/token/cancel/run', { method: 'POST' })
  })

  it('resumes from the paused time while the next render is pending', () => {
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    frameReady(1.5)
    tick(300)
    act(() => useEngineResults.getState().setPlaying(false))
    expect(useEngineResults.getState().previewTime).toBe(1.5)

    act(() => useEngineResults.getState().setPlaying(true))
    tick(200)
    expect(useEngineResults.getState().previewTime).toBe(1.5)
    expect(requests[1]).toMatchObject({ method: 'render.sequence', params: { start: 1.5, end: 2 } })
  })

  it('starts cached playback at the scrub position too', () => {
    const state = useEngineResults.getState()
    useEngineResults.setState({ prerendered: cacheKey(state.code, state.previewWidth) })
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    tick(100)
    expect(useEngineResults.getState().previewTime).toBeCloseTo(1.3)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'render.frame', params: { time: 1.3 } })
  })

  it.each([2 - 1e-12, 2 - 1 / 60])('finishes when the last frame is at %s, then leaves scrubbing in control', async (lastFrame) => {
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    frameReady(lastFrame)
    await act(async () => requests[0]!.resolve({ ok: true, result: {} }))
    tick(1000)
    expect(useEngineResults.getState().playing).toBe(false)
    expect(useEngineResults.getState().previewTime).toBe(2)

    act(() => useEngineResults.getState().setPreviewTime(0.5))
    tick(100)
    expect(useEngineResults.getState().previewTime).toBe(0.5)
  })

  it('does not advance to the end before the requested interval finishes rendering', async () => {
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    frameReady(1.5)
    tick(1000)
    expect(useEngineResults.getState().previewTime).toBe(1.5)
    expect(useEngineResults.getState().playing).toBe(true)
    await act(async () => requests[0]!.resolve({ ok: true, result: {} }))
    tick(500)
    expect(useEngineResults.getState().playing).toBe(false)
  })

  it('waits for fresh frames when a partial pass loops back to the beginning', async () => {
    useEngineResults.getState().setLoop(true)
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    frameReady(2)
    await act(async () => requests[0]!.resolve({ ok: true, result: {} }))
    tick(800)
    expect(useEngineResults.getState().previewTime).toBe(0)
    expect(useEngineResults.getState().playing).toBe(true)
    expect(requests[1]).toMatchObject({ method: 'render.sequence', params: { start: 0, end: 2 } })
    tick(200)
    expect(useEngineResults.getState().previewTime).toBe(0)
  })
  it.each([[60, 120], [24, 144]])('requests only %i source frames on a %i Hz display', async (fps, hz) => {
    const doc = emptyDocument()
    doc.settings.frame_rate = fps
    useDocumentStore.setState({ doc })
    const state = useEngineResults.getState()
    useEngineResults.setState({ previewTime: 0, prerendered: cacheKey(state.code, state.previewWidth) })
    renderHook(usePlayback)
    act(() => useEngineResults.getState().setPlaying(true))
    for (let i = 0; i < hz; i++) {
      const before = requests.length
      tick(1000 / hz)
      if (requests.length > before) {
        const request = requests.at(-1)!
        await act(async () => request.resolve({ ok: true, result: { path: `/frame-${i}`, time: request.params.time, bounds: [] } }))
      }
    }
    expect(requests).toHaveLength(fps)
    expect(useEngineResults.getState().previewTime).toBeGreaterThan(.95)
  })

})
