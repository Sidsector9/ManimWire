import { create } from 'zustand'
import type { FrameResult, GeneratedCode, Issue, TimelineLayout } from '../../shared/engine'
import { call, EngineError } from '../engine/client'
import type { Doc } from '../model/document'

export interface SourceMap {
  nodes: Record<string, number[]>
  steps: Record<string, number[]>
  variables: Record<string, string>
  /** Nodes emitted as always_redraw or add_updater. */
  live: string[]
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
  /** Transport (handoff timeline). */
  playing: boolean
  loop: boolean
  /** True while the engine renders a run of frames into its cache (render.sequence). */
  sequencing: boolean
  /** Counts sequence calls, so a cancelled run's completion cannot clear a newer run's flag. */
  sequenceRun: number
  /** The document last validated and laid out; a frame-only sync skips those two calls. */
  synced: { doc: Doc; sceneIndex: number } | null
  /** Bumped when playback should start over (loop); the playback hook watches it. */
  pass: number
  /** Code and width whose frames are all in the engine cache; playback then reads images only. */
  prerendered: string | null
  setPreviewTime(time: number | null): void
  setPreviewWidth(width: number): void
  setPlaying(playing: boolean): void
  setLoop(loop: boolean): void
  sync(doc: Doc, sceneIndex: number): Promise<void>
  /** Render every frame between two times into the cache; the store shows them as they arrive. */
  sequence(doc: Doc, sceneIndex: number, start: number, end: number): Promise<boolean>
  /** Show the frame at a time from the cache, dropping the request when one is in flight. */
  showFrame(doc: Doc, sceneIndex: number, time: number): Promise<void>
}

export function cacheKey(code: string, width: number): string {
  return `${width}|${code}`
}

const END_OF_SCENE = 1e6

export const useEngineResults = create<PreviewStore>((set, get) => ({
  issues: [],
  code: '',
  sourceMap: { nodes: {}, steps: {}, variables: {}, live: [] },
  frame: null,
  layout: null,
  failure: null,
  rendering: false,
  previewTime: null,
  previewWidth: 960,
  inFlight: false,
  pending: null,
  playing: false,
  loop: false,
  sequencing: false,
  sequenceRun: 0,
  synced: null,
  pass: 0,
  prerendered: null,
  setPreviewTime: (previewTime) => set({ previewTime }),
  setPreviewWidth: (previewWidth) => set({ previewWidth }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),

  /**
   * Validate, generate, and render the current scene. The engine serves one
   * request at a time, so while a sync is running only the latest request is
   * kept and run afterwards.
   */
  sync: async (doc, sceneIndex) => {
    if (get().inFlight || get().sequencing) {
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
  },

  sequence: async (doc, sceneIndex, start, end) => {
    const scene = doc.scenes[sceneIndex]!.name
    const { previewWidth } = get()
    const run = get().sequenceRun + 1
    set({ sequencing: true, sequenceRun: run, rendering: true, failure: null })
    const off = window.engine.onNotification((method, params) => {
      if (method !== 'render.frame_ready') return
      const frame = params as FrameResult & { scene: string }
      // After Stop the engine still finishes the step; those frames must not move the playhead.
      if (frame.scene === scene && get().playing && get().sequenceRun === run) set({ frame, previewTime: frame.time })
    })
    try {
      await call('render.sequence', { document: doc, scene, start, end, width: previewWidth })
      return true
    } catch (error) {
      set({ failure: describeFailure(error) })
      return false
    } finally {
      off()
      if (get().sequenceRun === run) {
        const next = get().pending
        set({ sequencing: false, rendering: next !== null, pending: null })
        if (next) void get().sync(next.doc, next.sceneIndex)
      }
    }
  },

  showFrame: async (doc, sceneIndex, time) => {
    if (get().inFlight || get().sequencing) return
    const scene = doc.scenes[sceneIndex]!.name
    set({ inFlight: true, previewTime: time })
    try {
      const frame = await call<FrameResult>('render.frame', { document: doc, scene, time, width: get().previewWidth })
      set({ frame })
    } catch (error) {
      set({ failure: describeFailure(error), playing: false })
    } finally {
      const next = get().pending
      set({ inFlight: false, pending: null })
      if (next) void get().sync(next.doc, next.sceneIndex)
    }
  }
}))

type Set = (partial: Partial<PreviewStore>) => void
type Get = () => PreviewStore

async function run(doc: Doc, sceneIndex: number, set: Set, get: Get): Promise<void> {
  const scene = doc.scenes[sceneIndex]!.name
  try {
    const synced = get().synced
    const unchanged = synced !== null && synced.doc === doc && synced.sceneIndex === sceneIndex
    if (unchanged && get().playing) return // the playback loop shows frames itself
    if (!unchanged) {
      // Only a document change needs new code and a new timeline; a scrub needs a frame.
      const generated = await call<GeneratedCode>('document.generate', { document: doc, scene })
      const issues = generated.issues ?? []
      const layout = await call<TimelineLayout>('timeline.layout', { document: doc, scene })
      set({ issues, code: generated.code, sourceMap: generated.source_map as SourceMap, layout, synced: { doc, sceneIndex } })
      if (issues.length > 0) {
        set({ failure: null })
        return
      }
    } else if (get().issues.length > 0) {
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
