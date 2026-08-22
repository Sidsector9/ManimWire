// Pixel geometry for the timeline panel, derived from the engine's layout.
// The engine decides when things happen; this file only decides where to draw them.

import type { TimelineLayout } from '../../shared/engine'

export const SCENE_ROW = 'scene'
export const ROW_HEIGHT = 22
export const HEADER_HEIGHT = 34

export interface Geometry {
  labelWidth: number
  pixelsPerSecond: number
}

export interface BarBox {
  node: string
  step: number
  x: number
  y: number
  width: number
  height: number
  label: string
  rateFunc: string | null
  /** A group with children is drawn as a bracket around them. */
  group: boolean
  depth: number
}

export interface MarkerBox {
  step: number
  kind: string
  x: number
  y: number
  label: string
}

export function timeToX(geometry: Geometry, time: number): number {
  return geometry.labelWidth + time * geometry.pixelsPerSecond
}

export function xToTime(geometry: Geometry, x: number): number {
  return Math.max(0, (x - geometry.labelWidth) / geometry.pixelsPerSecond)
}

export interface RowInfo {
  id: string
  label: string
}

/** Rows: the scene row first, then the engine's object rows (node id plus display label). */
export function rowLabels(layout: TimelineLayout): RowInfo[] {
  return [{ id: SCENE_ROW, label: SCENE_ROW }, ...layout.rows]
}

function rowIndex(rows: RowInfo[], id: string): number {
  const index = rows.findIndex((r) => r.id === id)
  return index === -1 ? 0 : index
}

export function placeBars(layout: TimelineLayout, geometry: Geometry): BarBox[] {
  const rows = rowLabels(layout)
  const parents = new Set(layout.bars.map((b) => b.parent).filter((p): p is string => p !== null && p !== undefined))
  return layout.bars.map((bar) => {
    const indices = bar.rows.length > 0 ? bar.rows.map((r) => rowIndex(rows, r)) : [0]
    const top = Math.min(...indices)
    const bottom = Math.max(...indices)
    const group = parents.has(bar.node)
    return {
      node: bar.node,
      step: bar.step,
      x: timeToX(geometry, bar.start),
      y: top * ROW_HEIGHT + (group ? 1 : 3),
      width: Math.max(4, (bar.end - bar.start) * geometry.pixelsPerSecond - 2),
      height: (bottom - top + 1) * ROW_HEIGHT - (group ? 2 : 6),
      label: bar.label,
      rateFunc: bar.rate_func ?? null,
      group,
      depth: bar.depth ?? 0
    }
  })
}

export function placeMarkers(layout: TimelineLayout, geometry: Geometry): MarkerBox[] {
  const rows = rowLabels(layout)
  return layout.markers.flatMap((marker) => {
    const rowsOf = marker.rows ?? []
    const targets = rowsOf.length > 0 ? rowsOf : [SCENE_ROW]
    return targets.map((row) => ({
      step: marker.step,
      kind: marker.kind,
      x: timeToX(geometry, marker.time),
      y: rowIndex(rows, row) * ROW_HEIGHT + ROW_HEIGHT / 2,
      label: marker.label
    }))
  })
}

/** The step whose span contains the time, preferring the one that starts there. */
export function stepAt(layout: TimelineLayout, time: number): number | null {
  const starting = layout.steps.find((s) => s.start === time && s.kind === 'play')
  if (starting) return starting.index
  const inside = layout.steps.find((s) => s.start <= time && time < s.end)
  return inside ? inside.index : null
}

/** Tick times for the axis, at 1 s or 0.5 s depending on zoom. */
export function ticks(layout: TimelineLayout, geometry: Geometry): number[] {
  const interval = geometry.pixelsPerSecond >= 120 ? 0.5 : 1
  const count = Math.floor(Math.max(layout.total, 1) / interval)
  return Array.from({ length: count + 1 }, (_, i) => i * interval)
}
