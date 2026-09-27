import { useEffect, useRef, useState } from 'react'
import type { FrameResult } from '../../shared/engine'

/** Coalesced binary transfers; no image codec or unbounded browser frame queue. */
export function RawFrame({ frame, onExpired }: { frame: FrameResult; onExpired(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const expired = useRef(onExpired)
  const retried = useRef<string | null>(null)
  const latest = useRef(frame)
  const pending = useRef<FrameResult | null>(null)
  const busy = useRef(false)
  const alive = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => { expired.current = onExpired }, [onExpired])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; pending.current = null; controller.current?.abort() }
  }, [])
  useEffect(() => {
    latest.current = frame
    pending.current = frame
    if (busy.current) return
    busy.current = true
    void (async () => {
      try {
        while (alive.current && pending.current) {
          const next = pending.current
          pending.current = null
          const transfer = new AbortController()
          controller.current = transfer
          try {
            const response = await fetch(next.path, { signal: transfer.signal })
            if (!response.ok) throw new Error(`Frame unavailable: ${response.status}`)
            const bytes = await response.arrayBuffer()
            // A new graph, size or renderer invalidates an older in-flight frame.
            if (!alive.current || transfer.signal.aborted || latest.current.stream !== next.stream) continue
            const element = canvas.current!
            const width = next.width ?? 0
            const height = next.height ?? 0
            if (width <= 0 || height <= 0 || bytes.byteLength !== width * height * 4) throw new Error('Invalid frame size')
            const context = element.getContext('2d')
            if (!context) throw new Error('Canvas unavailable')
            if (element.width !== width) element.width = width
            if (element.height !== height) element.height = height
            context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0)
            element.dataset['frame'] = next.path
            retried.current = null
            setUnavailable(false)
          } catch {
            if (alive.current && !transfer.signal.aborted && latest.current.stream === next.stream) {
              setUnavailable(true)
              // Retry an evicted frame once, without a render/fetch failure loop.
              if (retried.current !== next.path) {
                retried.current = next.path
                expired.current()
              }
            }
          }
        }
      } finally {
        busy.current = false
        controller.current = null
      }
    })()
  }, [frame])
  return <>
    <canvas ref={canvas} aria-label="Manim frame" role="img" />
    {unavailable && <div className="canvas-note">Preview unavailable. Try scrubbing again.</div>}
  </>
}
