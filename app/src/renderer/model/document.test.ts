import { describe, expect, it } from 'vitest'
import type { Descriptor } from '../../shared/engine'
import {
  absolutePosition,
  addGroup,
  addNode,
  addStep,
  connect,
  connectedPorts,
  disconnect,
  emptyDocument,
  graphOf,
  importGroup,
  moveAnimation,
  moveStep,
  nextPosition,
  parseDocument,
  placeNode,
  removeGroup,
  removeNodes,
  removeStep,
  portValue,
  setValue,
  starterDocument,
  updateNode,
  visiblePorts
} from './document'
import { useDocumentStore } from '../store/document'

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
    expect(doc.scenes[0]).toEqual({ name: 'S', scene_type: 'Scene', nodes: [], edges: [], steps: [] })
  })

  it('refuses files the engine could not use', () => {
    expect(() => parseDocument('not json')).toThrow()
    expect(() => parseDocument('{"version": 2, "scenes": [{"name": "S"}]}')).toThrow('unsupported version 2')
    expect(() => parseDocument('{"version": 1, "scenes": []}')).toThrow('no scenes')
    expect(() => parseDocument('{"version": 1, "scenes": [{"name": "S", "nodes": {}}]}')).toThrow('nodes must be a list')
  })

  it('places library nodes to the right of the last one', () => {
    expect(nextPosition({ name: 'S', scene_type: 'Scene', nodes: [], edges: [], steps: [] })).toEqual([40, 60])
    expect(nextPosition(starterDocument().scenes[0]!)).toEqual([740, 60])
  })
})

describe('moveAnimation and moveStep', () => {
  const base = (): ReturnType<typeof emptyDocument> => {
    let doc = addNode(emptyDocument(), 0, 'Create', [0, 0], {}, 'a')
    doc = addNode(doc, 0, 'FadeIn', [0, 0], {}, 'b')
    doc = addStep(doc, 0, { kind: 'play', animations: ['a', 'b'] })
    doc = addStep(doc, 0, { kind: 'wait', duration: 1 })
    return addStep(doc, 0, { kind: 'play', animations: [] })
  }

  it('moves an animation into another play step and drops an emptied step', () => {
    const doc = moveAnimation(base(), 0, 'a', 0, 2)
    expect(doc.scenes[0]!.steps).toEqual([
      { kind: 'play', animations: ['b'] },
      { kind: 'wait', duration: 1 },
      { kind: 'play', animations: ['a'] }
    ])
    const alone = moveAnimation(doc, 0, 'b', 0, 2)
    expect(alone.scenes[0]!.steps).toEqual([{ kind: 'wait', duration: 1 }, { kind: 'play', animations: ['a', 'b'] }])
  })

  it('appends a new play step when the target is null', () => {
    const doc = moveAnimation(base(), 0, 'a', 0, null)
    expect(doc.scenes[0]!.steps.at(-1)).toEqual({ kind: 'play', animations: ['a'] })
  })

  it('leaves the document unchanged for a target that is not a play step', () => {
    const doc = base()
    expect(moveAnimation(doc, 0, 'a', 0, 1)).toBe(doc)
    expect(moveAnimation(doc, 0, 'a', 0, 9)).toBe(doc)
    expect(moveAnimation(doc, 0, 'a', 1, 0)).toBe(doc)
  })

  it('reorders steps', () => {
    const doc = moveStep(base(), 0, 2, 0)
    expect(doc.scenes[0]!.steps.map((s) => s.kind)).toEqual(['play', 'play', 'wait'])
  })
})

describe('containers and groups', () => {
  it('drops a node into the container under it and stores a relative position', () => {
    let doc = addNode(emptyDocument(), 0, 'Map', [100, 100], {}, 'm')
    doc = addNode(doc, 0, 'Dot', [0, 0], {}, 'd')
    doc = placeNode(doc, 0, 'd', [150, 150])
    const dot = doc.scenes[0]!.nodes.find((n) => n.id === 'd')!
    expect(dot.parent).toBe('m')
    expect(dot.position).toEqual([50, 50])
    expect(absolutePosition(doc.scenes[0]!, 'd')).toEqual([150, 150])
    doc = placeNode(doc, 0, 'd', [900, 900])
    expect(doc.scenes[0]!.nodes.find((n) => n.id === 'd')!.parent).toBeNull()
    doc = removeNodes(doc, 0, ['m'])
    expect(doc.scenes[0]!.nodes.map((n) => n.id)).toEqual(['d'])
  })

  it('edits a group through the same operations as a scene, and removes its instances with it', () => {
    let doc = addGroup(emptyDocument(), 'Blob')
    expect(doc.groups[0]!.nodes.map((n) => n.catalogue)).toEqual(['Output'])
    doc = addNode(doc, 'Blob', 'Circle', [0, 0], {}, 'c')
    doc = connect(doc, 'Blob', { source: 'c', target: doc.groups[0]!.nodes[0]!.id, port: 'value', live: false })
    expect(graphOf(doc, 'Blob')!.edges).toHaveLength(1)
    expect(addStep(doc, 'Blob', { kind: 'wait', duration: 1 })).toBe(doc)
    doc = addNode(doc, 0, 'group:Blob', [0, 0], {}, 'inst')
    doc = addGroup(doc, 'Other')
    doc = addNode(doc, 'Other', 'group:Blob', [0, 0], {}, 'inner')
    doc = removeGroup(doc, 'Blob')
    expect(doc.groups.map((g) => g.name)).toEqual(['Other'])
    expect(doc.scenes[0]!.nodes).toEqual([])
    expect(doc.groups[0]!.nodes.map((n) => n.catalogue)).toEqual(['Output'])
    expect(importGroup(importGroup(doc, { name: 'X', nodes: [], edges: [] }), { name: 'X', nodes: [], edges: [] }).groups.map((g) => g.name)).toEqual(['Other', 'X', 'X2'])
  })
})

describe('an Animate chain argument', () => {
  const animate = (): ReturnType<typeof addNode> =>
    updateNode(addNode(emptyDocument(), 0, 'Animate', [0, 0], {}, 'a'), 0, 'a', {
      chain: [{ method: 'set_fill', values: {} }]
    })

  it('is written onto its call, which is where the engine reads it', () => {
    const doc = setValue(animate(), 0, 'a', '1.set_fill.color', 'PINK')
    const node = doc.scenes[0]!.nodes[0]!
    expect(node.chain?.[0]?.values).toEqual({ color: 'PINK' })
    expect(node.values).toEqual({})
    expect(portValue(node, '1.set_fill.color')).toBe('PINK')
  })

  it('is cleared from its call, and shows on the collapsed node while it is set', () => {
    let doc = setValue(animate(), 0, 'a', '1.set_fill.opacity', 0.5)
    const descriptor = {
      name: 'Animate',
      kind: 'builtin',
      parameters: [{ name: '1.set_fill.opacity', owner: 'Animate' }]
    } as unknown as Descriptor
    expect(visiblePorts(doc.scenes[0]!.nodes[0]!, descriptor, new Set())).toContain('1.set_fill.opacity')
    doc = setValue(doc, 0, 'a', '1.set_fill.opacity', undefined)
    expect(doc.scenes[0]!.nodes[0]!.chain?.[0]?.values).toEqual({})
    expect(visiblePorts(doc.scenes[0]!.nodes[0]!, descriptor, new Set())).not.toContain('1.set_fill.opacity')
  })

  it('stays on the node itself when no such call exists', () => {
    const doc = setValue(animate(), 0, 'a', '1.rotate.angle', 1)
    expect(doc.scenes[0]!.nodes[0]!.values).toEqual({ '1.rotate.angle': 1 })
  })
})

describe('the revision counter', () => {
  const withCircle = (): void => {
    useDocumentStore.setState({ doc: addNode(emptyDocument(), 0, 'Circle', [0, 0], {}, 'c'), revision: 0, past: [], future: [] })
  }

  it('does not count a move, a collapse, a resize, or a pin', () => {
    withCircle()
    const store = useDocumentStore.getState()
    store.placeNode('c', [200, 40])
    store.updateNode('c', { collapsed: false })
    store.updateNode('c', { size: [300, 200] })
    store.updateNode('c', { pinned: ['radius'] })
    expect(useDocumentStore.getState().revision).toBe(0)
    // The edits still landed; they simply do not reach the engine.
    expect(useDocumentStore.getState().doc.scenes[0]!.nodes[0]!.position).toEqual([200, 40])
    expect(useDocumentStore.getState().doc.scenes[0]!.nodes[0]!.collapsed).toBe(false)
  })

  it('counts edits the engine sees, including undo', () => {
    withCircle()
    const store = useDocumentStore.getState()
    store.setValue('c', 'radius', 2)
    expect(useDocumentStore.getState().revision).toBe(1)
    store.updateNode('c', { label: 'ring' })
    expect(useDocumentStore.getState().revision).toBe(2)
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().revision).toBe(3)
  })
})
