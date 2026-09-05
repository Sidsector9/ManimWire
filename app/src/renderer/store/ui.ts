import { create } from 'zustand'

// Workspace preferences from the handoff's state table: layout, split ratio,
// node density, and the view. Layout, split, and density are kept in localStorage;
// the view starts on the canvas every launch. Nothing here is part of the project.

export type Layout = 'stacked' | 'side'
export type View = 'canvas' | 'code'
export type NodeDensity = 'compact' | 'comfortable'
/** What dragging on empty canvas does: move the view, or draw a selection box. */
export type Tool = 'hand' | 'select'

export const SPLIT_MIN = 0.28
export const SPLIT_MAX = 0.62

interface UiStore {
  layout: Layout
  splitRatio: number
  nodeDensity: NodeDensity
  tool: Tool
  view: View
  setLayout(layout: Layout): void
  setSplitRatio(ratio: number): void
  setNodeDensity(density: NodeDensity): void
  setTool(tool: Tool): void
  setView(view: View): void
}

const KEY = 'mnw.ui'

function load(): Partial<Pick<UiStore, 'layout' | 'splitRatio' | 'nodeDensity' | 'tool'>> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<UiStore>) : {}
  } catch {
    return {}
  }
}

function persist(state: UiStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ layout: state.layout, splitRatio: state.splitRatio, nodeDensity: state.nodeDensity, tool: state.tool }))
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
    tool: saved.tool ?? 'hand',
    view: 'canvas',
    setLayout: (layout) => update({ layout }),
    setSplitRatio: (ratio) => update({ splitRatio: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)) }),
    setNodeDensity: (nodeDensity) => update({ nodeDensity }),
    setTool: (tool) => update({ tool }),
    setView: (view) => update({ view })
  }
})
