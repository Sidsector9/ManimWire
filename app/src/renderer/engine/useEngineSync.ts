import { useEffect, useRef } from 'react'
import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { cacheKey, useEngineResults } from '../store/preview'

const DEBOUNCE_MS = 150

/** Re-validate, regenerate, and re-render whenever the document or preview settings change. */
export function useEngineSync(): void {
  // Keyed on the revision, not the document: moving a node changes the document
  // without changing the scene, and must not cost a render.
  const revision = useDocumentStore((s) => s.revision)
  const sceneIndex = useDocumentStore((s) => s.sceneIndex)
  const ready = useEngineStore((s) => s.status.state === 'ready')
  // While playing, the playback loop shows frames itself; only document changes sync.
  const previewTime = useEngineResults((s) => (s.playing ? null : s.previewTime))
  const previewWidth = useEngineResults((s) => s.previewWidth)
  const sync = useEngineResults((s) => s.sync)
  const stream = useEngineResults((s) => s.frame?.stream)
  const inFlight = useEngineResults((s) => s.inFlight)
  const sequencing = useEngineResults((s) => s.sequencing)
  const code = useEngineResults((s) => s.code)
  const playing = useEngineResults((s) => s.playing)
  const warmSuppressed = useEngineResults((s) => s.warmSuppressed)
  const warmed = useRef<string | null>(null)

  useEffect(() => {
    warmed.current = null
    // A new engine may have different capabilities and an empty frame cache.
    // Revalidate even when the open document has not changed.
    useEngineResults.setState({
      synced: null,
      prerendered: null,
      warming: false,
      warmSuppressed: null,
      ...(!ready ? { playing: false, queued: [] } : {})
    })
  }, [ready])

  useEffect(() => {
    if (!ready) return
    const synced = useEngineResults.getState().synced
    if (synced?.revision === revision && synced.sceneIndex === sceneIndex) {
      // Scrubbing an unchanged scene should follow the next display frame. The
      // store already limits in-flight requests and keeps only the latest one.
      const frame = requestAnimationFrame(() => void sync(useDocumentStore.getState().doc, sceneIndex, revision))
      return () => cancelAnimationFrame(frame)
    }
    const timer = setTimeout(() => void sync(useDocumentStore.getState().doc, sceneIndex, revision), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [revision, sceneIndex, ready, previewTime, previewWidth, sync])

  useEffect(() => {
    const state = useEngineResults.getState()
    // Show the requested image first. Only prepare an idle, newly opened/end
    // preview; dragging through uncached positions keeps its resumable scene.
    if (!ready || playing || inFlight || sequencing || state.previewTime !== null ||
        state.frame?.format !== 'rgba' || !state.layout?.total || state.failure ||
        state.synced?.revision !== revision || state.synced.sceneIndex !== sceneIndex) return
    const key = cacheKey(code, previewWidth)
    // Clearing is explicit: don't immediately refill the cache during idle time.
    if (warmed.current === key || state.prerendered === key || warmSuppressed === key) return
    const timer = setTimeout(() => {
      warmed.current = key
      const doc = useDocumentStore.getState().doc
      const height = Math.round(previewWidth * doc.settings.pixel_height / doc.settings.pixel_width)
      // Bound idle work as well as stored bytes; large projects render the rest
      // on demand. Leave storage headroom for foreground requests.
      const seconds = Math.min(10, 1.5 * 1024 ** 3 / (previewWidth * height * 4 * doc.settings.frame_rate))
      void useEngineResults.getState().sequence(doc, sceneIndex, 0, Math.min(state.layout!.total, seconds), true)
    }, 300)
    return () => clearTimeout(timer)
  }, [ready, playing, inFlight, sequencing, stream, revision, sceneIndex, previewTime, previewWidth, code, warmSuppressed])
}
