import { describe, expect, it } from 'vitest'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { starterDocument } from './document'
import { toFlow } from './flow'
import { indexDescriptors } from './types'

const ref = (type: TypeRef['type']): TypeRef => ({ type, annotation: type, optional: false, collection: false, accepts: [], signature: null, choices: null })
const base = { module: 'manim', category: 'x', bases: [], accepts_kwargs: false, doc: '', is_vmobject: true, hidden: false, parameters: [] }
const index = indexDescriptors([
  { ...base, name: 'Circle', qualname: 'Circle', kind: 'class', owner: null, returns: ref('mobject') },
  { ...base, name: 'set_fill', qualname: 'VMobject.set_fill', kind: 'method', owner: 'VMobject', returns: ref('mobject') },
  { ...base, name: 'Create', qualname: 'Create', kind: 'class', owner: null, returns: ref('animation') }
] as Descriptor[])

describe('toFlow', () => {
  it('maps document nodes and edges to xyflow records with typed edge colours', () => {
    const scene = starterDocument().scenes[0]!
    const issues = [{ code: 'x', message: 'bad', node: 'fill', port: null, step: null }]
    const { nodes, edges } = toFlow(scene, index, issues, [])
    expect(nodes.map((n) => n.id)).toEqual(['circle', 'fill', 'create'])
    expect(nodes[1]!.data.connected).toEqual(['self'])
    expect(nodes[1]!.data.issues).toHaveLength(1)
    expect(edges.map((e) => e.id)).toEqual(['circle->fill.self', 'fill->create.mobject'])
    expect(edges[0]!.targetHandle).toBe('self')
    expect(edges[0]!.style?.stroke).toBe('var(--type-mobject)')
  })
})
