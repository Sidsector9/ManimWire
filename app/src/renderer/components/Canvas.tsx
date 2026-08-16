import { useEffect, useRef } from 'react'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'

export function frameUrl(path: string): string {
  return `mnw://frame${encodeURI(path)}`
}

/** The Manim frame. The last good image stays while the next one renders. */
export function Canvas() {
  const frame = useEngineResults((s) => s.frame)
  const failure = useEngineResults((s) => s.failure)
  const rendering = useEngineResults((s) => s.rendering)
  const issues = useEngineResults((s) => s.issues)
  const setPreviewWidth = useEngineResults((s) => s.setPreviewWidth)
  const engine = useEngineStore((s) => s.status)
  const scene = useDocumentStore(currentScene)
  const select = useDocumentStore((s) => s.select)
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
  return (
    <section className="panel canvas" ref={host}>
      <div className={`frame${failure ? ' failed' : ''}`}>
        {frame && <img src={frameUrl(frame.path)} alt="Manim frame" draggable={false} />}
        {rendering && <div className="progress-line" />}
        {engine.state !== 'ready' && !frame && <div className="canvas-note">{engine.state === 'starting' ? 'Starting the Manim engine…' : `Engine ${engine.state}`}</div>}
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
      <div className="canvas-foot">
        <span className="mono">{frame ? `t = ${frame.time.toFixed(2)} s` : ''}</span>
        <span className="mono">{`${scene.name}`}</span>
      </div>
    </section>
  )
}
