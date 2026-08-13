import { describe, expect, it } from 'vitest'
import { describeEngine, describeLatex, useEngineStore } from './engine'

const info = { python: '3.12.6', manim: '0.21.0', latex: true, dvisvgm: false }

describe('engine status text', () => {
  it('shows versions when ready', () => {
    expect(describeEngine({ state: 'ready', attempt: 0, info })).toBe(
      'engine ready · Manim CE 0.21.0 · Python 3.12.6'
    )
  })

  it('shows the restart attempt', () => {
    expect(describeEngine({ state: 'restarting', attempt: 3 })).toBe('engine restarting (attempt 3)')
  })

  it('needs both latex and dvisvgm for LaTeX to count as available', () => {
    expect(describeLatex({ state: 'ready', attempt: 0, info })).toBe('LaTeX not found')
    expect(describeLatex({ state: 'ready', attempt: 0, info: { ...info, dvisvgm: true } })).toBe(
      'LaTeX available'
    )
    expect(describeLatex({ state: 'starting', attempt: 0 })).toBe('checking LaTeX…')
  })

  it('stores status updates', () => {
    useEngineStore.getState().setStatus({ state: 'ready', attempt: 0, info })
    expect(useEngineStore.getState().status.state).toBe('ready')
  })
})
