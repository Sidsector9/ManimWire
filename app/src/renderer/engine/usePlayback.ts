import { useEffect } from 'react'
import { useDocumentStore } from '../store/document'
import { cacheKey, useEngineResults } from '../store/preview'

/**
 * Playback. The first pass asks the engine to render each play step's frames into
 * its cache in one run (render.sequence), showing them as they arrive at the
 * engine's pace. Once every frame is cached, playback runs in real time and only
 * reads images. Any change to the scene or the preview size starts a new first pass.
 */
export function usePlayback(): void {
  const playing = useEngineResults((s) => s.playing)
  const pass = useEngineResults((s) => s.pass)

  useEffect(() => {
    if (!playing) return
    let cancelled = false
    const results = useEngineResults.getState()
    const { doc, sceneIndex } = useDocumentStore.getState()
    const layout = results.layout
    if (!layout || layout.total <= 0) {
      results.setPlaying(false)
      return
    }
    const total = layout.total
    const key = cacheKey(results.code, results.previewWidth)
    const from = results.previewTime !== null && results.previewTime < total - 1e-6 ? results.previewTime : 0

    const finish = (): void => {
      if (cancelled) return
      const { loop, setPlaying, setPreviewTime, pass: current } = useEngineResults.getState()
      if (loop) {
        setPreviewTime(0)
        useEngineResults.setState({ pass: current + 1 })
      } else {
        setPlaying(false)
        setPreviewTime(total)
      }
    }

    const playCached = (): void => {
      const started = performance.now()
      const tick = (): void => {
        if (cancelled) return
        const t = from + (performance.now() - started) / 1000
        if (t >= total) {
          finish()
          return
        }
        void useEngineResults.getState().showFrame(doc, sceneIndex, t)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    const playSequence = async (): Promise<void> => {
      const store = useEngineResults.getState()
      const steps = layout.steps.filter((s) => s.end > s.start + 1e-9 && s.end > from + 1e-9)
      for (const step of steps) {
        if (cancelled) return
        const ok = await store.sequence(doc, sceneIndex, Math.max(step.start, from), step.end)
        if (!ok) {
          useEngineResults.getState().setPlaying(false)
          return
        }
      }
      if (cancelled) return
      // Only a pass from the start covers every frame; a pass from a scrubbed time does not.
      if (from <= 1e-6 && cacheKey(useEngineResults.getState().code, useEngineResults.getState().previewWidth) === key) {
        useEngineResults.setState({ prerendered: key })
      }
      finish()
    }

    if (results.prerendered === key) playCached()
    else void playSequence()
    return () => {
      cancelled = true
    }
    // Restarts when playing flips, or when a loop rewinds and bumps the pass counter.
  }, [playing, pass])
}
