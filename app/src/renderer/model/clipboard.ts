import {
  absolutePosition, containerAt, graphOf, newId, updateScene,
  type Doc, type DocEdge, type DocNode, type JsonValue, type Scene, type Target
} from './document'

export const GRAPH_CLIPBOARD_TYPE = 'application/x-manimwire-graph'

export interface GraphSelection {
  kind: 'manimwire/graph'
  version: 1
  nodes: DocNode[]
  edges: DocEdge[]
}

/** A snapshot of the selected nodes, their container contents, and internal wires.
 * Root positions are relative to the selection's top left, children to their parent. */
export function copySelection(scene: Scene, selected: string[]): GraphSelection | null {
  const ids = new Set(selected)
  let grew = true
  while (grew) {
    grew = false
    for (const node of scene.nodes) {
      if (node.parent && ids.has(node.parent) && !ids.has(node.id)) {
        ids.add(node.id)
        grew = true
      }
    }
  }
  const picked = scene.nodes.filter((node) => ids.has(node.id))
  if (!picked.length) return null
  const roots = picked.filter((node) => !node.parent || !ids.has(node.parent))
  const positions = roots.map((node) => absolutePosition(scene, node.id))
  const origin = [Math.min(...positions.map(([x]) => x)), Math.min(...positions.map(([, y]) => y))]
  const nodes = picked.map((node): DocNode => {
    const copy = structuredClone(node)
    if (!node.parent || !ids.has(node.parent)) {
      const [x, y] = absolutePosition(scene, node.id)
      copy.parent = null
      copy.position = [x - origin[0]!, y - origin[1]!]
    }
    return copy
  })
  const edges = structuredClone(scene.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)))
  return { kind: 'manimwire/graph', version: 1, nodes, edges }
}

/** Paste only the graph. Timeline steps are authored separately, as in the Inspector. */
export function pasteSelection(doc: Doc, target: Target, selection: GraphSelection, at: [number, number]): { doc: Doc; ids: string[] } {
  const scene = graphOf(doc, target)
  if (!scene || !selection.nodes.length) return { doc, ids: [] }
  const taken = new Set(scene.nodes.map((node) => node.id))
  const ids = new Map<string, string>()
  for (const node of selection.nodes) {
    let id = newId()
    while (taken.has(id)) id = newId()
    taken.add(id)
    ids.set(node.id, id)
  }
  let parent = containerAt(scene, at)
  // Pasting over the container just copied must not nest the copy inside itself.
  while (parent && ids.has(parent)) parent = scene.nodes.find((node) => node.id === parent)?.parent ?? null
  const [ox, oy] = parent ? absolutePosition(scene, parent) : [0, 0]
  const nodes = selection.nodes.map((node): DocNode => {
    const copy = structuredClone(node)
    const copiedParent = node.parent ? ids.get(node.parent) : undefined
    return {
      ...copy,
      id: ids.get(node.id)!,
      parent: copiedParent ?? parent,
      position: copiedParent ? copy.position : [at[0] + node.position[0] - ox, at[1] + node.position[1] - oy]
    }
  })
  const edges = selection.edges.map((edge) => ({ ...edge, source: ids.get(edge.source)!, target: ids.get(edge.target)! }))
  return {
    doc: updateScene(doc, target, (graph) => ({ ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] })),
    ids: [...ids.values()]
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const point = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every(finite)
const strings = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === 'string')
const ports = new Set(['mobject', 'coordinate_system', 'number', 'live_number', 'vector', 'color', 'function', 'animation', 'text', 'boolean', 'config', 'scene', 'none', 'any'])

function literal(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return true
  return Array.isArray(value) && (value.every(finite) || strings(value) || value.every((row) => Array.isArray(row) && row.every(finite)))
}

function values(value: unknown): boolean {
  return record(value) && Object.values(value).every(literal)
}

function isNode(value: unknown): value is DocNode {
  if (!record(value)) return false
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.catalogue === 'string' && value.catalogue.length > 0
    && values(value.values) && (value.label === null || typeof value.label === 'string')
    && point(value.position) && typeof value.collapsed === 'boolean'
    && (value.parent == null || typeof value.parent === 'string')
    && (value.size == null || point(value.size))
    && (value.pinned === undefined || strings(value.pinned))
    && (value.chain === undefined || (Array.isArray(value.chain) && value.chain.every((call) => record(call) && typeof call.method === 'string' && values(call.values))))
    && (value.config === undefined || (Array.isArray(value.config) && value.config.every((key) => record(key) && typeof key.name === 'string' && typeof key.type === 'string' && ports.has(key.type))))
}

/** Ordinary text and malformed clipboard data must never change the document. */
export function parseSelection(text: string): GraphSelection | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!record(value) || value.kind !== 'manimwire/graph' || value.version !== 1
      || !Array.isArray(value.nodes) || !value.nodes.length || !value.nodes.every(isNode) || !Array.isArray(value.edges)) return null
    const nodes = new Map<string, DocNode>(value.nodes.map((node) => [node.id, node]))
    if (nodes.size !== value.nodes.length) return null
    for (const node of nodes.values()) {
      const ancestors = new Set([node.id])
      let parent = node.parent
      while (parent) {
        const container = nodes.get(parent)
        if (!container || !['Map', 'Repeat'].includes(container.catalogue) || ancestors.has(parent)) return null
        ancestors.add(parent)
        parent = container.parent
      }
    }
    if (!value.edges.every((edge) => record(edge) && typeof edge.source === 'string' && nodes.has(edge.source)
      && typeof edge.target === 'string' && nodes.has(edge.target) && typeof edge.port === 'string' && typeof edge.live === 'boolean')) return null
    return { kind: 'manimwire/graph', version: 1, nodes: value.nodes, edges: value.edges as DocEdge[] }
  } catch {
    return null
  }
}
