import { useCallback, useEffect } from 'react'
import type { ExportResult } from '../../shared/engine'
import { call } from './client'
import { emptyDocument, parseDocument, parseGroup } from '../model/document'
import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'

const AUTOSAVE_MS = 1000

/** File menu actions, autosave, and export, driven by the main process menu. */
export function useFiles() {
  const doc = useDocumentStore((s) => s.doc)
  const dirty = useDocumentStore((s) => s.dirty)
  const filePath = useDocumentStore((s) => s.filePath)
  const setMessage = useEngineStore((s) => s.setMessage)

  const save = useCallback(async (as = false): Promise<void> => {
    const state = useDocumentStore.getState()
    let path = as ? null : state.filePath
    if (!path) {
      path = await window.files.saveAs(state.filePath)
      if (!path) return
    }
    await window.files.write(path, JSON.stringify(state.doc, null, 2))
    state.markSaved(path)
  }, [])

  const open = useCallback(async (): Promise<void> => {
    const result = await window.files.open()
    if (!result) return
    try {
      useDocumentStore.getState().replace(parseDocument(result.content), result.path)
    } catch (error) {
      setMessage(`could not open ${result.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [setMessage])

  const exportVideo = useCallback(async (): Promise<void> => {
    const directory = await window.files.chooseDirectory()
    if (!directory) return
    const state = useDocumentStore.getState()
    const scene = state.doc.scenes[state.sceneIndex]!.name
    setMessage(`exporting ${scene}…`)
    const off = window.engine.onNotification((method, params) => {
      if (method === 'render.progress') {
        const { time } = params as { time: number }
        setMessage(`exporting ${scene}: ${time.toFixed(1)} s rendered`)
      }
    })
    try {
      const result = await call<ExportResult>('render.export', { document: state.doc, scene, directory })
      setMessage(`exported ${result.path}`)
      void window.files.reveal(result.path)
    } catch (error) {
      setMessage(`export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      off()
    }
  }, [setMessage])

  const exportGroup = useCallback(async (name: string): Promise<void> => {
    const group = useDocumentStore.getState().doc.groups.find((g) => g.name === name)
    if (!group) return
    const saved = await window.files.saveText(`${name}.mnwg`, 'mnwg', JSON.stringify(group, null, 2))
    if (saved) setMessage(`exported group ${name} to ${saved}`)
  }, [setMessage])

  const importGroup = useCallback(async (): Promise<void> => {
    const result = await window.files.openText('mnwg')
    if (!result) return
    try {
      useDocumentStore.getState().importGroup(parseGroup(result.content))
    } catch (error) {
      setMessage(`could not import ${result.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [setMessage])

  useEffect(() => {
    return window.files.onMenu((action) => {
      const state = useDocumentStore.getState()
      if (action === 'new') state.replace(emptyDocument(), null)
      else if (action === 'open') void open()
      else if (action === 'save') void save()
      else if (action === 'saveAs') void save(true)
      else if (action === 'undo') state.undo()
      else if (action === 'redo') state.redo()
      else if (action === 'export') void exportVideo()
    })
  }, [open, save, exportVideo])

  useEffect(() => {
    return window.files.onOpened((file) => {
      try {
        useDocumentStore.getState().replace(parseDocument(file.content), file.path)
      } catch (error) {
        setMessage(`could not open ${file.path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }, [setMessage])

  useEffect(() => {
    if (!dirty || !filePath) return
    const timer = setTimeout(() => void save(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [doc, dirty, filePath, save])

  return { save, open, exportVideo, exportGroup, importGroup }
}
