import { useEffect } from 'react'
import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'

const DEBOUNCE_MS = 150

/** Re-validate, regenerate, and re-render whenever the document or preview settings change. */
export function useEngineSync(): void {
  const doc = useDocumentStore((s) => s.doc)
  const sceneIndex = useDocumentStore((s) => s.sceneIndex)
  const ready = useEngineStore((s) => s.status.state === 'ready')
  const previewTime = useEngineResults((s) => s.previewTime)
  const previewWidth = useEngineResults((s) => s.previewWidth)
  const sync = useEngineResults((s) => s.sync)

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => void sync(doc, sceneIndex), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [doc, sceneIndex, ready, previewTime, previewWidth, sync])
}
