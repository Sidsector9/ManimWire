// Mirror of engine/src/engine/document/analysis.py: which nodes are live, what an
// Expression or Animate node's ports are, and which methods an Animate chain may
// call. The engine stays the authority; this lets the graph react before it answers.

import type { Descriptor, Parameter, TypeRef } from '../../shared/engine'
import { SELF_PORT, type DocNode, type Scene } from './document'
import type { DescriptorIndex } from './types'

export const EXPRESSION = 'Expression'
export const ANIMATE = 'Animate'
const ALWAYS_LIVE = new Set(['SceneTime', 'FrameDelta', 'State'])
const PARTS = new Set(['Submobject', 'Submobjects'])
// Methods annotated Self that build a new object rather than change the one they
// are called on. Mirror of COPYING_METHODS in engine/src/engine/catalogue/model.py.
const COPIES = new Set(['copy'])

function copiesItsObject(descriptor: Descriptor): boolean {
  return descriptor.kind === 'method' && descriptor.returns.annotation === 'Self' && COPIES.has(descriptor.name)
}
const OBJECT_TYPES = new Set(['mobject', 'coordinate_system', 'animation', 'scene'])
// An identifier that does not continue a number or another identifier (1e5 is a number).
const IDENTIFIER = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g

/** Variables of an expression: identifiers that are not functions or constants, sorted. */
export function expressionVariables(text: string, reserved: string[]): string[] {
  const names = new Set((text.match(IDENTIFIER) ?? []).filter((n) => !reserved.includes(n)))
  return [...names].sort()
}

/** Port name for one parameter of one call in an Animate chain. */
export function chainPort(position: number, method: string, parameter: string): string {
  return `${position + 1}.${method}.${parameter}`
}

const NUMBER: TypeRef = { type: 'number', annotation: 'float', optional: false, collection: false, accepts: [], signature: null, choices: null }

/** The type a node's output has for connection checks: time, frame delta, and state are numbers, not objects. */
export function producedType(descriptor: Descriptor): TypeRef {
  return descriptor.returns.type === 'live_number' && descriptor.kind !== 'class' ? NUMBER : descriptor.returns
}

/**
 * The descriptor as the node presents it: an Expression gains one number port per
 * variable and its output type; an Animate gains one port per chain argument.
 */
export function effectiveDescriptor(node: DocNode, descriptor: Descriptor, scene: Scene, reserved: string[], index: DescriptorIndex): Descriptor {
  if (descriptor.name === ANIMATE) {
    const source = scene.edges.find((e) => e.target === node.id && e.port === 'mobject')
    const methods = source ? chainMethods(scene, source.source, index) : []
    const parameters = (node.chain ?? []).flatMap((call, position) =>
      (methods.find((m) => m.name === call.method)?.parameters ?? []).map((param) => ({
        ...param,
        name: chainPort(position, call.method, param.name),
        display: 'chain',
        owner: ANIMATE
      }))
    )
    return parameters.length ? { ...descriptor, parameters: [...descriptor.parameters, ...parameters] } : descriptor
  }
  if (descriptor.name !== EXPRESSION) return descriptor
  const text = typeof node.values['expr'] === 'string' ? node.values['expr'] : ''
  const variables = expressionVariables(text, reserved)
  const parameters: Parameter[] = [
    ...descriptor.parameters,
    ...variables.map((name) => ({
      name,
      type: { ...NUMBER, optional: true, accepts: ['number', 'live_number'] } as TypeRef,
      default: 'None',
      display: 'free',
      kind: 'positional' as const,
      owner: EXPRESSION
    }))
  ]
  const free = variables.filter((v) => !(v in node.values) && !scene.edges.some((e) => e.target === node.id && e.port === v))
  const returns: TypeRef = free.length
    ? { ...NUMBER, type: 'function', annotation: 'Callable', signature: `(${free.map(() => 'float').join(', ')}) -> float` }
    : NUMBER
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
  return scene.edges.some((e) => {
    if (e.target !== nodeId) return false
    if (e.live) return true
    // A method on an object redrawn every frame runs every frame too.
    if (e.port === SELF_PORT) return isLiveSource(scene, e.source, index, seen)
    const source = index.get(scene.nodes.find((n) => n.id === e.source)?.catalogue ?? '')
    return isValueNode(source) && isLiveSource(scene, e.source, index, seen)
  })
}

/** Whether a new connection should be live: a live source feeding a value port. */
export function liveByDefault(scene: Scene, source: string, accepted: TypeRef | null, index: DescriptorIndex): boolean {
  return accepted !== null && !isObjectType(accepted) && isLiveSource(scene, source, index)
}

/** The node that constructs an object: follow self-returning method nodes back through their object port. */
export function rootOf(scene: Scene, nodeId: string, index: DescriptorIndex): string {
  const seen = new Set<string>()
  let current = nodeId
  while (!seen.has(current)) {
    seen.add(current)
    const node = scene.nodes.find((n) => n.id === current)
    const descriptor = node ? index.get(node.catalogue) : undefined
    const source = scene.edges.find((e) => e.target === current && e.port === SELF_PORT)
    if (!descriptor || descriptor.kind !== 'method' || descriptor.returns.annotation !== 'Self' || copiesItsObject(descriptor) || !source) return current
    current = source.source
  }
  return current
}

function classOf(scene: Scene, nodeId: string, index: DescriptorIndex): Descriptor | undefined {
  const root = scene.nodes.find((n) => n.id === rootOf(scene, nodeId, index))
  const descriptor = root ? index.get(root.catalogue) : undefined
  if (!descriptor) return undefined
  if (descriptor.kind === 'class') return descriptor
  if (descriptor.kind === 'method') {
    if (root && copiesItsObject(descriptor)) {
      // A copy is the same kind of object as what it was copied from.
      const source = scene.edges.find((e) => e.target === root.id && e.port === SELF_PORT)
      return source ? classOf(scene, source.source, index) : undefined
    }
    // A method building a new object (axes.plot -> ParametricFunction) names its class.
    return descriptor.returns.annotation === 'Self' && descriptor.owner ? index.get(descriptor.owner) : index.get(descriptor.returns.annotation)
  }
  if (root && PARTS.has(descriptor.name)) {
    // All Manim promises about a part is that a VMobject's parts are VMobjects.
    const source = scene.edges.find((e) => e.target === root.id && e.port === 'mobject')
    const owner = source ? classOf(scene, source.source, index) : undefined
    if (owner?.is_vmobject) return index.get('VMobject')
  }
  // Engine nodes standing for a Manim object (CameraFrame -> ScreenRectangle).
  return index.get(descriptor.returns.annotation)
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
