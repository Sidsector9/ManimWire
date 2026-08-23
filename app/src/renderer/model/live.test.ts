import { describe, expect, it } from 'vitest'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { SELF_PORT, type DocNode, type Scene } from './document'
import { chainMethods, chainPort, effectiveDescriptor, expressionVariables, isLiveSource, liveByDefault, producedType, rootOf } from './live'
import { indexDescriptors } from './types'

const ref = (type: TypeRef['type'], annotation = ''): TypeRef => ({ type, annotation, optional: false, collection: false, accepts: [], signature: null, choices: null })
const entry = (partial: Partial<Descriptor> & Pick<Descriptor, 'name' | 'qualname' | 'kind' | 'returns'>): Descriptor => ({
  module: 'manim',
  category: 'geometry',
  parameters: [],
  accepts_kwargs: false,
  doc: '',
  is_vmobject: true,
  hidden: false,
  ...partial
})
const index = indexDescriptors([
  entry({ name: 'Expression', qualname: 'Expression', kind: 'builtin', returns: ref('any'), parameters: [{ name: 'expr', type: ref('text'), owner: 'engine' }] }),
  entry({ name: 'ValueTracker', qualname: 'ValueTracker', kind: 'class', returns: ref('live_number') }),
  entry({ name: 'Circle', qualname: 'Circle', kind: 'class', returns: ref('mobject'), bases: ['Arc', 'VMobject', 'Mobject'] }),
  entry({ name: 'Dot', qualname: 'Dot', kind: 'class', returns: ref('mobject') }),
  entry({ name: 'SceneTime', qualname: 'SceneTime', kind: 'builtin', returns: ref('live_number') }),
  entry({ name: 'Animate', qualname: 'Animate', kind: 'builtin', returns: ref('animation'), parameters: [{ name: 'mobject', type: ref('mobject'), owner: 'engine' }] }),
  entry({ name: 'shift', qualname: 'Mobject.shift', kind: 'method', owner: 'Mobject', returns: ref('mobject', 'Self'), parameters: [{ name: 'vectors', type: ref('vector'), kind: 'var_positional', owner: 'Mobject' }] }),
  entry({ name: 'scale', qualname: 'Mobject.scale', kind: 'method', owner: 'Mobject', returns: ref('mobject', 'Self') }),
  entry({ name: 'scale', qualname: 'VMobject.scale', kind: 'method', owner: 'VMobject', returns: ref('mobject', 'Self') }),
  entry({ name: 'get_center', qualname: 'Mobject.get_center', kind: 'method', owner: 'Mobject', returns: ref('vector', 'np.ndarray') }),
  entry({ name: 'plot', qualname: 'CoordinateSystem.plot', kind: 'method', owner: 'CoordinateSystem', returns: ref('mobject', 'ParametricFunction') })
])
const node = (id: string, catalogue: string, values: DocNode['values'] = {}): DocNode => ({ id, catalogue, values, label: null, position: [0, 0], collapsed: true })
const RESERVED = ['sin', 'pi']

describe('expression ports', () => {
  it('lists variables sorted, ignoring functions and constants', () => {
    expect(expressionVariables('k / t + sin(pi * x)^2', RESERVED)).toEqual(['k', 't', 'x'])
    expect(expressionVariables('', RESERVED)).toEqual([])
    expect(expressionVariables('1e5 * x + 2x', RESERVED)).toEqual(['x'])
  })

  it('adds one number port per variable and types the output by the free ones', () => {
    const expression = node('e', 'Expression', { expr: 'a * x', a: 2 })
    const scene: Scene = { name: 'S', scene_type: 'Scene', nodes: [expression], edges: [], steps: [] }
    const effective = effectiveDescriptor(expression, index.get('Expression')!, scene, RESERVED, index)
    expect(effective.parameters.map((p) => p.name)).toEqual(['expr', 'a', 'x'])
    expect(effective.parameters[2]!.type.accepts).toEqual(['number', 'live_number'])
    expect(effective.returns).toMatchObject({ type: 'function', signature: '(float) -> float' })
    scene.edges.push({ source: 'v', target: 'e', port: 'x', live: true })
    expect(effectiveDescriptor(expression, index.get('Expression')!, scene, RESERVED, index).returns.type).toBe('number')
  })
})

describe('liveness', () => {
  const scene: Scene = {
    name: 'S',
    scene_type: 'Scene',
    nodes: [node('v', 'ValueTracker'), node('e', 'Expression', { expr: 'x * 2' }), node('c', 'Circle'), node('t', 'SceneTime'), node('k', 'Expression', { expr: '3' })],
    edges: [
      { source: 'v', target: 'e', port: 'x', live: true },
      { source: 'e', target: 'c', port: 'radius', live: false }
    ],
    steps: []
  }

  it('treats trackers, time, and nodes reading a live connection as live', () => {
    expect(isLiveSource(scene, 'v', index)).toBe(true)
    expect(isLiveSource(scene, 't', index)).toBe(true)
    expect(isLiveSource(scene, 'e', index)).toBe(true)
    expect(isLiveSource(scene, 'k', index)).toBe(false)
  })

  it('makes a method on a live object live, and only trackers count as objects', () => {
    const withMethod: Scene = { ...scene, nodes: [...scene.nodes, node('s', 'Mobject.shift')], edges: [...scene.edges, { source: 'c', target: 's', port: SELF_PORT, live: false }] }
    expect(isLiveSource(withMethod, 's', index)).toBe(true)
    expect(producedType(index.get('SceneTime')!).type).toBe('number')
    expect(producedType(index.get('ValueTracker')!).type).toBe('live_number')
    const mobject = { ...index.get('Circle')!.returns }
    expect(liveByDefault(scene, 'v', mobject, index)).toBe(false)
    expect(liveByDefault(scene, 'v', { ...mobject, type: 'number' }, index)).toBe(true)
    expect(liveByDefault(scene, 'k', { ...mobject, type: 'number' }, index)).toBe(false)
  })

  it('carries liveness through value nodes but not through objects', () => {
    expect(isLiveSource(scene, 'c', index)).toBe(true)
    const consumer: Scene = { ...scene, nodes: [...scene.nodes, node('d', 'Dot')], edges: [...scene.edges, { source: 'c', target: 'd', port: 'point', live: false }] }
    expect(isLiveSource(consumer, 'd', index)).toBe(false)
  })
})

describe('object roots and animate methods', () => {
  const scene: Scene = {
    name: 'S',
    scene_type: 'Scene',
    nodes: [node('c', 'Circle'), node('s', 'Mobject.shift'), node('g', 'Mobject.get_center'), node('p', 'CoordinateSystem.plot')],
    edges: [
      { source: 'c', target: 's', port: SELF_PORT, live: false },
      { source: 's', target: 'g', port: SELF_PORT, live: false },
      { source: 'c', target: 'p', port: SELF_PORT, live: false }
    ],
    steps: []
  }

  it('follows self-returning methods back to the constructor only', () => {
    expect(rootOf(scene, 's', index)).toBe('c')
    expect(rootOf(scene, 'g', index)).toBe('g')
    expect(rootOf(scene, 'p', index)).toBe('p')
  })

  it('offers self-returning methods of the class and its bases, nearest class first', () => {
    expect(chainMethods(scene, 's', index).map((m) => m.qualname)).toEqual(['VMobject.scale', 'Mobject.shift'])
  })

  it('gives an Animate node one port per chain argument', () => {
    const animate: DocNode = { ...node('a', 'Animate'), chain: [{ method: 'shift', values: {} }] }
    const withAnimate: Scene = { ...scene, nodes: [...scene.nodes, animate], edges: [...scene.edges, { source: 'c', target: 'a', port: 'mobject', live: false }] }
    const effective = effectiveDescriptor(animate, index.get('Animate')!, withAnimate, RESERVED, index)
    expect(effective.parameters.map((p) => p.name)).toEqual(['mobject', chainPort(0, 'shift', 'vectors')])
    expect(effective.parameters[1]).toMatchObject({ display: 'chain', owner: 'Animate', kind: 'var_positional' })
  })
})
