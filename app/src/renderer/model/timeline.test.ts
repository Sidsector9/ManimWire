import { describe, expect, it } from 'vitest'
import type { TimelineLayout } from '../../shared/engine'
import { placeBars, placeMarkers, ROW_HEIGHT, rowLabels, stepAt, ticks } from './timeline'

const layout: TimelineLayout = {
  rows: [
    { id: 'd1', label: 'Dot 1' },
    { id: 'd2', label: 'Dot 2' }
  ],
  steps: [
    { index: 0, kind: 'play', start: 0, end: 2, label: 'LaggedStart' },
    { index: 1, kind: 'wait', start: 2, end: 3, label: 'wait 1 s' },
    { index: 2, kind: 'add', start: 3, end: 3, label: 'dot' }
  ],
  bars: [
    { step: 0, node: 'lag', rows: ['d1', 'd2'], start: 0, end: 2, label: 'LaggedStart', rate_func: 'linear', parent: null, depth: 0 },
    { step: 0, node: 'f1', rows: ['d1'], start: 0, end: 1, label: 'FadeIn', rate_func: 'smooth', parent: 'lag', depth: 1 },
    { step: 0, node: 'f2', rows: ['d2'], start: 0.5, end: 2, label: 'FadeIn', rate_func: 'smooth', parent: 'lag', depth: 1 },
    { step: 0, node: 'flash', rows: [], start: 0, end: 1, label: 'Flash', rate_func: 'smooth', parent: null, depth: 0 }
  ],
  markers: [{ step: 2, kind: 'add', time: 3, label: 'Dot 1', rows: ['d1'] }],
  sections: [],
  total: 3
}
const geometry = { labelWidth: 100, pixelsPerSecond: 50 }

describe('timeline geometry', () => {
  it('puts the scene row first', () => {
    expect(rowLabels(layout).map((r) => r.label)).toEqual(['scene', 'Dot 1', 'Dot 2'])
  })

  it('places bars by time and row, spanning rows for groups', () => {
    const boxes = placeBars(layout, geometry)
    const group = boxes.find((b) => b.node === 'lag')!
    expect(group.group).toBe(true)
    expect(group.x).toBe(100)
    expect(group.width).toBe(98)
    expect(group.y).toBe(ROW_HEIGHT + 1)
    expect(group.height).toBe(2 * ROW_HEIGHT - 2)
    const child = boxes.find((b) => b.node === 'f2')!
    expect(child.x).toBe(125)
    expect(child.y).toBe(2 * ROW_HEIGHT + 3)
    expect(child.group).toBe(false)
    const objectless = boxes.find((b) => b.node === 'flash')!
    expect(objectless.y).toBe(3) // the scene row
  })

  it('places markers on their rows', () => {
    expect(placeMarkers(layout, geometry)).toEqual([{ step: 2, kind: 'add', x: 250, y: ROW_HEIGHT * 1.5, label: 'Dot 1' }])
  })

  it('finds the step at a time and the axis ticks', () => {
    expect(stepAt(layout, 0)).toBe(0)
    expect(stepAt(layout, 2.5)).toBe(1)
    expect(stepAt(layout, 3)).toBeNull()
    expect(ticks(layout, geometry)).toEqual([0, 1, 2, 3])
    expect(ticks(layout, { ...geometry, pixelsPerSecond: 160 })).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
  })
})
