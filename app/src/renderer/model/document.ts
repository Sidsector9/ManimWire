// The visual project document as the renderer edits it. Serialises to the
// JSON the engine's pydantic models parse (see engine/src/engine/document/model.py).

import type { Descriptor } from '../../shared/engine'

export type JsonValue = string | number | boolean | number[] | null

export interface DocNode {
  id: string
  catalogue: string
  values: Record<string, JsonValue>
  label: string | null
  position: [number, number]
  collapsed: boolean
}

export interface DocEdge {
  source: string
  target: string
  port: string
  live: boolean
}

export type Step =
  | { kind: 'play'; animations: string[] }
  | { kind: 'wait'; duration: number }
  | { kind: 'add'; mobjects: string[] }
  | { kind: 'remove'; mobjects: string[] }

export interface Scene {
  name: string
  nodes: DocNode[]
  edges: DocEdge[]
  steps: Step[]
}

export interface Settings {
  pixel_width: number
  pixel_height: number
  frame_rate: number
  background_color: string
}

export interface Doc {
  version: 1
  settings: Settings
  scenes: Scene[]
}

/** Port name for the object a method node acts on. Mirrors SELF_PORT in the engine. */
export const SELF_PORT = 'self'

export function emptyDocument(): Doc {
  return {
    version: 1,
    settings: { pixel_width: 1920, pixel_height: 1080, frame_rate: 60, background_color: 'BLACK' },
    scenes: [{ name: 'Scene1', nodes: [], edges: [], steps: [] }]
  }
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** All operations return a new document; the store keeps history by reference. */
function updateScene(doc: Doc, index: number, change: (scene: Scene) => Scene): Doc {
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === index ? change(s) : s)) }
}

export function addNode(
  doc: Doc,
  sceneIndex: number,
  catalogue: string,
  position: [number, number],
  values: Record<string, JsonValue> = {},
  id = newId()
): Doc {
  const node: DocNode = { id, catalogue, values, label: null, position, collapsed: true }
  return updateScene(doc, sceneIndex, (s) => ({ ...s, nodes: [...s.nodes, node] }))
}

export function removeNodes(doc: Doc, sceneIndex: number, ids: string[]): Doc {
  const gone = new Set(ids)
  return updateScene(doc, sceneIndex, (s) => ({
    ...s,
    nodes: s.nodes.filter((n) => !gone.has(n.id)),
    edges: s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    steps: s.steps
      .map((step) => {
        if (step.kind === 'play') return { ...step, animations: step.animations.filter((a) => !gone.has(a)) }
        if (step.kind === 'add' || step.kind === 'remove') {
          return { ...step, mobjects: step.mobjects.filter((m) => !gone.has(m)) }
        }
        return step
      })
      .filter((step) => step.kind === 'wait' || (step.kind === 'play' ? step.animations : step.mobjects).length > 0)
  }))
}

export function updateNode(doc: Doc, sceneIndex: number, id: string, change: Partial<DocNode>): Doc {
  return updateScene(doc, sceneIndex, (s) => ({
    ...s,
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...change } : n))
  }))
}

export function setValue(doc: Doc, sceneIndex: number, id: string, port: string, value: JsonValue | undefined): Doc {
  return updateScene(doc, sceneIndex, (s) => ({
    ...s,
    nodes: s.nodes.map((n) => {
      if (n.id !== id) return n
      const values = { ...n.values }
      if (value === undefined) delete values[port]
      else values[port] = value
      return { ...n, values }
    })
  }))
}

export function connect(doc: Doc, sceneIndex: number, edge: DocEdge): Doc {
  return updateScene(doc, sceneIndex, (s) => ({
    ...s,
    edges: [...s.edges.filter((e) => !(e.source === edge.source && e.target === edge.target && e.port === edge.port)), edge]
  }))
}

export function disconnect(doc: Doc, sceneIndex: number, edge: Pick<DocEdge, 'source' | 'target' | 'port'>): Doc {
  return updateScene(doc, sceneIndex, (s) => ({
    ...s,
    edges: s.edges.filter((e) => !(e.source === edge.source && e.target === edge.target && e.port === edge.port))
  }))
}

export function addStep(doc: Doc, sceneIndex: number, step: Step, at?: number): Doc {
  return updateScene(doc, sceneIndex, (s) => {
    const steps = [...s.steps]
    steps.splice(at ?? steps.length, 0, step)
    return { ...s, steps }
  })
}

export function removeStep(doc: Doc, sceneIndex: number, at: number): Doc {
  return updateScene(doc, sceneIndex, (s) => ({ ...s, steps: s.steps.filter((_, i) => i !== at) }))
}

export function setSettings(doc: Doc, change: Partial<Settings>): Doc {
  return { ...doc, settings: { ...doc.settings, ...change } }
}

export function renameScene(doc: Doc, sceneIndex: number, name: string): Doc {
  return updateScene(doc, sceneIndex, (s) => ({ ...s, name }))
}

/** Circle -> set_fill(BLUE) -> Create, the scene from goal.md section 34. */
export function starterDocument(): Doc {
  let doc = emptyDocument()
  doc = addNode(doc, 0, 'Circle', [40, 60], { radius: 2 }, 'circle')
  doc = addNode(doc, 0, 'VMobject.set_fill', [280, 60], { color: 'BLUE', opacity: 1 }, 'fill')
  doc = addNode(doc, 0, 'Create', [520, 60], { run_time: 2 }, 'create')
  doc = connect(doc, 0, { source: 'circle', target: 'fill', port: SELF_PORT, live: false })
  doc = connect(doc, 0, { source: 'fill', target: 'create', port: 'mobject', live: false })
  return addStep(doc, 0, { kind: 'play', animations: ['create'] })
}

/** Ports that a node shows while collapsed: connected ones and ones with a value. */
export function visiblePorts(node: DocNode, descriptor: Descriptor, connected: Set<string>): string[] {
  const ports = descriptor.parameters.map((p) => p.name)
  if (descriptor.kind === 'method') ports.unshift(SELF_PORT)
  if (!node.collapsed) return ports
  return ports.filter((p) => connected.has(p) || p in node.values || p === SELF_PORT)
}

export function connectedPorts(scene: Scene, nodeId: string): Set<string> {
  return new Set(scene.edges.filter((e) => e.target === nodeId).map((e) => e.port))
}

/** Where a node added from the Library goes: to the right of the rightmost node. */
export function nextPosition(scene: Scene): [number, number] {
  if (scene.nodes.length === 0) return [40, 60]
  return [Math.max(...scene.nodes.map((n) => n.position[0])) + 220, 60]
}

/** Parse a project file, filling defaults and refusing shapes the engine would not accept. */
export function parseDocument(text: string): Doc {
  const raw = JSON.parse(text) as Partial<Doc> | null
  if (!raw || typeof raw !== 'object') throw new Error('not a project file')
  if (raw.version !== 1) throw new Error(`unsupported version ${String(raw.version)}`)
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new Error('no scenes')
  const defaults = emptyDocument()
  const scenes: Scene[] = raw.scenes.map((scene, i) => {
    if (typeof scene?.name !== 'string') throw new Error(`scene ${i} has no name`)
    for (const key of ['nodes', 'edges', 'steps'] as const) {
      if (scene[key] !== undefined && !Array.isArray(scene[key])) throw new Error(`scene ${scene.name}: ${key} must be a list`)
    }
    return { name: scene.name, nodes: scene.nodes ?? [], edges: scene.edges ?? [], steps: scene.steps ?? [] }
  })
  return { version: 1, settings: { ...defaults.settings, ...(raw.settings ?? {}) }, scenes }
}
