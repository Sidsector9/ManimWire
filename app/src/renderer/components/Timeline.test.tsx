// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addNode, emptyDocument } from '../model/document'
import { useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { Timeline } from './Timeline'

const layout = {
  rows: [{ id: '', label: 'scene', depth: 0 }],
  steps: [{ index: 0, kind: 'wait', start: 0, end: 2, label: 'wait 2 s' }],
  bars: [],
  markers: [],
  sections: [],
  total: 2
}

describe('Timeline drags', () => {
  // jsdom has no pointer capture; the calls are what this asserts.
  const capture = vi.fn()

  beforeEach(() => {
    Element.prototype.setPointerCapture = capture
    Element.prototype.releasePointerCapture = vi.fn()
    capture.mockClear()
    useDocumentStore.setState({ doc: addNode(emptyDocument(), 0, 'Circle', [0, 0], {}, 'c'), editingGroup: null })
    useEngineResults.setState({ layout, previewTime: 0, playing: false, frame: null })
  })
  afterEach(cleanup)

  it('captures the pointer when a scrub starts, so it survives leaving the timeline', () => {
    render(<Timeline />)
    const strip = document.querySelector('.timeline-ticks')!
    fireEvent.pointerDown(strip, { pointerId: 7, clientX: 200 })
    expect(capture).toHaveBeenCalledWith(7)
  })

  it('leaves other clicks in the timeline alone', () => {
    render(<Timeline />)
    fireEvent.click(screen.getByTitle('Play'))
    expect(capture).not.toHaveBeenCalled()
  })
})
