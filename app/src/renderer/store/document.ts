import { create } from 'zustand'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { liveByDefault } from '../model/live'
import { acceptingPorts, portType, type DescriptorIndex } from '../model/types'
import {
  addNode,
  addStep,
  connect,
  disconnect,
  emptyDocument,
  moveAnimation,
  moveStep,
  removeNodes,
  removeStep,
  setSettings,
  setValue,
  updateNode,
  type Doc,
  type DocEdge,
  type DocNode,
  newId,
  type JsonValue,
  type Step
} from '../model/document'

const HISTORY_LIMIT = 100
/** Consecutive edits of the same field within this window share one history entry. */
const COALESCE_MS = 1000

interface DocumentStore {
  doc: Doc
  sceneIndex: number
  filePath: string | null
  dirty: boolean
  past: Doc[]
  future: Doc[]
  selected: string | null
  selectedStep: number | null
  lastEdit: { key: string; at: number } | null

  replace(doc: Doc, filePath: string | null): void
  apply(change: (doc: Doc) => Doc): void
  addNode(catalogue: string, position: [number, number], values?: Record<string, JsonValue>): string
  /** Add a catalogue entry, connect it to `from` if given, and play it if it is an animation. One history entry. */
  addCatalogueNode(descriptor: Descriptor, position: [number, number], index: DescriptorIndex, from?: { node: string; type: TypeRef }): string
  removeNodes(ids: string[]): void
  updateNode(id: string, change: Partial<DocNode>): void
  moveNode(id: string, position: [number, number]): void
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
  select(id: string | null): void
  undo(): void
  redo(): void
  markSaved(filePath: string): void
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  const record = (next: Doc): void => {
    const { doc, past } = get()
    set({ doc: next, past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [], dirty: true, lastEdit: null })
  }
  const coalesce = (key: string, next: Doc): void => {
    const { lastEdit } = get()
    const now = Date.now()
    if (lastEdit && lastEdit.key === key && now - lastEdit.at < COALESCE_MS) {
      set({ doc: next, dirty: true, lastEdit: { key, at: now } })
      return
    }
    record(next)
    set({ lastEdit: { key, at: now } })
  }
  return {
    doc: emptyDocument(),
    sceneIndex: 0,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    selected: null,
    selectedStep: null,
    lastEdit: null,

    replace: (doc, filePath) => set({ doc, filePath, dirty: false, past: [], future: [], selected: null, selectedStep: null, lastEdit: null }),
    apply: (change) => record(change(get().doc)),
    addNode: (catalogue, position, values = {}) => {
      const { doc, sceneIndex } = get()
      const next = addNode(doc, sceneIndex, catalogue, position, values)
      record(next)
      const added = next.scenes[sceneIndex]!.nodes.at(-1)!
      set({ selected: added.id })
      return added.id
    },
    addCatalogueNode: (descriptor, position, index, from) => {
      const { doc, sceneIndex } = get()
      const id = newId()
      let next = addNode(doc, sceneIndex, descriptor.qualname, position, {}, id)
      const port = from ? acceptingPorts(from.type, descriptor, index)[0] : undefined
      if (from && port) {
        const live = liveByDefault(doc.scenes[sceneIndex]!, from.node, portType(descriptor, port, index), index)
        next = connect(next, sceneIndex, { source: from.node, target: id, port, live })
      }
      if (descriptor.returns.type === 'animation') next = addStep(next, sceneIndex, { kind: 'play', animations: [id] })
      record(next)
      set({ selected: id })
      return id
    },
    removeNodes: (ids) => {
      const { doc, sceneIndex, selected } = get()
      record(removeNodes(doc, sceneIndex, ids))
      if (selected && ids.includes(selected)) set({ selected: null })
    },
    updateNode: (id, change) => {
      const next = updateNode(get().doc, get().sceneIndex, id, change)
      const keys = Object.keys(change)
      if (keys.length === 1 && keys[0] === 'label') coalesce(`${id}:label`, next)
      else record(next)
    },
    // Moves change layout only, so they do not create history entries.
    moveNode: (id, position) =>
      set({ doc: updateNode(get().doc, get().sceneIndex, id, { position }), dirty: true }),
    setValue: (id, port, value) => coalesce(`${id}:${port}`, setValue(get().doc, get().sceneIndex, id, port, value)),
    connect: (edge) => record(connect(get().doc, get().sceneIndex, edge)),
    disconnect: (edge) => record(disconnect(get().doc, get().sceneIndex, edge)),
    setPortLive: (target, port, live) => {
      const { doc, sceneIndex } = get()
      const scene = doc.scenes[sceneIndex]
      if (!scene) return
      record({
        ...doc,
        scenes: doc.scenes.map((s, i) =>
          i === sceneIndex ? { ...s, edges: s.edges.map((e) => (e.target === target && e.port === port ? { ...e, live } : e)) } : s
        )
      })
    },
    addStep: (step, at) => record(addStep(get().doc, get().sceneIndex, step, at)),
    removeStep: (at) => {
      record(removeStep(get().doc, get().sceneIndex, at))
      const { selectedStep } = get()
      if (selectedStep === at) set({ selectedStep: null })
      else if (selectedStep !== null && selectedStep > at) set({ selectedStep: selectedStep - 1 })
    },
    moveStep: (from, to) => {
      record(moveStep(get().doc, get().sceneIndex, from, to))
      set({ selectedStep: to })
    },
    moveAnimation: (node, from, to) => record(moveAnimation(get().doc, get().sceneIndex, node, from, to)),
    selectStep: (at) => set({ selectedStep: at }),
    updateStep: (at, step) =>
      coalesce(
        `step:${at}`,
        addStep(removeStep(get().doc, get().sceneIndex, at), get().sceneIndex, step, at)
      ),
    setSettings: (change) => record(setSettings(get().doc, change)),
    select: (id) => set(id === null ? { selected: null, selectedStep: null } : { selected: id }),
    undo: () => {
      const { doc, past, future } = get()
      const previous = past.at(-1)
      if (!previous) return
      set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], dirty: true, lastEdit: null })
    },
    redo: () => {
      const { doc, past, future } = get()
      const [next, ...rest] = future
      if (!next) return
      set({ doc: next, past: [...past, doc], future: rest, dirty: true, lastEdit: null })
    },
    markSaved: (filePath) => set({ filePath, dirty: false })
  }
})

export function currentScene(store: Pick<DocumentStore, 'doc' | 'sceneIndex'>) {
  return store.doc.scenes[store.sceneIndex]!
}
