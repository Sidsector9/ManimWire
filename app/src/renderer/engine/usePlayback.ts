import { useEffect } from 'react'
import { useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'

/**
 * Playback: while playing, each rendered frame asks for the next one, one frame
 * period later. Manim renders every frame, so the pace is the engine's, not
 * real time; a second pass is fast because frames are cached.
 */
export function usePlayback(): void {
  const playing = useEngineResults((s) => s.playing)
  const loop = useEngineResults((s) => s.loop)
  const frame = useEngineResults((s) => s.frame)
  const rendering = useEngineResults((s) => s.rendering)
  const layout = useEngineResults((s) => s.layout)
  const setPreviewTime = useEngineResults((s) => s.setPreviewTime)
  const setPlaying = useEngineResults((s) => s.setPlaying)
  const frameRate = useDocumentStore((s) => s.doc.settings.frame_rate)

  useEffect(() => {
    if (!playing || rendering || !frame || !layout) return
    const total = layout.total
    const next = frame.time + 1 / Math.max(1, frameRate)
    const timer = setTimeout(() => {
      if (next >= total - 1e-6) {
        if (loop) setPreviewTime(0)
        else {
          setPlaying(false)
          setPreviewTime(total)
        }
      } else setPreviewTime(next)
    }, 16)
    return () => clearTimeout(timer)
  }, [playing, loop, frame, rendering, layout, frameRate, setPreviewTime, setPlaying])
}
