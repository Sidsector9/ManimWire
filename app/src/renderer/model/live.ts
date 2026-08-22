// Mirror of engine/src/engine/document/analysis.py: which nodes are live, what an
// Expression node's ports are, and which methods an Animate chain may call. The
// engine stays the authority; this lets the graph react before the engine answers.

import type { Descriptor, Parameter, TypeRef } from '../../shared/engine'
import { SELF_PORT, type DocNode, type Scene } from './document'
import type { DescriptorIndex } from './types'

export const EXPRESSION = 'Expression'
export const ANIMATE = 'Animate'
const ALWAYS_LIVE = new Set(['SceneTime', 'FrameDelta', 'State'])
const OBJECT_TYPES = new Set(['mobject', 'coordinate_system', 'animation', 'scene'])
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g

/** Variables of an expression: identifiers that are not functions or constants, sorted. */
export function expressionVariables(text: string, reserved: string[]): string[] {
  const names = new Set((text.match(IDENTIFIER) ?? []).filter((n) => !reserved.includes(n)))
  return [...names].sort()
}

/** The descriptor as the node presents it: an Expression gains one number port per variable. */
export function effectiveDescriptor(node: DocNode, descriptor: Descriptor, scene: Scene, reserved: string[]): Descriptor {
  if (descriptor.name !== EXPRESSION) return descriptor
  const text = typeof node.values['expr'] === 'string' ? node.values['expr'] : ''
  const variables = expressionVariables(text, reserved)
  const parameters: Parameter[] = [
    ...descriptor.parameters,
    ...variables.map((name) => ({
      name,
      type: { type: 'number', annotation: 'float', optional: true, collection: false, accepts: ['number', 'live_number'], signature: null, choices: null } as TypeRef,
      default: 'None',
      display: 'free',
      kind: 'positional' as const,
      owner: EXPRESSION
    }))
  ]
  const free = variables.filter((v) => !(v in node.values) && !scene.edges.some((e) => e.target === node.id && e.port === v))
  const returns: TypeRef = free.length
    ? { type: 'function', annotation: 'Callable', optional: false, collection: false, accepts: [], signature: `(${free.map(() => 'float').join(', ')}) -> float`, choices: null }
    : { type: 'number', annotation: 'float', optional: false, collection: false, accepts: [], signature: null, choices: null }
  return { ...descriptor, parameters, returns }
}

export function isObjectType(type: TypeRef): boolean {
  return OBJECT_TYPES.has(type.type)
}

function isValueNode(descriptor: Descriptor | undefined): boolean {
  return descriptor !== undefined && descriptor.kind !== 'class' && !OBJECT_TYPES.has(descriptor.returns.type)
}

/** Whether the node's output changes every frame, so a new connection from it should be live. */
export function isLiveSource(scene: Scene, nodeId: string, index: DescriptorIndex, seen = new Set<string>()): boolean {
  if (seen.has(nodeId)) return false
  seen.add(nodeId)
  const node = scene.nodes.find((n) => n.id === nodeId)
  const descriptor = node ? index.get(node.catalogue) : undefined
  if (!descriptor) return false
  if (ALWAYS_LIVE.has(descriptor.name) || descriptor.returns.type === 'live_number') return true
  return scene.edges.some((e) => e.target === nodeId && (e.live || (isValueNode(index.get(scene.nodes.find((n) => n.id === e.source)?.catalogue ?? '')) && isLiveSource(scene, e.source, index, seen))))
}

/** The node that constructs an object: follow method nodes back through their object port. */
export function rootOf(scene: Scene, nodeId: string, index: DescriptorIndex): string {
  const seen = new Set<string>()
  let current = nodeId
  while (!seen.has(current)) {
    seen.add(current)
    const node = scene.nodes.find((n) => n.id === current)
    const descriptor = node ? index.get(node.catalogue) : undefined
    const source = scene.edges.find((e) => e.target === current && e.port === SELF_PORT)
    if (!descriptor || descriptor.kind !== 'method' || descriptor.returns.annotation !== 'Self' || !source) return current
    current = source.source
  }
  return current
}

function classOf(scene: Scene, nodeId: string, index: DescriptorIndex): Descriptor | undefined {
  const root = scene.nodes.find((n) => n.id === rootOf(scene, nodeId, index))
  const descriptor = root ? index.get(root.catalogue) : undefined
  if (!descriptor) return undefined
  if (descriptor.kind === 'class') return descriptor
  return descriptor.kind === 'method' && descriptor.owner ? index.get(descriptor.owner) : undefined
}

/** Methods an Animate chain may call on the object at `nodeId`: those returning the object, own class first. */
export function chainMethods(scene: Scene, nodeId: string, index: DescriptorIndex): Descriptor[] {
  const cls = classOf(scene, nodeId, index)
  if (!cls) return []
  const found = new Map<string, Descriptor>()
  for (const name of [cls.name, ...(cls.bases ?? [])]) {
    for (const entry of index.values()) {
      if (entry.kind === 'method' && entry.owner === name && entry.returns.annotation === 'Self' && !found.has(entry.name)) found.set(entry.name, entry)
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** `.shift(RIGHT).scale(2)` for a node's chain, shown on the node. */
export function chainSummary(node: DocNode): string {
  return (node.chain ?? []).map((call) => `.${call.method}(${Object.values(call.values).map(String).join(', ')})`).join('')
}
