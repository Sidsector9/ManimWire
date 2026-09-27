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
  pending: { doc: Doc; sceneIndex: number; revision: number } | null
  /** Transport (handoff timeline). */
  playing: boolean
  loop: boolean
  /** True while the engine renders a run of frames into its cache (render.sequence). */
  sequencing: boolean
  warming: boolean
  clearingCache: boolean
  warmSuppressed: string | null
  clearDiskCache(): Promise<void>
  /** Counts sequence calls, so a cancelled run's completion cannot clear a newer run's flag. */
  sequenceRun: number
  cancelUrl: string | null
  seekUrl: string | null
  sequenceCached: boolean
  cancelSequence(): void
  /** The edit last validated and laid out; a frame-only sync skips those two calls. */
  synced: { revision: number; sceneIndex: number } | null
  /** Bumped when playback should start over (loop); the playback hook watches it. */
  pass: number
  /** Code and width whose frames are all in the engine cache; playback then reads images only. */
  prerendered: string | null
  /** Frames the engine has finished during a first pass, waiting for their moment. */
  queued: FrameResult[]
  /** Playback can advance through this time: the latest frame or a completed render interval's end. */
  rendered: number
  setPreviewTime(time: number | null): void
  setPreviewWidth(width: number): void
  setPlaying(playing: boolean): void
  setLoop(loop: boolean): void
  sync(doc: Doc, sceneIndex: number, revision: number): Promise<void>
  /** Render every frame between two times into the cache, queueing them for playback. */
  sequence(doc: Doc, sceneIndex: number, start: number, end: number, background?: boolean): Promise<boolean>
  /** Show the newest queued frame due by `time`, dropping the ones it passed. */
  showQueued(time: number): void
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
  warming: false,
  clearingCache: false,
  warmSuppressed: null,
  clearDiskCache: async () => {
    if (get().inFlight || get().sequencing || get().playing || get().clearingCache) {
      throw new Error('Wait for rendering and playback to finish before clearing the cache.')
    }
    set({ clearingCache: true, inFlight: true, warmSuppressed: cacheKey(get().code, get().previewWidth), prerendered: null, sequenceCached: false, queued: [], rendered: 0 })
    try {
      await call('cache.clear')
    } finally {
      const next = get().pending
      set({ clearingCache: false, inFlight: false, pending: null })
      if (next) void get().sync(next.doc, next.sceneIndex, next.revision)
    }
  },
  sequenceRun: 0,
  cancelUrl: null,
  seekUrl: null,
  sequenceCached: false,
  cancelSequence: () => {
    const url = get().cancelUrl
    if (url) void fetch(url, { method: 'POST' }).catch(() => {})
  },
  synced: null,
  pass: 0,
  prerendered: null,
  queued: [],
  rendered: 0,
  setPreviewTime: (previewTime) => set({ previewTime }),
  setPreviewWidth: (previewWidth) => set({ previewWidth }),
  setPlaying: (playing) => {
    if (playing && get().clearingCache) return
    if (!playing || get().warming) get().cancelSequence()
    set({ playing, ...(playing ? { rendered: 0 } : { queued: [] }) })
  },
  setLoop: (loop) => set({ loop }),

  /**
   * Validate, generate, and render the current scene. The engine serves one
   * request at a time, so while a sync is running only the latest request is
   * kept and run afterwards.
   */
  sync: async (doc, sceneIndex, revision) => {
    if (get().inFlight || get().sequencing) {
      if (get().warming) get().cancelSequence()
      if (get().seekUrl) {
        const unchanged = get().synced?.revision === revision && get().synced?.sceneIndex === sceneIndex
        retargetSeek(get().seekUrl!, unchanged ? get().previewTime ?? END_OF_SCENE : 0)
      }
      if (get().sequencing && (get().synced?.revision !== revision || get().synced?.sceneIndex !== sceneIndex)) {
        get().setPlaying(false)
      }
      set({ pending: { doc, sceneIndex, revision }, rendering: true })
      return
    }
    set({ inFlight: true, rendering: true })
    try {
      await run(doc, sceneIndex, revision, set, get)
    } finally {
      const next = get().pending
      set({ inFlight: false, pending: null, rendering: next !== null })
      if (next) void get().sync(next.doc, next.sceneIndex, next.revision)
    }
  },

  sequence: async (doc, sceneIndex, start, end, background = false) => {
    if (get().clearingCache) return false
    const scene = doc.scenes[sceneIndex]!.name
    const { previewWidth } = get()
    const run = get().sequenceRun + 1
    set({ sequencing: true, warming: background, sequenceRun: run, cancelUrl: null, rendering: !background, failure: null })
    const off = window.engine.onNotification((method, params) => {
      const message = params as { request_id?: number | null; cancel_url?: string }
      if (message.request_id != null && message.request_id !== run) return
      if (method === 'render.sequence_started' && message.cancel_url && get().sequenceRun === run) {
        set({ cancelUrl: message.cancel_url })
        if ((!get().playing && !background) || (background && get().pending)) get().cancelSequence()
        return
      }
      if (method !== 'render.frame_ready') return
      const frame = params as FrameResult & { scene: string }
      // Rendering usually outruns the scene, so frames wait their turn rather than
      // being shown the moment they arrive. Ignore frames arriving after Stop
      // while the engine handles cancellation at its next frame boundary.
      if (!background && frame.scene === scene && get().playing && get().sequenceRun === run) {
        set({ queued: [...get().queued, frame], rendered: Math.max(get().rendered, frame.time) })
      }
    })
    try {
      const result = await call<{ cache_complete?: boolean; cancelled?: boolean }>('render.sequence', { document: doc, scene, start, end, width: previewWidth, request_id: run, paced: !background })
      if (get().sequenceRun === run) {
        set({ sequenceCached: result.cache_complete !== false })
        if (background && !result.cancelled && result.cache_complete && end >= (get().layout?.total ?? Infinity)) set({ prerendered: cacheKey(get().code, previewWidth) })
      }
      return !result.cancelled
    } catch (error) {
      set({ failure: describeFailure(error) })
      return false
    } finally {
      off()
      if (get().sequenceRun === run) {
        const next = get().pending
        set({ sequencing: false, warming: false, cancelUrl: null, rendering: next !== null, pending: null })
        if (next) void get().sync(next.doc, next.sceneIndex, next.revision)
      }
    }
  },

  showQueued: (time) => {
    const queued = get().queued
    const ready = queued.filter((f) => f.time <= time + 1e-6)
    if (ready.length === 0) return
    set({ frame: ready[ready.length - 1]!, queued: queued.slice(ready.length) })
  },

  showFrame: async (doc, sceneIndex, time) => {
    if (get().inFlight || get().sequencing) return
    const scene = doc.scenes[sceneIndex]!.name
    set({ inFlight: true, previewTime: time })
    try {
      const frame = await requestFrame({ document: doc, scene, time, width: get().previewWidth }, set, get)
      set({ frame })
    } catch (error) {
      set({ failure: describeFailure(error), playing: false })
    } finally {
      const next = get().pending
      set({ inFlight: false, pending: null })
      if (next) void get().sync(next.doc, next.sceneIndex, next.revision)
    }
  }
}))

type Set = (partial: Partial<PreviewStore>) => void
type Get = () => PreviewStore

let seekRequest = 0
let seekRevision = 0

function retargetSeek(url: string, time: number): void {
  void fetch(`${url}${time}/${++seekRevision}`, { method: 'POST' }).catch(() => {})
}

async function requestFrame(params: Record<string, unknown>, set: Set, get: Get): Promise<FrameResult> {
  const requestId = ++seekRequest
  const off = window.engine.onNotification((method, value) => {
    const message = value as { request_id?: number; seek_url?: string }
    if (method !== 'render.seek_started' || message.request_id !== requestId || !message.seek_url) return
    set({ seekUrl: message.seek_url })
    const pending = get().pending
    const changed = pending && (pending.revision !== get().synced?.revision || pending.sceneIndex !== get().synced?.sceneIndex)
    retargetSeek(message.seek_url, changed ? 0 : get().previewTime ?? END_OF_SCENE)
  })
  try {
    return await call<FrameResult>('render.frame', { ...params, request_id: requestId })
  } finally {
    off()
    set({ seekUrl: null })
  }
}

async function run(doc: Doc, sceneIndex: number, revision: number, set: Set, get: Get): Promise<void> {
  const scene = doc.scenes[sceneIndex]!.name
  try {
    const synced = get().synced
    const unchanged = synced !== null && synced.revision === revision && synced.sceneIndex === sceneIndex
    if (unchanged && get().playing) return // the playback loop shows frames itself
    if (!unchanged) {
      // Only a document change needs new code and a new timeline; a scrub needs a frame.
      const generated = await call<GeneratedCode>('document.generate', { document: doc, scene })
      const issues = generated.issues ?? []
      const layout = await call<TimelineLayout>('timeline.layout', { document: doc, scene })
      set({ issues, code: generated.code, sourceMap: generated.source_map as SourceMap, layout, synced: { revision, sceneIndex } })
      if (issues.length > 0) {
        set({ failure: null })
        return
      }
    } else if (get().issues.length > 0) {
      return
    }
    const { previewTime, previewWidth } = get()
    const frame = await requestFrame({
      document: doc,
      scene,
      time: previewTime ?? END_OF_SCENE,
      width: previewWidth
    }, set, get)
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
