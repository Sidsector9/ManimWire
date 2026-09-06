import { create } from 'zustand'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { liveByDefault } from '../model/live'
import { acceptingPorts, portType, type DescriptorIndex } from '../model/types'
import {
  addGroup,
  addNode,
  addStep,
  connect,
  disconnect,
  emptyDocument,
  graphOf,
  importGroup,
  moveAnimation,
  moveStep,
  placeNode,
  removeGroup,
  removeNodes,
  removeStep,
  setSceneType,
  setSettings,
  setValue,
  updateNode,
  type Doc,
  type DocEdge,
  type DocNode,
  type GroupDefinition,
  newId,
  type JsonValue,
  type Scene,
  type SceneType,
  type Step,
  type Target
} from '../model/document'

const HISTORY_LIMIT = 100
/** Consecutive edits of the same field within this window share one history entry. */
const COALESCE_MS = 1000
// Node fields the engine never reads: they place a node on the graph, they do not
// change the scene.
const CANVAS_FIELDS = new Set(['position', 'collapsed', 'size', 'pinned'])

interface DocumentStore {
  doc: Doc
  sceneIndex: number
  /** When set, the graph shows and edits this reusable group instead of the scene. */
  editingGroup: string | null
  filePath: string | null
  dirty: boolean
  past: Doc[]
  future: Doc[]
  selected: string | null
  selectedStep: number | null
  lastEdit: { key: string; at: number } | null
  /** Counts edits that change what the engine sees. Where a node sits on the graph,
   * and whether it is folded open, never reach the engine, so those do not count. */
  revision: number

  replace(doc: Doc, filePath: string | null): void
  apply(change: (doc: Doc) => Doc): void
  addNode(catalogue: string, position: [number, number], values?: Record<string, JsonValue>, parent?: string | null): string
  /** Add a catalogue entry, connect it to `from` if given, and play it if it is an animation. One history entry. */
  addCatalogueNode(descriptor: Descriptor, position: [number, number], index: DescriptorIndex, from?: { node: string; type: TypeRef }): string
  removeNodes(ids: string[]): void
  updateNode(id: string, change: Partial<DocNode>): void
  /** Drop a node at an absolute graph position; it joins the container found there. */
  placeNode(id: string, absolute: [number, number]): void
  setValue(id: string, port: string, value: JsonValue | undefined): void
  connect(edge: DocEdge): void
  disconnect(edge: Pick<DocEdge, 'source' | 'target' | 'port'>): void
  /** Make every connection into a port live (an updater) or one-time. */
  setPortLive(target: string, port: string, live: boolean): void
  addStep(step: Step, at?: number): void
  removeStep(at: number): void
  updateStep(at: number, step: Step): void
  moveStep(from: number, to: number): void
  moveAnimation(node: string, from: number, to: number | null): void
  selectStep(at: number | null): void
  setSettings(change: Partial<Doc['settings']>): void
  setSceneType(type: SceneType): void
  addGroup(name: string): void
  removeGroup(name: string): void
  importGroup(group: GroupDefinition): void
  editGroup(name: string | null): void
  select(id: string | null): void
  undo(): void
  redo(): void
  markSaved(filePath: string): void
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  const target = (): Target => get().editingGroup ?? get().sceneIndex
  const record = (next: Doc, semantic = true): void => {
    const { doc, past, revision } = get()
    if (next === doc) return
    set({
      doc: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), doc],
      future: [],
      dirty: true,
      lastEdit: null,
      revision: semantic ? revision + 1 : revision
    })
  }
  const coalesce = (key: string, next: Doc): void => {
    const { lastEdit } = get()
    const now = Date.now()
    if (lastEdit && lastEdit.key === key && now - lastEdit.at < COALESCE_MS) {
      set({ doc: next, dirty: true, lastEdit: { key, at: now }, revision: get().revision + 1 })
      return
    }
    record(next)
    set({ lastEdit: { key, at: now } })
  }
  return {
    doc: emptyDocument(),
    sceneIndex: 0,
    editingGroup: null,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    revision: 0,
    selected: null,
    selectedStep: null,
    lastEdit: null,

    replace: (doc, filePath) =>
      set({ doc, filePath, dirty: false, past: [], future: [], selected: null, selectedStep: null, editingGroup: null, lastEdit: null, revision: get().revision + 1 }),
    apply: (change) => record(change(get().doc)),
    addNode: (catalogue, position, values = {}, parent = null) => {
      const id = newId()
      record(addNode(get().doc, target(), catalogue, position, values, id, parent))
      set({ selected: id })
      return id
    },
    addCatalogueNode: (descriptor, position, index, from) => {
      const { doc } = get()
      const scene = currentScene(get())
      const id = newId()
      const parent = from ? (scene.nodes.find((n) => n.id === from.node)?.parent ?? null) : null
      let next = addNode(doc, target(), descriptor.qualname, position, {}, id, parent)
      const port = from ? acceptingPorts(from.type, descriptor, index)[0] : undefined
      if (from && port) {
        const live = liveByDefault(scene, from.node, portType(descriptor, port, index), index)
        next = connect(next, target(), { source: from.node, target: id, port, live })
      }
      if (descriptor.returns.type === 'animation') next = addStep(next, target(), { kind: 'play', animations: [id] })
      record(next)
      set({ selected: id })
      return id
    },
    removeNodes: (ids) => {
      const { doc, selected } = get()
      record(removeNodes(doc, target(), ids))
      if (selected && ids.includes(selected)) set({ selected: null })
    },
    updateNode: (id, change) => {
      const next = updateNode(get().doc, target(), id, change)
      const keys = Object.keys(change)
      if (keys.length === 1 && keys[0] === 'label') coalesce(`${id}:label`, next)
      else record(next, !keys.every((key) => CANVAS_FIELDS.has(key)))
    },
    // Moves change layout only, so they do not create history entries.
    placeNode: (id, absolute) => {
      const next = placeNode(get().doc, target(), id, absolute)
      if (next !== get().doc) set({ doc: next, dirty: true })
    },
    setValue: (id, port, value) => coalesce(`${id}:${port}`, setValue(get().doc, target(), id, port, value)),
    connect: (edge) => record(connect(get().doc, target(), edge)),
    disconnect: (edge) => record(disconnect(get().doc, target(), edge)),
    setPortLive: (targetNode, port, live) => {
      const scene = currentScene(get())
      let next = get().doc
      for (const edge of scene.edges) {
        if (edge.target === targetNode && edge.port === port && edge.live !== live) next = connect(next, target(), { ...edge, live })
      }
      record(next)
    },
    addStep: (step, at) => record(addStep(get().doc, target(), step, at)),
    removeStep: (at) => {
      record(removeStep(get().doc, target(), at))
      const { selectedStep } = get()
      if (selectedStep === at) set({ selectedStep: null })
      else if (selectedStep !== null && selectedStep > at) set({ selectedStep: selectedStep - 1 })
    },
    moveStep: (from, to) => {
      record(moveStep(get().doc, target(), from, to))
      set({ selectedStep: to })
    },
    moveAnimation: (node, from, to) => record(moveAnimation(get().doc, target(), node, from, to)),
    selectStep: (at) => set({ selectedStep: at }),
    updateStep: (at, step) => coalesce(`step:${at}`, addStep(removeStep(get().doc, target(), at), target(), step, at)),
    setSettings: (change) => record(setSettings(get().doc, change)),
    setSceneType: (type) => record(setSceneType(get().doc, get().sceneIndex, type)),
    addGroup: (name) => {
      record(addGroup(get().doc, name))
      if (get().doc.groups.some((g) => g.name === name)) set({ editingGroup: name, selected: null, selectedStep: null })
    },
    removeGroup: (name) => {
      record(removeGroup(get().doc, name))
      if (get().editingGroup === name) set({ editingGroup: null, selected: null })
    },
    importGroup: (group) => record(importGroup(get().doc, group)),
    editGroup: (name) => set({ editingGroup: name, selected: null, selectedStep: null }),
    // Returning the state unchanged stops zustand notifying: the graph subscribes to
    // the whole store, and re-rendering it would report the selection straight back.
    select: (id) =>
      set((s) => {
        if (s.selected === id && (id !== null || s.selectedStep === null)) return s
        return id === null ? { selected: null, selectedStep: null } : { selected: id }
      }),
    undo: () => {
      const { doc, past, future } = get()
      const previous = past.at(-1)
      if (!previous) return
      set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], dirty: true, lastEdit: null, revision: get().revision + 1 })
    },
    redo: () => {
      const { doc, past, future } = get()
      const [next, ...rest] = future
      if (!next) return
      set({ doc: next, past: [...past, doc], future: rest, dirty: true, lastEdit: null, revision: get().revision + 1 })
    },
    markSaved: (filePath) => set({ filePath, dirty: false })
  }
})

/** The graph being edited: the current scene, or the reusable group open in the editor. */
export function currentScene(store: Pick<DocumentStore, 'doc' | 'sceneIndex' | 'editingGroup'>): Scene {
  return graphOf(store.doc, store.editingGroup ?? store.sceneIndex) ?? store.doc.scenes[store.sceneIndex]!
}

/** The scene whose preview and timeline are shown, whatever the graph shows. */
export function previewScene(store: Pick<DocumentStore, 'doc' | 'sceneIndex'>): Scene {
  return store.doc.scenes[store.sceneIndex]!
}
