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
  vi.stubGlobal('engine', { call })
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
  vi.stubGlobal('engine', { call })
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
