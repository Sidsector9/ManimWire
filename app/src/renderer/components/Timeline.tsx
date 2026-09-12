import { useEffect, useRef, useState } from 'react'
import { HEADER_HEIGHT, placeBands, placeBars, placeMarkers, ROW_HEIGHT, rowLabels, stepAt, ticks, timeToX, xToTime } from '../model/timeline'
import type { AnimationDrop } from '../model/document'
import { previewScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { Icon } from './Icon'

const LABEL_WIDTH = 108
const MIN_RUN_TIME = 0.1
// How wide the gap opens when an animation would land between two steps.
const DROP_GAP = 44

type Drag =
  | { kind: 'playhead' }
  | { kind: 'resize'; node: string; step: number; startX: number }
  | { kind: 'move'; node: string; step: number }

/** When things happen, from the engine's layout. Drags edit the document; the engine re-lays out. */
export function Timeline() {
  const layout = useEngineResults((s) => s.layout)
  const frame = useEngineResults((s) => s.frame)
  const previewTime = useEngineResults((s) => s.previewTime)
  const setPreviewTime = useEngineResults((s) => s.setPreviewTime)
  const playing = useEngineResults((s) => s.playing)
  const loop = useEngineResults((s) => s.loop)
  const setPlaying = useEngineResults((s) => s.setPlaying)
  const setLoop = useEngineResults((s) => s.setLoop)
  const [ghost, setGhost] = useState<{ node: string; step: number; end: number } | null>(null)
  const scene = useDocumentStore(previewScene)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const store = useDocumentStore()
  const selectedStep = useDocumentStore((s) => s.selectedStep)
  const selected = useDocumentStore((s) => s.selected)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(96)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [drop, setDrop] = useState<AnimationDrop | null>(null)
  const [dragX, setDragX] = useState<number | null>(null)
  const area = useRef<HTMLDivElement>(null)
  // Escape abandons a drag. Registered before the early returns below, or the hook
  // count would change once a layout arrives.
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setDrag(null)
      setGhost(null)
      setDrop(null)
      setDragX(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])
  const geometry = { labelWidth: LABEL_WIDTH, pixelsPerSecond }

  if (editingGroup) {
    return (
      <section className="panel timeline">
        <div className="panel-head">
          <span>Timeline</span>
          <span className="mono timeline-meta">groups have no steps; the timeline belongs to the scene</span>
        </div>
      </section>
    )
  }
  if (!layout) {
    return (
      <section className="panel timeline">
        <div className="panel-head">
          <span>Timeline</span>
        </div>
      </section>
    )
  }

  const rows = rowLabels(layout)
  const bars = placeBars(layout, geometry)
  const markers = placeMarkers(layout, geometry)
  const bands = placeBands(layout, geometry)
  const playhead = previewTime ?? layout.total
  const width = Math.max(timeToX(geometry, layout.total) + 120, 600)
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT

  const timeAt = (clientX: number): number => {
    const rect = area.current?.getBoundingClientRect()
    return xToTime(geometry, clientX - (rect?.left ?? 0) + (area.current?.scrollLeft ?? 0))
  }

  // Scrubbing shows frames as the playhead moves: cached frames at once, others as the
  // engine finishes them (requests are dropped while one is in flight), not only on release.
  const scrubTo = (time: number): void => {
    const clamped = Math.min(time, layout.total)
    setPreviewTime(clamped)
    const { doc, sceneIndex } = useDocumentStore.getState()
    void useEngineResults.getState().showFrame(doc, sceneIndex, clamped)
  }

  // The pointer is captured where a drag begins, so moving outside the timeline, or
  // outside the window, keeps the grab until the button is released.
  const startDrag = (e: React.PointerEvent, next: Drag): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(next)
  }

  /** Near a boundary the animation lands between two steps; in the middle it joins one. */
  const dropAt = (time: number): AnimationDrop => {
    const index = time >= layout.total ? null : stepAt(layout, time)
    const step = index === null ? undefined : layout.steps.find((s) => s.index === index)
    if (!step) return { kind: 'before', step: scene.steps.length }
    const edge = Math.min(0.25, (step.end - step.start) / 3)
    if (time < step.start + edge) return { kind: 'before', step: step.index }
    if (time > step.end - edge) return { kind: 'before', step: step.index + 1 }
    return step.kind === 'play' ? { kind: 'into', step: step.index } : { kind: 'before', step: step.index }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const time = timeAt(e.clientX)
    if (drag.kind === 'playhead') scrubTo(time)
    else if (drag.kind === 'resize') {
      const bar = layout.bars.find((b) => b.node === drag.node && b.step === drag.step)
      if (!bar) return
      const runTime = Math.max(MIN_RUN_TIME, Math.round((time - bar.start) * 20) / 20)
      setGhost({ node: drag.node, step: drag.step, end: bar.start + runTime })
      const step = scene.steps[drag.step]
      if (bar.depth === 0 && step?.kind === 'play' && step.run_time != null) {
        store.updateStep(drag.step, { ...step, run_time: runTime })
      } else store.setValue(drag.node, 'run_time', runTime)
    } else {
      setDrop(dropAt(time))
      setDragX(timeToX(geometry, time))
    }
  }

  const endDrag = (): void => {
    setDrag(null)
    setGhost(null)
    setDrop(null)
    setDragX(null)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    // Released away from the strip, the gesture is abandoned: the pointer is captured,
    // so a release over the graph would otherwise reorder the timeline unseen.
    const strip = area.current?.getBoundingClientRect()
    const over = strip !== undefined && e.clientY >= strip.top && e.clientY <= strip.bottom
    if (drag?.kind === 'move' && over) store.moveAnimation(drag.node, drag.step, dropAt(timeAt(e.clientX)))
    endDrag()
  }

  // Everything from the insertion point slides right, opening the gap it would take.
  const opening = drag?.kind === 'move' && drop?.kind === 'before' ? drop.step : null
  const shift = (stepIndex: number): string | undefined => (opening !== null && stepIndex >= opening ? `translateX(${DROP_GAP}px)` : undefined)
  const gapX = opening === null ? 0 : timeToX(geometry, layout.steps.find((s) => s.index === opening)?.start ?? layout.total)
  const held = drag?.kind === 'move' ? bars.find((b) => b.node === drag.node && b.step === drag.step) : undefined

  const stepBoundaries = [...new Set(layout.steps.map((s) => s.start))].sort((a, b) => a - b)
  const jump = (direction: 1 | -1): void => {
    const current = previewTime ?? layout.total
    const next = direction > 0 ? stepBoundaries.find((t) => t > current + 1e-6) : [...stepBoundaries].reverse().find((t) => t < current - 1e-6)
    setPreviewTime(next ?? (direction > 0 ? layout.total : 0))
  }

  return (
    <section className="panel timeline">
      <div className="panel-head timeline-head">
        <span className="transport" role="group" aria-label="Transport">
          <button className={`icon${playing ? ' active' : ''}`} title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
            <Icon name={playing ? 'pause' : 'play'} size={11} />
          </button>
          <button
            className="icon"
            title="Stop: back to the start"
            onClick={() => {
              setPlaying(false)
              setPreviewTime(0)
            }}
          >
            <Icon name="stop" size={11} />
          </button>
          <button className="icon" title="Previous step" onClick={() => jump(-1)}>
            <Icon name="previous" size={11} />
          </button>
          <button className="icon" title="Next step" onClick={() => jump(1)}>
            <Icon name="next" size={11} />
          </button>
          <button className={`icon${loop ? ' active' : ''}`} title="Loop" onClick={() => setLoop(!loop)}>
            <Icon name="loop" size={11} />
          </button>
        </span>
        <span className="timeline-label">TIMELINE</span>
        <span className="mono timeline-meta">
          {layout.error
            ? `no timeline: ${layout.error}`
            : `${(frame?.time ?? playhead).toFixed(2)} s / ${layout.total.toFixed(2)} s · ${scene.steps.length} steps · ${layout.sections.length} sections`}
        </span>
        <span className="timeline-actions">
          <button className="button small" onClick={() => store.addStep({ kind: 'wait', duration: 1 })}>
            + wait
          </button>
          <button className="button small" onClick={() => store.addStep({ kind: 'section', name: `section ${layout.sections.length + 1}`, skip_animations: false })}>
            + section
          </button>
          <button className="button small" onClick={() => store.addStep({ kind: 'sound', file: 'sound.wav', time_offset: 0, gain: null })}>
            + sound
          </button>
          <button className="button small" onClick={() => store.addStep({ kind: 'subcaption', content: 'caption', duration: 1, offset: 0 })}>
            + subcaption
          </button>
          {scene.scene_type === 'ThreeDScene' && (
            <>
              <button className="button small" onClick={() => store.addStep({ kind: 'camera', action: 'orient', phi: 1.2, theta: -0.8 })}>
                + camera orientation
              </button>
              <button className="button small" onClick={() => store.addStep({ kind: 'camera', action: 'move', theta: 0.5, run_time: 2 })}>
                + move camera
              </button>
            </>
          )}
          <button className="button small" onClick={() => setPixelsPerSecond((p) => Math.max(24, p / 1.5))}>
            −
          </button>
          <button className="button small" onClick={() => setPixelsPerSecond((p) => Math.min(480, p * 1.5))}>
            +
          </button>
        </span>
      </div>
      <div
        className="timeline-area"
        ref={area}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="timeline-canvas" style={{ width, height }}>
          <div className="timeline-labels" style={{ width: LABEL_WIDTH }}>
            <div className="timeline-corner" />
            {rows.map((row, i) => (
              <div
                key={row.id}
                className={`timeline-row-label${i === 0 ? ' scene mono' : ''}`}
                style={{ top: HEADER_HEIGHT + i * ROW_HEIGHT }}
                onClick={() => i > 0 && store.select(row.id)}
              >
                {row.label}
              </div>
            ))}
          </div>

          {layout.sections.map((section) => (
            <div
              key={`${section.name}-${section.start}`}
              className={`timeline-section${section.skip_animations ? ' skipped' : ''}`}
              style={{ left: timeToX(geometry, section.start), width: (section.end - section.start) * pixelsPerSecond }}
              title={section.skip_animations ? 'skip_animations' : undefined}
            >
              {section.name}
            </div>
          ))}

          <div
            className="timeline-ticks"
            onPointerDown={(e) => {
              startDrag(e, { kind: 'playhead' })
              scrubTo(timeAt(e.clientX))
            }}
          >
            {ticks(layout, geometry).map((t) => (
              <span key={t} className="tick mono" style={{ left: timeToX(geometry, t) }}>
                {t}s
              </span>
            ))}
          </div>

          {rows.map((row, i) => (
            <div key={row.id} className={`timeline-row${i === 0 ? ' scene' : ''}`} style={{ top: HEADER_HEIGHT + i * ROW_HEIGHT, left: LABEL_WIDTH, width: width - LABEL_WIDTH }} />
          ))}

          {bands.map((band, i) => (
            <div key={i} className="timeline-band" style={{ left: band.x, top: HEADER_HEIGHT + band.y, width: band.width, height: ROW_HEIGHT }} title="updaters running" />
          ))}

          {layout.steps.map((step) => (
            <div
              key={step.index}
              className={`timeline-step step-${step.kind}${selectedStep === step.index ? ' selected' : ''}${drop?.kind === 'into' && drop.step === step.index ? ' drop' : ''}${opening !== null ? ' sliding' : ''}`}
              style={{
                left: timeToX(geometry, step.start),
                width: Math.max(2, (step.end - step.start) * pixelsPerSecond),
                top: HEADER_HEIGHT,
                height: rows.length * ROW_HEIGHT,
                transform: shift(step.index)
              }}
              onClick={() => store.selectStep(step.index)}
              title={step.label}
            >
              {step.kind === 'wait' && <span className="wait-label">{step.label}</span>}
            </div>
          ))}

          {bars.map((bar) => (
            <div
              key={`${bar.step}-${bar.node}`}
              className={`timeline-bar${bar.group ? ' group' : ''}${selected === bar.node ? ' selected' : ''}${bar.node ? '' : ' scene-level'}${held === bar ? ' held' : ''}${opening !== null ? ' sliding' : ''} depth-${Math.min(bar.depth, 2)}`}
              style={{ left: bar.x, top: HEADER_HEIGHT + bar.y, width: bar.width, height: bar.height, transform: shift(bar.step) }}
              onPointerDown={(e) => {
                e.stopPropagation()
                store.selectStep(bar.step)
                // A scene-level bar (move_camera) has no node; edit it through its step.
                if (!bar.node) return
                store.select(bar.node)
                // Only top-level animations belong to the play step; children belong to their group.
                if (!bar.group && bar.depth === 0) startDrag(e, { kind: 'move', node: bar.node, step: bar.step })
              }}
              title={`${bar.label}${bar.rateFunc ? ` · ${bar.rateFunc}` : ''}`}
            >
              <span className="bar-label">{bar.label}</span>
              {bar.rateFunc && bar.width > 110 && <span className="bar-rate mono">{bar.rateFunc}</span>}
              {!bar.group && bar.node && (
                <span
                  className="bar-edge"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    startDrag(e, { kind: 'resize', node: bar.node, step: bar.step, startX: e.clientX })
                  }}
                />
              )}
            </div>
          ))}

          {ghost && (
            <div
              className="timeline-bar ghost"
              style={{
                left: timeToX(geometry, layout.bars.find((b) => b.node === ghost.node && b.step === ghost.step)?.start ?? 0),
                top: HEADER_HEIGHT + (bars.find((b) => b.node === ghost.node && b.step === ghost.step)?.y ?? 0),
                width: Math.max(4, (ghost.end - (layout.bars.find((b) => b.node === ghost.node && b.step === ghost.step)?.start ?? 0)) * pixelsPerSecond - 2),
                height: bars.find((b) => b.node === ghost.node && b.step === ghost.step)?.height ?? 16
              }}
            >
              <span className="bar-rate mono">{(ghost.end - (layout.bars.find((b) => b.node === ghost.node && b.step === ghost.step)?.start ?? 0)).toFixed(2)} s</span>
            </div>
          )}

          {opening !== null && (
            <div className="timeline-drop-gap" style={{ left: gapX, width: DROP_GAP, top: HEADER_HEIGHT, height: rows.length * ROW_HEIGHT }} />
          )}

          {held && dragX !== null && (
            <div
              className="timeline-bar carried"
              style={{ left: dragX - held.width / 2, top: HEADER_HEIGHT + held.y, width: held.width, height: held.height }}
            >
              <span className="bar-label">{held.label}</span>
            </div>
          )}

          {markers.map((marker, i) => (
            <div
              key={i}
              className={`timeline-marker kind-${marker.kind}${opening !== null ? ' sliding' : ''}`}
              style={{ left: marker.x, top: HEADER_HEIGHT + marker.y, transform: shift(marker.step) }}
              title={`${marker.kind} ${marker.label}`}
              onClick={() => store.selectStep(marker.step)}
            >
              <span className="marker-label">{marker.kind === 'section' ? '' : `${marker.kind} ${marker.label}`}</span>
            </div>
          ))}

          <div className="timeline-playhead" style={{ left: timeToX(geometry, Math.min(playhead, layout.total)), height }}>
            <span className="playhead-time mono">{Math.min(playhead, layout.total).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
