import { create } from 'zustand'
import type { FrameResult, GeneratedCode, Issue, TimelineLayout } from '../../shared/engine'
import { call, EngineError } from '../engine/client'
import type { Doc } from '../model/document'

export interface SourceMap {
  nodes: Record<string, number[]>
  steps: Record<string, number[]>
  variables: Record<string, string>
}

export interface RenderFailure {
  message: string
  node: string | null
  step: number | null
  line: number | null
}

interface PreviewStore {
  issues: Issue[]
  code: string
  sourceMap: SourceMap
  frame: FrameResult | null
  layout: TimelineLayout | null
  failure: RenderFailure | null
  rendering: boolean
  /** Scene time shown on the canvas. Null means the end of the scene. */
  previewTime: number | null
  previewWidth: number
  inFlight: boolean
  pending: { doc: Doc; sceneIndex: number } | null
  setPreviewTime(time: number | null): void
  setPreviewWidth(width: number): void
  sync(doc: Doc, sceneIndex: number): Promise<void>
}

const END_OF_SCENE = 1e6

export const useEngineResults = create<PreviewStore>((set, get) => ({
  issues: [],
  code: '',
  sourceMap: { nodes: {}, steps: {}, variables: {} },
  frame: null,
  layout: null,
  failure: null,
  rendering: false,
  previewTime: null,
  previewWidth: 960,
  inFlight: false,
  pending: null,
  setPreviewTime: (previewTime) => set({ previewTime }),
  setPreviewWidth: (previewWidth) => set({ previewWidth }),

  /**
   * Validate, generate, and render the current scene. The engine serves one
   * request at a time, so while a sync is running only the latest request is
   * kept and run afterwards.
   */
  sync: async (doc, sceneIndex) => {
    if (get().inFlight) {
      set({ pending: { doc, sceneIndex }, rendering: true })
      return
    }
    set({ inFlight: true, rendering: true })
    try {
      await run(doc, sceneIndex, set, get)
    } finally {
      const next = get().pending
      set({ inFlight: false, pending: null, rendering: next !== null })
      if (next) void get().sync(next.doc, next.sceneIndex)
    }
  }
}))

type Set = (partial: Partial<PreviewStore>) => void
type Get = () => PreviewStore

async function run(doc: Doc, sceneIndex: number, set: Set, get: Get): Promise<void> {
  const scene = doc.scenes[sceneIndex]!.name
  try {
    const generated = await call<GeneratedCode>('document.generate', { document: doc, scene })
    const issues = generated.issues ?? []
    const layout = await call<TimelineLayout>('timeline.layout', { document: doc, scene })
    set({ issues, code: generated.code, sourceMap: generated.source_map as SourceMap, layout })
    if (issues.length > 0) {
      set({ failure: null })
      return
    }
    const { previewTime, previewWidth } = get()
    const frame = await call<FrameResult>('render.frame', {
      document: doc,
      scene,
      time: previewTime ?? END_OF_SCENE,
      width: previewWidth
    })
    set({ frame, failure: null })
  } catch (error) {
    set({ failure: describeFailure(error) })
  }
}

function describeFailure(error: unknown): RenderFailure {
  const data = (error instanceof EngineError ? (error.data as Partial<RenderFailure> | undefined) : undefined) ?? {}
  const message = error instanceof Error ? error.message : String(error)
  return { message, node: data.node ?? null, step: data.step ?? null, line: data.line ?? null }
}
