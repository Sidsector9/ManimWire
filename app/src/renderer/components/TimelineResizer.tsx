import { useRef } from 'react'
import { useUiStore } from '../store/ui'

/** The grab strip on the timeline's top edge. Dragging it up makes the panel taller. */
export function TimelineResizer() {
  const height = useUiStore((s) => s.timelineHeight)
  const setHeight = useUiStore((s) => s.setTimelineHeight)
  const from = useRef(0)

  return (
    <div
      className="timeline-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Timeline height"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        from.current = e.clientY + height
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setHeight(from.current - e.clientY)
      }}
    />
  )
}
