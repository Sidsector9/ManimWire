import { useEffect, useRef } from 'react'
import { rootOf } from '../model/live'
import { useDescriptorIndex } from '../store/descriptors'
import { previewScene, useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'

export function frameUrl(path: string): string {
  return `mnw://frame${encodeURI(path)}`
}

/** Manim's default frame in scene units (config.frame_width x config.frame_height). */
export const FRAME_WIDTH = 14.222222
export const FRAME_HEIGHT = 8

const LATEX_HELP = 'https://docs.manim.community/en/stable/installation.html'

/** The Manim frame. The last good image stays while the next one renders. */
export function Canvas() {
  const frame = useEngineResults((s) => s.frame)
  const failure = useEngineResults((s) => s.failure)
  const rendering = useEngineResults((s) => s.rendering)
  const issues = useEngineResults((s) => s.issues)
  const previewTime = useEngineResults((s) => s.previewTime)
  const setPreviewWidth = useEngineResults((s) => s.setPreviewWidth)
  const engine = useEngineStore((s) => s.status)
  const scene = useDocumentStore(previewScene)
  const selected = useDocumentStore((s) => s.selected)
  const select = useDocumentStore((s) => s.select)
  const selectStep = useDocumentStore((s) => s.selectStep)
  const index = useDescriptorIndex()
  const host = useRef<HTMLDivElement>(null)

  // Ask the engine for frames close to the displayed size, rounded to keep the cache useful.
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.min(1920, Math.max(320, Math.round((entry?.contentRect.width ?? 960) / 160) * 160))
      setPreviewWidth(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [setPreviewWidth])

  const empty = scene.nodes.length === 0
  // The selected node's object at the playhead: bounds are in scene units, the frame is 14.22 x 8.
  const selectedRoot = selected ? rootOf(scene, selected, index) : null
  const bounds = frame?.bounds.find((b) => b.node === selected) ?? frame?.bounds.find((b) => b.node === selectedRoot)
  const latexMissing = engine.info ? !(engine.info.latex && engine.info.dvisvgm) : false
  const needsLatex = latexMissing && scene.nodes.some((n) => index.get(n.catalogue)?.requires_latex)
  const shownTime = frame?.time ?? previewTime
  const [cx, cy] = (bounds?.center ?? [0, 0]) as [number, number]

  return (
    <section className="panel canvas" ref={host}>
      <div className="canvas-chips">
        <span className="canvas-chip time mono">{shownTime !== null && shownTime !== undefined ? `t = ${shownTime.toFixed(2)} s` : ''}</span>
        <span className="canvas-chip mono" title="Scene units: UP is +y, the frame is 14.22 by 8">
          grid 1.0
        </span>
      </div>
      <div className={`frame${failure ? ' failed' : ''}`}>
        {frame && <img src={frameUrl(frame.path)} alt="Manim frame" draggable={false} />}
        {frame && bounds && bounds.on_screen && (
          <div
            className="selection-box"
            style={{
              left: `${((cx - bounds.width / 2) / FRAME_WIDTH + 0.5) * 100}%`,
              top: `${(0.5 - (cy + bounds.height / 2) / FRAME_HEIGHT) * 100}%`,
              width: `${(bounds.width / FRAME_WIDTH) * 100}%`,
              height: `${(bounds.height / FRAME_HEIGHT) * 100}%`
            }}
          >
            <span className="handle tl" />
            <span className="handle tr" />
            <span className="handle bl" />
            <span className="handle br" />
            <span className="centre" />
            <span className="readout mono">
              ({cx.toFixed(2)}, {cy.toFixed(2)})
            </span>
          </div>
        )}
        {rendering && <div className="progress-line" />}
        {engine.state !== 'ready' && !frame && (
          <div className="canvas-note">
            <div className="starting">
              <div className="track">
                <div className="fill" />
              </div>
              <div>{engine.state === 'starting' ? 'Starting the Manim engine' : `Engine ${engine.state}`}</div>
              <div className="mono muted">Python 3.12 · Manim CE · building the node catalogue</div>
            </div>
          </div>
        )}
        {engine.state === 'ready' && empty && !frame && <div className="canvas-note">Empty scene</div>}
      </div>
      {failure && (
        <div className="error-card">
          <div className="error-title">Render failed</div>
          <div className="mono error-message">{failure.message}</div>
          {failure.node && (
            <button className="link" onClick={() => select(failure.node)}>
              go to node
            </button>
          )}
          {failure.node === null && failure.step !== null && (
            <button className="link" onClick={() => selectStep(failure.step)}>
              go to step
            </button>
          )}
        </div>
      )}
      {!failure && issues.length > 0 && (
        <div className="error-card">
          <div className="error-title">{issues.length === 1 ? '1 problem' : `${issues.length} problems`}</div>
          {issues.slice(0, 3).map((issue, i) => (
            <div key={i} className="error-message">
              {issue.message}
              {issue.node && (
                <button className="link" onClick={() => select(issue.node ?? null)}>
                  go to node
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!failure && issues.length === 0 && needsLatex && (
        <div className="error-card warning">
          <div className="error-title">LaTeX not found</div>
          <div className="error-message">
            Tex, MathTex and Typst text need latex and dvisvgm on the PATH. Every other node renders.
            <button className="link" onClick={() => void window.files.openExternal(LATEX_HELP)}>
              install instructions
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
