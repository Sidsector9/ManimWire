import { useRef, useState } from 'react'
import { HEADER_HEIGHT, placeBars, placeMarkers, ROW_HEIGHT, rowLabels, stepAt, ticks, timeToX, xToTime } from '../model/timeline'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'

const LABEL_WIDTH = 108
const MIN_RUN_TIME = 0.1

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
  const scene = useDocumentStore(currentScene)
  const store = useDocumentStore()
  const selectedStep = useDocumentStore((s) => s.selectedStep)
  const selected = useDocumentStore((s) => s.selected)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(96)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hoverStep, setHoverStep] = useState<number | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const geometry = { labelWidth: LABEL_WIDTH, pixelsPerSecond }

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
  const playhead = previewTime ?? layout.total
  const width = Math.max(timeToX(geometry, layout.total) + 120, 600)
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT

  const timeAt = (clientX: number): number => {
    const rect = area.current?.getBoundingClientRect()
    return xToTime(geometry, clientX - (rect?.left ?? 0) + (area.current?.scrollLeft ?? 0))
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const time = timeAt(e.clientX)
    if (drag.kind === 'playhead') setPreviewTime(Math.min(time, layout.total))
    else if (drag.kind === 'resize') {
      const bar = layout.bars.find((b) => b.node === drag.node && b.step === drag.step)
      if (!bar) return
      const runTime = Math.max(MIN_RUN_TIME, Math.round((time - bar.start) * 20) / 20)
      const step = scene.steps[drag.step]
      if (step?.kind === 'play' && step.run_time != null) store.updateStep(drag.step, { ...step, run_time: runTime })
      else store.setValue(drag.node, 'run_time', runTime)
    } else setHoverStep(stepAt(layout, time))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (drag?.kind === 'move') {
      const time = timeAt(e.clientX)
      const target = time >= layout.total ? null : stepAt(layout, time)
      const targetStep = target !== null ? scene.steps[target] : undefined
      if (target === null || (targetStep?.kind === 'play' && target !== drag.step)) {
        store.moveAnimation(drag.node, drag.step, target)
      }
    }
    setDrag(null)
    setHoverStep(null)
  }

  return (
    <section className="panel timeline">
      <div className="panel-head">
        <span>Timeline</span>
        <span className="mono timeline-meta">
          {`${(frame?.time ?? playhead).toFixed(2)} s / ${layout.total.toFixed(2)} s · ${scene.steps.length} steps`}
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
        onPointerLeave={() => setDrag(null)}
      >
        <div className="timeline-canvas" style={{ width, height }}>
          <div className="timeline-labels" style={{ width: LABEL_WIDTH }}>
            <div className="timeline-corner" />
            {rows.map((row, i) => (
              <div key={row} className={`timeline-row-label mono${i === 0 ? ' scene' : ''}`} style={{ top: HEADER_HEIGHT + i * ROW_HEIGHT }}>
                {row}
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
              setDrag({ kind: 'playhead' })
              setPreviewTime(Math.min(timeAt(e.clientX), layout.total))
            }}
          >
            {ticks(layout, geometry).map((t) => (
              <span key={t} className="tick mono" style={{ left: timeToX(geometry, t) }}>
                {t}s
              </span>
            ))}
          </div>

          {rows.map((row, i) => (
            <div key={row} className={`timeline-row${i === 0 ? ' scene' : ''}`} style={{ top: HEADER_HEIGHT + i * ROW_HEIGHT, left: LABEL_WIDTH, width: width - LABEL_WIDTH }} />
          ))}

          {layout.steps.map((step) => (
            <div
              key={step.index}
              className={`timeline-step step-${step.kind}${selectedStep === step.index ? ' selected' : ''}${hoverStep === step.index ? ' drop' : ''}`}
              style={{ left: timeToX(geometry, step.start), width: Math.max(2, (step.end - step.start) * pixelsPerSecond), top: HEADER_HEIGHT, height: rows.length * ROW_HEIGHT }}
              onClick={() => store.selectStep(step.index)}
              title={step.label}
            >
              {step.kind === 'wait' && <span className="wait-label">{step.label}</span>}
            </div>
          ))}

          {bars.map((bar) => (
            <div
              key={`${bar.step}-${bar.node}`}
              className={`timeline-bar${bar.group ? ' group' : ''}${selected === bar.node ? ' selected' : ''} depth-${Math.min(bar.depth, 2)}`}
              style={{ left: bar.x, top: HEADER_HEIGHT + bar.y, width: bar.width, height: bar.height }}
              onPointerDown={(e) => {
                e.stopPropagation()
                store.select(bar.node)
                store.selectStep(bar.step)
                if (!bar.group) setDrag({ kind: 'move', node: bar.node, step: bar.step })
              }}
              title={`${bar.label}${bar.rateFunc ? ` · ${bar.rateFunc}` : ''}`}
            >
              <span className="bar-label">{bar.label}</span>
              {bar.rateFunc && bar.width > 110 && <span className="bar-rate mono">{bar.rateFunc}</span>}
              {!bar.group && (
                <span
                  className="bar-edge"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setDrag({ kind: 'resize', node: bar.node, step: bar.step, startX: e.clientX })
                  }}
                />
              )}
            </div>
          ))}

          {markers.map((marker, i) => (
            <div
              key={i}
              className={`timeline-marker kind-${marker.kind}`}
              style={{ left: marker.x, top: HEADER_HEIGHT + marker.y }}
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
