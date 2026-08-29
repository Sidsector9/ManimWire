import { useRef } from 'react'
import { useUiStore } from '../store/ui'

/** The 6px bar between preview and graph. Dragging it changes the split ratio (0.28 to 0.62). */
export function Splitter() {
  const layout = useUiStore((s) => s.layout)
  const setSplitRatio = useUiStore((s) => s.setSplitRatio)
  const bar = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    const parent = bar.current?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const move = (event: PointerEvent): void => {
      const ratio = layout === 'side' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height
      setSplitRatio(ratio)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  return (
    <div ref={bar} className="splitter" onPointerDown={onPointerDown} role="separator" aria-orientation={layout === 'side' ? 'vertical' : 'horizontal'}>
      <span className="grabber" />
    </div>
  )
}
