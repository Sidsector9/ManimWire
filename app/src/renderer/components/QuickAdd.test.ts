import { describe, expect, it } from 'vitest'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { indexDescriptors } from '../model/types'
import { quickAddResults } from './QuickAdd'

const ref = (type: TypeRef['type']): TypeRef => ({ type, annotation: type, optional: false, collection: false, accepts: [], signature: null, choices: null })
const base = { module: 'manim', category: 'geometry', bases: [], accepts_kwargs: false, doc: '', is_vmobject: true, hidden: false }
const entries: Descriptor[] = [
  { ...base, name: 'Circle', qualname: 'Circle', kind: 'class', owner: null, parameters: [], returns: ref('mobject') },
  { ...base, name: 'Circumscribe', qualname: 'Circumscribe', kind: 'class', owner: null, category: 'animation.indication', parameters: [{ name: 'mobject', type: ref('mobject'), kind: 'positional', default: null, display: null, owner: 'Circumscribe' }], returns: ref('animation') },
  { ...base, name: 'ComplexPlane', qualname: 'ComplexPlane', kind: 'class', owner: null, category: 'graphing', parameters: [], returns: ref('coordinate_system') },
  { ...base, name: 'set_fill', qualname: 'VMobject.set_fill', kind: 'method', owner: 'VMobject', parameters: [], returns: ref('mobject') },
  { ...base, name: 'TipableVMobject', qualname: 'TipableVMobject', kind: 'class', owner: null, parameters: [], returns: ref('mobject'), hidden: true },
  { ...base, name: 'VMobject', qualname: 'VMobject', kind: 'class', owner: null, parameters: [], returns: ref('mobject') }
]

const index = indexDescriptors(entries)

describe('quickAddResults', () => {
  it('filters by text, prefers prefix matches, hides methods and hidden classes', () => {
    expect(quickAddResults(entries, 'circ', null, index).map((e) => e.name)).toEqual(['Circle', 'Circumscribe'])
    expect(quickAddResults(entries, '', null, index).map((e) => e.name)).toEqual(['Circle', 'Circumscribe', 'ComplexPlane', 'VMobject'])
  })

  it('offers only nodes with a port accepting the dragged type, including methods', () => {
    const names = quickAddResults(entries, '', ref('mobject'), index).map((e) => e.qualname)
    expect(names).toEqual(['Circumscribe', 'VMobject.set_fill'])
  })
})
