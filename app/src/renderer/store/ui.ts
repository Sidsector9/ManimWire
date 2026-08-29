import { create } from 'zustand'

// Workspace preferences from the handoff's state table: layout, split ratio,
// node density, and the view. Layout, split, and density are kept in localStorage;
// the view starts on the canvas every launch. Nothing here is part of the project.

export type Layout = 'stacked' | 'side'
export type View = 'canvas' | 'code'
export type NodeDensity = 'compact' | 'comfortable'

export const SPLIT_MIN = 0.28
export const SPLIT_MAX = 0.62

interface UiStore {
  layout: Layout
  splitRatio: number
  nodeDensity: NodeDensity
  view: View
  setLayout(layout: Layout): void
  setSplitRatio(ratio: number): void
  setNodeDensity(density: NodeDensity): void
  setView(view: View): void
}

const KEY = 'mnw.ui'

function load(): Partial<Pick<UiStore, 'layout' | 'splitRatio' | 'nodeDensity'>> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<UiStore>) : {}
  } catch {
    return {}
  }
}

function persist(state: UiStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ layout: state.layout, splitRatio: state.splitRatio, nodeDensity: state.nodeDensity }))
  } catch {
    // Storage can be unavailable; preferences then last for the session only.
  }
}

export const useUiStore = create<UiStore>((set, get) => {
  const saved = load()
  const update = (change: Partial<UiStore>): void => {
    set(change)
    persist(get())
  }
  return {
    layout: saved.layout ?? 'stacked',
    splitRatio: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, saved.splitRatio ?? 0.4)),
    nodeDensity: saved.nodeDensity ?? 'compact',
    view: 'canvas',
    setLayout: (layout) => update({ layout }),
    setSplitRatio: (ratio) => update({ splitRatio: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)) }),
    setNodeDensity: (nodeDensity) => update({ nodeDensity }),
    setView: (view) => update({ view })
  }
})
