// The visual project document as the renderer edits it. Serialises to the
// JSON the engine's pydantic models parse (see engine/src/engine/document/model.py).

import type { Descriptor, PortType } from '../../shared/engine'

export type JsonValue = string | number | boolean | number[] | null

/** One call in an Animate node's chain: mobject.animate.method(values). */
export interface MethodCall {
  method: string
  values: Record<string, JsonValue>
}

/** One entry of a Config node: the key and the type its value is written as. */
export interface ConfigKey {
  name: string
  type: PortType
}

export interface DocNode {
  id: string
  catalogue: string
  values: Record<string, JsonValue>
  label: string | null
  position: [number, number]
  collapsed: boolean
  chain?: MethodCall[]
  config?: ConfigKey[]
  /** Map and Repeat children: the container this node runs inside. Positions are relative to it. */
  parent?: string | null
  /** Map and Repeat only: the frame size on the graph. */
  size?: [number, number] | null
}

export interface DocEdge {
  source: string
  target: string
  port: string
  live: boolean
}

export type UpdatingAction = 'suspend' | 'resume' | 'clear'
export type CameraAction = 'orient' | 'move'
export const CAMERA_FIELDS = ['phi', 'theta', 'gamma', 'zoom', 'focal_distance'] as const

export type Step =
  | {
      kind: 'play'
      animations: string[]
      run_time?: number | null
      rate_func?: string | null
      lag_ratio?: number | null
      subcaption?: string | null
      subcaption_duration?: number | null
      subcaption_offset?: number
    }
  | { kind: 'wait'; duration: number }
  | { kind: 'add'; mobjects: string[] }
  | { kind: 'remove'; mobjects: string[] }
  | { kind: 'bring_to_front'; mobjects: string[] }
  | { kind: 'bring_to_back'; mobjects: string[] }
  | { kind: 'section'; name: string; skip_animations: boolean }
  | { kind: 'sound'; file: string; time_offset: number; gain: number | null }
  | { kind: 'subcaption'; content: string; duration: number; offset: number }
  | { kind: 'updating'; mobjects: string[]; action: UpdatingAction }
  | {
      kind: 'camera'
      action: CameraAction
      phi?: number | null
      theta?: number | null
      gamma?: number | null
      zoom?: number | null
      focal_distance?: number | null
      run_time?: number | null
    }
  | { kind: 'fixed_in_frame'; mobjects: string[]; action: 'add' | 'remove' }

export type SceneType = 'Scene' | 'MovingCameraScene' | 'ThreeDScene' | 'ZoomedScene'
export const SCENE_TYPES: SceneType[] = ['Scene', 'MovingCameraScene', 'ThreeDScene', 'ZoomedScene']

export interface Scene {
  name: string
  scene_type: SceneType
  nodes: DocNode[]
  edges: DocEdge[]
  steps: Step[]
}

/** A reusable subgraph. Input and Output nodes inside it are its ports. */
export interface GroupDefinition {
  name: string
  nodes: DocNode[]
  edges: DocEdge[]
}

/** Catalogue name of a node that instantiates a group. Mirrors GROUP_PREFIX in the engine. */
export const GROUP_PREFIX = 'group:'

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'gif' | 'png'
export const EXPORT_FORMATS: ExportFormat[] = ['mp4', 'mov', 'webm', 'gif', 'png']

export interface Settings {
  pixel_width: number
  pixel_height: number
  frame_rate: number
  background_color: string
  output_format: ExportFormat
}

export interface Doc {
  version: 1
  settings: Settings
  scenes: Scene[]
  groups: GroupDefinition[]
}

/** Port name for the object a method node acts on. Mirrors SELF_PORT in the engine. */
export const SELF_PORT = 'self'

/** What an edit applies to: a scene by index, or a reusable group by name. */
export type Target = number | string

/** Default frame of a Map or Repeat on the graph. */
export const CONTAINER_SIZE: [number, number] = [440, 260]

export function emptyDocument(): Doc {
  return {
    version: 1,
    settings: { pixel_width: 1920, pixel_height: 1080, frame_rate: 60, background_color: 'BLACK', output_format: 'mp4' },
    scenes: [{ name: 'Scene1', scene_type: 'Scene', nodes: [], edges: [], steps: [] }],
    groups: []
  }
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** The graph an edit target names. A group has no steps; it is shown as a scene without them. */
export function graphOf(doc: Doc, target: Target): Scene | undefined {
  if (typeof target === 'number') return doc.scenes[target]
  const group = doc.groups.find((g) => g.name === target)
  return group ? { name: group.name, scene_type: 'Scene', nodes: group.nodes, edges: group.edges, steps: [] } : undefined
}

/** All operations return a new document; the store keeps history by reference. */
function updateScene(doc: Doc, target: Target, change: (scene: Scene) => Scene): Doc {
  const scene = graphOf(doc, target)
  if (!scene) return doc
  const changed = change(scene)
  if (changed === scene) return doc
  if (typeof target === 'number') return { ...doc, scenes: doc.scenes.map((s, i) => (i === target ? changed : s)) }
  return { ...doc, groups: doc.groups.map((g) => (g.name === target ? { name: g.name, nodes: changed.nodes, edges: changed.edges } : g)) }
}

export function addNode(
  doc: Doc,
  target: Target,
  catalogue: string,
  position: [number, number],
  values: Record<string, JsonValue> = {},
  id = newId(),
  parent: string | null = null
): Doc {
  const node: DocNode = { id, catalogue, values, label: null, position, collapsed: true }
  if (parent) node.parent = parent
  return updateScene(doc, target, (s) => ({ ...s, nodes: [...s.nodes, node] }))
}

export function removeNodes(doc: Doc, target: Target, ids: string[]): Doc {
  const scene = graphOf(doc, target)
  if (!scene) return doc
  const gone = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const node of scene.nodes) {
      if (!gone.has(node.id) && node.parent && gone.has(node.parent)) {
        gone.add(node.id) // a container takes its children with it
        grew = true
      }
    }
  }
  return updateScene(doc, target, (s) => ({
    ...s,
    nodes: s.nodes.filter((n) => !gone.has(n.id)),
    edges: s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    steps: s.steps
      .map((step) => {
        if (step.kind === 'play') return { ...step, animations: step.animations.filter((a) => !gone.has(a)) }
        if ('mobjects' in step) return { ...step, mobjects: step.mobjects.filter((m) => !gone.has(m)) }
        return step
      })
      .filter((step) => {
        if (step.kind === 'play') return step.animations.length > 0
        return 'mobjects' in step ? step.mobjects.length > 0 : true
      })
  }))
}

export function updateNode(doc: Doc, target: Target, id: string, change: Partial<DocNode>): Doc {
  return updateScene(doc, target, (s) => ({
    ...s,
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...change } : n))
  }))
}

export function setValue(doc: Doc, target: Target, id: string, port: string, value: JsonValue | undefined): Doc {
  return updateScene(doc, target, (s) => ({
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

export function connect(doc: Doc, target: Target, edge: DocEdge): Doc {
  return updateScene(doc, target, (s) => ({
    ...s,
    edges: [...s.edges.filter((e) => !(e.source === edge.source && e.target === edge.target && e.port === edge.port)), edge]
  }))
}

export function disconnect(doc: Doc, target: Target, edge: Pick<DocEdge, 'source' | 'target' | 'port'>): Doc {
  return updateScene(doc, target, (s) => ({
    ...s,
    edges: s.edges.filter((e) => !(e.source === edge.source && e.target === edge.target && e.port === edge.port))
  }))
}

export function addStep(doc: Doc, target: Target, step: Step, at?: number): Doc {
  if (typeof target !== 'number') return doc
  return updateScene(doc, target, (s) => {
    const steps = [...s.steps]
    steps.splice(at ?? steps.length, 0, step)
    return { ...s, steps }
  })
}

export function removeStep(doc: Doc, target: Target, at: number): Doc {
  return updateScene(doc, target, (s) => ({ ...s, steps: s.steps.filter((_, i) => i !== at) }))
}

export function setSettings(doc: Doc, change: Partial<Settings>): Doc {
  return { ...doc, settings: { ...doc.settings, ...change } }
}

export function renameScene(doc: Doc, sceneIndex: number, name: string): Doc {
  return updateScene(doc, sceneIndex, (s) => ({ ...s, name }))
}

export function setSceneType(doc: Doc, sceneIndex: number, scene_type: SceneType): Doc {
  return updateScene(doc, sceneIndex, (s) => ({ ...s, scene_type }))
}

// ---- containers ---------------------------------------------------------------

/** Position of a node in graph coordinates, adding up its containers' positions. */
export function absolutePosition(scene: Scene, id: string): [number, number] {
  let x = 0
  let y = 0
  let current: string | null | undefined = id
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = scene.nodes.find((n) => n.id === current)
    if (!node) break
    x += node.position[0]
    y += node.position[1]
    current = node.parent
  }
  return [x, y]
}

export function isContainer(node: DocNode): boolean {
  return node.catalogue === 'Map' || node.catalogue === 'Repeat'
}

export function containerSize(node: DocNode): [number, number] {
  return node.size ?? CONTAINER_SIZE
}

function isInside(scene: Scene, id: string, container: string): boolean {
  let current: string | null | undefined = scene.nodes.find((n) => n.id === id)?.parent
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === container) return true
    seen.add(current)
    current = scene.nodes.find((n) => n.id === current)?.parent
  }
  return false
}

/** The innermost container whose frame holds the point, ignoring `excluding` and what is inside it. */
export function containerAt(scene: Scene, point: [number, number], excluding: string | null = null): string | null {
  let best: { id: string; depth: number } | null = null
  for (const node of scene.nodes) {
    if (!isContainer(node) || node.id === excluding || (excluding && isInside(scene, node.id, excluding))) continue
    const [x, y] = absolutePosition(scene, node.id)
    const [w, h] = containerSize(node)
    if (point[0] < x || point[1] < y || point[0] > x + w || point[1] > y + h) continue
    let depth = 0
    let current = node.parent
    while (current) {
      depth += 1
      current = scene.nodes.find((n) => n.id === current)?.parent
    }
    if (!best || depth > best.depth) best = { id: node.id, depth }
  }
  return best?.id ?? null
}

/** Put a node at an absolute graph position, inside the container found there (if any). */
export function placeNode(doc: Doc, target: Target, id: string, absolute: [number, number]): Doc {
  const scene = graphOf(doc, target)
  const node = scene?.nodes.find((n) => n.id === id)
  if (!scene || !node) return doc
  const [w, h] = isContainer(node) ? containerSize(node) : [180, 40]
  const parent = containerAt(scene, [absolute[0] + w / 2, absolute[1] + h / 2], id)
  const [ox, oy] = parent ? absolutePosition(scene, parent) : [0, 0]
  const position: [number, number] = [absolute[0] - ox, absolute[1] - oy]
  if (parent === (node.parent ?? null) && position[0] === node.position[0] && position[1] === node.position[1]) return doc
  return updateNode(doc, target, id, { position, parent })
}

// ---- reusable groups ----------------------------------------------------------

export function addGroup(doc: Doc, name: string): Doc {
  if (doc.groups.some((g) => g.name === name)) return doc
  const output: DocNode = { id: newId(), catalogue: 'Output', values: {}, label: null, position: [360, 60], collapsed: true }
  return { ...doc, groups: [...doc.groups, { name, nodes: [output], edges: [] }] }
}

export function removeGroup(doc: Doc, name: string): Doc {
  const catalogue = GROUP_PREFIX + name
  let next: Doc = { ...doc, groups: doc.groups.filter((g) => g.name !== name) }
  next.scenes.forEach((scene, i) => {
    const instances = scene.nodes.filter((n) => n.catalogue === catalogue).map((n) => n.id)
    if (instances.length) next = removeNodes(next, i, instances)
  })
  return next
}

/** Add a group read from a file, renaming it when the name is taken. */
export function importGroup(doc: Doc, group: GroupDefinition): Doc {
  let name = group.name
  let counter = 2
  while (doc.groups.some((g) => g.name === name)) name = `${group.name}${counter++}`
  return { ...doc, groups: [...doc.groups, { ...group, name }] }
}

export function parseGroup(text: string): GroupDefinition {
  const raw = JSON.parse(text) as Partial<GroupDefinition> | null
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') throw new Error('not a group file')
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('a group needs nodes and edges')
  return { name: raw.name, nodes: raw.nodes, edges: raw.edges }
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
  // Expression variables and Config keys are the node's purpose, so they stay visible while collapsed.
  const always = new Set(descriptor.parameters.filter((p) => p.owner === 'Expression' || p.owner === 'Config').map((p) => p.name))
  return ports.filter((p) => connected.has(p) || p in node.values || p === SELF_PORT || always.has(p))
}

export function connectedPorts(scene: Scene, nodeId: string): Set<string> {
  return new Set(scene.edges.filter((e) => e.target === nodeId).map((e) => e.port))
}

/** Where a node added from the Library goes: to the right of the rightmost top-level node. */
export function nextPosition(scene: Scene): [number, number] {
  const top = scene.nodes.filter((n) => !n.parent)
  if (top.length === 0) return [40, 60]
  return [Math.max(...top.map((n) => n.position[0] + (isContainer(n) ? containerSize(n)[0] - 180 : 0))) + 220, 60]
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
    return { name: scene.name, scene_type: scene.scene_type ?? 'Scene', nodes: scene.nodes ?? [], edges: scene.edges ?? [], steps: scene.steps ?? [] }
  })
  const groups = Array.isArray(raw.groups) ? raw.groups : []
  return { version: 1, settings: { ...defaults.settings, ...(raw.settings ?? {}) }, scenes, groups }
}

/** Move an animation to another play step, or to a new play step at the end when `to` is null. */
export function moveAnimation(doc: Doc, target: Target, node: string, from: number, to: number | null): Doc {
  return updateScene(doc, target, (s) => {
    if (s.steps[from]?.kind !== 'play' || (to !== null && s.steps[to]?.kind !== 'play')) return s
    const steps = s.steps.map((step, i) =>
      i === from && step.kind === 'play' ? { ...step, animations: step.animations.filter((a) => a !== node) } : step
    )
    if (to === null) steps.push({ kind: 'play', animations: [node] })
    else {
      const target = steps[to]
      if (target?.kind === 'play' && !target.animations.includes(node)) steps[to] = { ...target, animations: [...target.animations, node] }
    }
    return { ...s, steps: steps.filter((step) => step.kind !== 'play' || step.animations.length > 0) }
  })
}

export function moveStep(doc: Doc, target: Target, from: number, to: number): Doc {
  return updateScene(doc, target, (s) => {
    const steps = [...s.steps]
    const [step] = steps.splice(from, 1)
    if (step) steps.splice(to, 0, step)
    return { ...s, steps }
  })
}
