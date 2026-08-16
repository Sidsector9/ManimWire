import { describe, expect, it } from 'vitest'
import type { Descriptor } from '../../shared/engine'
import {
  addNode,
  addStep,
  connect,
  connectedPorts,
  disconnect,
  emptyDocument,
  nextPosition,
  parseDocument,
  removeNodes,
  removeStep,
  setValue,
  starterDocument,
  visiblePorts
} from './document'

describe('document operations', () => {
  it('adds and removes nodes together with their edges and step references', () => {
    let doc = addNode(emptyDocument(), 0, 'Circle', [0, 0], { radius: 2 }, 'c')
    doc = addNode(doc, 0, 'Create', [10, 0], {}, 'a')
    doc = connect(doc, 0, { source: 'c', target: 'a', port: 'mobject', live: false })
    doc = addStep(doc, 0, { kind: 'play', animations: ['a'] })
    doc = addStep(doc, 0, { kind: 'wait', duration: 1 })
    expect(doc.scenes[0]!.edges).toHaveLength(1)

    doc = removeNodes(doc, 0, ['a'])
    expect(doc.scenes[0]!.nodes.map((n) => n.id)).toEqual(['c'])
    expect(doc.scenes[0]!.edges).toEqual([])
    expect(doc.scenes[0]!.steps).toEqual([{ kind: 'wait', duration: 1 }])
  })

  it('sets and clears literal values', () => {
    let doc = addNode(emptyDocument(), 0, 'Circle', [0, 0], {}, 'c')
    doc = setValue(doc, 0, 'c', 'radius', 3)
    expect(doc.scenes[0]!.nodes[0]!.values).toEqual({ radius: 3 })
    doc = setValue(doc, 0, 'c', 'radius', undefined)
    expect(doc.scenes[0]!.nodes[0]!.values).toEqual({})
  })

  it('replaces an existing connection into the same port', () => {
    let doc = addNode(emptyDocument(), 0, 'Circle', [0, 0], {}, 'c')
    doc = addNode(doc, 0, 'Create', [10, 0], {}, 'a')
    doc = connect(doc, 0, { source: 'c', target: 'a', port: 'mobject', live: false })
    doc = connect(doc, 0, { source: 'c', target: 'a', port: 'mobject', live: true })
    expect(doc.scenes[0]!.edges).toEqual([{ source: 'c', target: 'a', port: 'mobject', live: true }])
    doc = disconnect(doc, 0, { source: 'c', target: 'a', port: 'mobject' })
    expect(doc.scenes[0]!.edges).toEqual([])
  })

  it('inserts and removes steps at positions', () => {
    let doc = addStep(emptyDocument(), 0, { kind: 'wait', duration: 1 })
    doc = addStep(doc, 0, { kind: 'wait', duration: 2 }, 0)
    expect(doc.scenes[0]!.steps.map((s) => (s.kind === 'wait' ? s.duration : 0))).toEqual([2, 1])
    doc = removeStep(doc, 0, 0)
    expect(doc.scenes[0]!.steps).toEqual([{ kind: 'wait', duration: 1 }])
  })

  it('builds the starter scene the engine can render', () => {
    const scene = starterDocument().scenes[0]!
    expect(scene.nodes.map((n) => n.catalogue)).toEqual(['Circle', 'VMobject.set_fill', 'Create'])
    expect(scene.edges).toEqual([
      { source: 'circle', target: 'fill', port: 'self', live: false },
      { source: 'fill', target: 'create', port: 'mobject', live: false }
    ])
    expect(scene.steps).toEqual([{ kind: 'play', animations: ['create'] }])
    expect(connectedPorts(scene, 'fill')).toEqual(new Set(['self']))
  })
})

const typeRef = { type: 'number' as const, annotation: 'float', optional: false, collection: false, accepts: [], signature: null, choices: null }
const circle: Descriptor = {
  name: 'Circle',
  qualname: 'Circle',
  module: 'manim',
  kind: 'class',
  category: 'geometry',
  owner: null,
  bases: [],
  parameters: [
    { name: 'radius', type: typeRef, kind: 'positional', default: '1.0', display: '1.0', owner: 'Circle' },
    { name: 'stroke_width', type: typeRef, kind: 'positional', default: '4', display: '4', owner: 'VMobject' },
    { name: 'z_index', type: typeRef, kind: 'positional', default: '0', display: '0', owner: 'Mobject' }
  ],
  accepts_kwargs: false,
  returns: { ...typeRef, type: 'mobject' },
  doc: 'A circle.',
  is_vmobject: true,
  hidden: false
}

describe('visiblePorts', () => {
  it('shows connected and valued ports while collapsed and all ports when expanded', () => {
    const node = { id: 'c', catalogue: 'Circle', values: { radius: 2 }, label: null, position: [0, 0] as [number, number], collapsed: true }
    expect(visiblePorts(node, circle, new Set(['z_index']))).toEqual(['radius', 'z_index'])
    expect(visiblePorts({ ...node, collapsed: false }, circle, new Set())).toEqual(['radius', 'stroke_width', 'z_index'])
  })

  it('always shows the self port of a method node', () => {
    const method: Descriptor = { ...circle, kind: 'method', qualname: 'VMobject.set_fill', name: 'set_fill', owner: 'VMobject', parameters: [] }
    const node = { id: 'f', catalogue: 'VMobject.set_fill', values: {}, label: null, position: [0, 0] as [number, number], collapsed: true }
    expect(visiblePorts(node, method, new Set())).toEqual(['self'])
  })
})

describe('parseDocument', () => {
  it('fills defaults for a minimal file', () => {
    const doc = parseDocument('{"version": 1, "scenes": [{"name": "S"}]}')
    expect(doc.settings.pixel_width).toBe(1920)
    expect(doc.scenes[0]).toEqual({ name: 'S', nodes: [], edges: [], steps: [] })
  })

  it('refuses files the engine could not use', () => {
    expect(() => parseDocument('not json')).toThrow()
    expect(() => parseDocument('{"version": 2, "scenes": [{"name": "S"}]}')).toThrow('unsupported version 2')
    expect(() => parseDocument('{"version": 1, "scenes": []}')).toThrow('no scenes')
    expect(() => parseDocument('{"version": 1, "scenes": [{"name": "S", "nodes": {}}]}')).toThrow('nodes must be a list')
  })

  it('places library nodes to the right of the last one', () => {
    expect(nextPosition({ name: 'S', nodes: [], edges: [], steps: [] })).toEqual([40, 60])
    expect(nextPosition(starterDocument().scenes[0]!)).toEqual([740, 60])
  })
})
