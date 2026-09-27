// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyDocument } from '../model/document'
import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'
import { useEngineSync } from './useEngineSync'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('requests scrub frames on the next display frame while debouncing document edits', async () => {
  vi.useFakeTimers()
  const call = vi.fn(async (method: string) => ({ ok: true, result:
    method === 'document.generate'
      ? { code: 'scene', source_map: { nodes: {}, steps: {}, variables: {}, live: [] }, issues: [] }
      : method === 'timeline.layout'
        ? { rows: [], steps: [], bars: [], markers: [], sections: [], total: 1 }
        : { path: '/tmp/frame.png', time: 0.5, bounds: [] }
  }))
  vi.stubGlobal('engine', { call, onNotification: () => () => {} })
  useDocumentStore.setState({ doc: emptyDocument(), sceneIndex: 0, revision: 1 })
  useEngineResults.setState(useEngineResults.getInitialState())
  useEngineStore.setState({ status: { state: 'ready', attempt: 0 } })
  renderHook(useEngineSync)
  await act(() => vi.advanceTimersByTimeAsync(150))
  call.mockClear()

  act(() => useEngineResults.getState().setPreviewTime(0.5))
  await act(() => vi.advanceTimersByTimeAsync(17))
  expect(call.mock.calls.map(([method]) => method)).toEqual(['render.frame'])
  call.mockClear()

  act(() => useDocumentStore.setState({ revision: 2 }))
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(call).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(50))
  expect(call.mock.calls.map(([method]) => method)).toEqual(['document.generate', 'timeline.layout', 'render.frame'])
})

it('revalidates cached errors after an engine restart without changing the project', async () => {
  vi.useFakeTimers()
  let upgraded = false
  const call = vi.fn(async (method: string) => ({ ok: true, result:
    method === 'document.generate'
      ? { code: upgraded ? 'updated scene' : '', source_map: { nodes: {}, steps: {}, variables: {}, live: [] }, issues: upgraded ? [] : [{ code: 'bad_expression', message: 'List is not allowed in an expression' }] }
      : method === 'timeline.layout'
        ? { rows: [], steps: [], bars: [], markers: [], sections: [], total: 1 }
        : { path: '/tmp/new-engine.png', time: 0.5, bounds: [] }
  }))
  vi.stubGlobal('engine', { call, onNotification: () => () => {} })
  const doc = emptyDocument()
  useDocumentStore.setState({ doc, sceneIndex: 0, revision: 5, dirty: true })
  useEngineResults.setState(useEngineResults.getInitialState())
  useEngineStore.setState({ status: { state: 'ready', attempt: 0 } })
  renderHook(useEngineSync)
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(useEngineResults.getState().issues).toHaveLength(1)
  expect(useEngineResults.getState().synced).toEqual({ revision: 5, sceneIndex: 0 })

  act(() => {
    useEngineResults.setState({ playing: true, prerendered: 'old engine frames' })
    useEngineStore.getState().setStatus({ state: 'restarting', attempt: 1 })
  })
  expect(useEngineResults.getState()).toMatchObject({ playing: false, prerendered: null, synced: null })
  upgraded = true
  act(() => useEngineStore.getState().setStatus({ state: 'ready', attempt: 0 }))
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(call.mock.calls.filter(([method]) => method === 'document.generate')).toHaveLength(2)
  expect(useEngineResults.getState()).toMatchObject({ issues: [], code: 'updated scene', frame: { path: '/tmp/new-engine.png' } })
  expect(useDocumentStore.getState()).toMatchObject({ doc, revision: 5, dirty: true })

  act(() => useEngineResults.getState().setPreviewTime(0.25))
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(call.mock.calls.filter(([method]) => method === 'document.generate')).toHaveLength(2)
  expect(call.mock.calls.at(-1)?.[0]).toBe('render.frame')
})

it('warms an idle preview after displaying it and yields to a scrub', async () => {
  vi.useFakeTimers()
  const listeners = new Set<(method: string, value: unknown) => void>()
  let finish: (value: unknown) => void = () => {}
  const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'document.generate') return { ok: true, result: { code: 'scene', source_map: { nodes: {}, steps: {}, variables: {}, live: [] }, issues: [] } }
    if (method === 'timeline.layout') return { ok: true, result: { rows: [], steps: [], bars: [], markers: [], sections: [], total: 2 } }
    if (method === 'render.sequence') return new Promise((resolve) => { finish = resolve })
    return { ok: true, result: { format: 'rgba', stream: 'scene', path: '/frame', time: params?.time ?? 2, bounds: [] } }
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('engine', {
    call,
    onNotification: (listener: (method: string, value: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  })
  useDocumentStore.setState({ doc: emptyDocument(), sceneIndex: 0, revision: 1 })
  useEngineResults.setState(useEngineResults.getInitialState())
  useEngineStore.setState({ status: { state: 'ready', attempt: 0 } })
  renderHook(useEngineSync)
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(useEngineResults.getState().frame?.path).toBe('/frame')
  expect(useEngineResults.getState().warming).toBe(false)
  await act(() => vi.advanceTimersByTimeAsync(300))
  const request = call.mock.calls.find(([method]) => method === 'render.sequence')!
  expect(request[1]).toMatchObject({ paced: false, start: 0, end: 2 })
  expect(useEngineResults.getState()).toMatchObject({ warming: true, playing: false, rendering: false })
  act(() => listeners.forEach((listener) => listener('render.sequence_started', { request_id: request[1]!.request_id, cancel_url: 'http://localhost/cancel' })))
  expect(fetch).not.toHaveBeenCalled()
  act(() => useEngineResults.getState().setPreviewTime(.5))
  await act(() => vi.advanceTimersByTimeAsync(17))
  expect(fetch).toHaveBeenCalledWith('http://localhost/cancel', { method: 'POST' })
  await act(async () => finish({ ok: true, result: { cancelled: true, cache_complete: false } }))
  expect(useEngineResults.getState()).toMatchObject({ warming: false, playing: false, frame: { time: .5 } })
})

it('does not immediately refill an explicitly cleared cache', async () => {
  vi.useFakeTimers()
  const call = vi.fn(async (method: string) => ({ ok: true, result:
    method === 'document.generate'
      ? { code: 'scene', source_map: { nodes: {}, steps: {}, variables: {}, live: [] }, issues: [] }
      : method === 'timeline.layout'
        ? { rows: [], steps: [], bars: [], markers: [], sections: [], total: 2 }
        : { format: 'rgba', stream: 'scene', path: '/frame', time: 2, bounds: [] }
  }))
  vi.stubGlobal('engine', { call, onNotification: () => () => {} })
  useDocumentStore.setState({ doc: emptyDocument(), sceneIndex: 0, revision: 1 })
  useEngineResults.setState(useEngineResults.getInitialState())
  useEngineStore.setState({ status: { state: 'ready', attempt: 0 } })
  renderHook(useEngineSync)
  await act(() => vi.advanceTimersByTimeAsync(150))
  await act(() => useEngineResults.getState().clearDiskCache())
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(call.mock.calls.map(([method]) => method)).toEqual(['document.generate', 'timeline.layout', 'render.frame', 'cache.clear'])
  act(() => useEngineResults.getState().setPreviewTime(.5))
  await act(() => vi.advanceTimersByTimeAsync(17))
  expect(call.mock.calls.at(-1)?.[0]).toBe('render.frame')
})
