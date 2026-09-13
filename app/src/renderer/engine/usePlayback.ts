import { useEffect } from 'react'
import { useDocumentStore } from '../store/document'
import { cacheKey, useEngineResults } from '../store/preview'

/**
 * Playback. Both passes run on the same wall clock, so the scene plays at its own
 * speed either way. The first pass asks the engine to render each play step's frames
 * into its cache (render.sequence) and shows each as its moment arrives; rendering
 * usually runs ahead, and where it falls behind the newest finished frame is shown.
 * Later passes only read images. A change to the scene or preview size starts a new
 * first pass.
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

    /**
     * Advances the playhead, calling `show` with the scene time it reaches. It moves
     * at real speed, and never past `limit`: on a first pass that is the newest frame
     * the engine has finished, so a scene that renders slower than it plays waits for
     * its frames instead of holding one image while the playhead runs away.
     */
    const clock = (show: (t: number) => void, done: () => void, limit?: () => number): (() => void) => {
      let at = from
      let last = performance.now()
      let stopped = false
      const tick = (): void => {
        if (cancelled || stopped) return
        const now = performance.now()
        const ahead = at + (now - last) / 1000
        last = now
        at = limit === undefined ? ahead : Math.min(ahead, limit())
        if (at >= total) {
          done()
          return
        }
        useEngineResults.getState().setPreviewTime(at)
        show(at)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return () => {
        stopped = true
      }
    }

    const playCached = (): void => {
      clock((t) => void useEngineResults.getState().showFrame(doc, sceneIndex, t), finish)
    }

    const playSequence = async (): Promise<void> => {
      const store = useEngineResults.getState()
      const steps = layout.steps.filter((s) => s.end > s.start + 1e-9 && s.end > from + 1e-9)
      const stopClock = clock(
        (t) => useEngineResults.getState().showQueued(t),
        finish,
        () => useEngineResults.getState().rendered
      )
      for (const step of steps) {
        if (cancelled) return stopClock()
        const ok = await store.sequence(doc, sceneIndex, Math.max(step.start, from), step.end)
        if (!ok) {
          stopClock()
          useEngineResults.getState().setPlaying(false)
          return
        }
      }
      if (cancelled) return stopClock()
      // Only a pass from the start covers every frame; a pass from a scrubbed time does not.
      if (from <= 1e-6 && cacheKey(useEngineResults.getState().code, useEngineResults.getState().previewWidth) === key) {
        useEngineResults.setState({ prerendered: key })
      }
      // The clock ends the pass, whether it got to the end of the scene before the
      // rendering did or after.
    }

    if (results.prerendered === key) playCached()
    else void playSequence()
    return () => {
      cancelled = true
    }
    // Restarts when playing flips, or when a loop rewinds and bumps the pass counter.
  }, [playing, pass])
}
