import { create } from 'zustand'
import type { EngineStatus } from '../../shared/engine'

interface EngineStore {
  status: EngineStatus
  setStatus(status: EngineStatus): void
}

export const useEngineStore = create<EngineStore>((set) => ({
  status: { state: 'stopped', attempt: 0 },
  setStatus: (status) => set({ status })
}))

/** One line for the status bar, derived from the engine status. */
export function describeEngine(status: EngineStatus): string {
  switch (status.state) {
    case 'ready':
      return status.info ? `engine ready · Manim CE ${status.info.manim} · Python ${status.info.python}` : 'engine ready'
    case 'starting':
      return 'engine starting'
    case 'restarting':
      return `engine restarting (attempt ${status.attempt})`
    case 'stopped':
      return 'engine stopped'
  }
}

export function describeLatex(status: EngineStatus): string {
  if (!status.info) return 'checking LaTeX…'
  return status.info.latex && status.info.dvisvgm ? 'LaTeX available' : 'LaTeX not found'
}
