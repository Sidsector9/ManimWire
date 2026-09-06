import { useEffect } from 'react'
import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'

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

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => void sync(useDocumentStore.getState().doc, sceneIndex, revision), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [revision, sceneIndex, ready, previewTime, previewWidth, sync])
}
