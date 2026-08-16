import { describe, expect, it } from 'vitest'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { acceptingPorts, compatible, indexDescriptors, portType } from './types'

const ref = (type: TypeRef['type'], accepts: TypeRef['type'][] = []): TypeRef => ({
  type,
  annotation: type,
  optional: false,
  collection: false,
  accepts,
  signature: null,
  choices: null
})

const base = {
  module: 'manim',
  category: 'x',
  bases: [],
  accepts_kwargs: false,
  doc: '',
  is_vmobject: false,
  hidden: false
}
const vmobject: Descriptor = { ...base, name: 'VMobject', qualname: 'VMobject', kind: 'class', owner: null, parameters: [], returns: ref('mobject') }
const setFill: Descriptor = {
  ...base,
  name: 'set_fill',
  qualname: 'VMobject.set_fill',
  kind: 'method',
  owner: 'VMobject',
  parameters: [{ name: 'color', type: ref('color'), kind: 'positional', default: 'None', display: 'None', owner: 'VMobject' }],
  returns: ref('mobject')
}
const create: Descriptor = {
  ...base,
  name: 'Create',
  qualname: 'Create',
  kind: 'class',
  owner: null,
  parameters: [
    { name: 'mobject', type: ref('mobject'), kind: 'positional', default: null, display: null, owner: 'Create' },
    { name: 'run_time', type: ref('number'), kind: 'positional', default: '1.0', display: '1.0', owner: 'Animation' }
  ],
  returns: ref('animation')
}
const index = indexDescriptors([vmobject, setFill, create])

describe('compatible', () => {
  it('matches equal types, alternatives, subtypes, and any', () => {
    expect(compatible(ref('number'), ref('number'))).toBe(true)
    expect(compatible(ref('number'), ref('text'))).toBe(false)
    expect(compatible(ref('vector'), ref('mobject', ['vector']))).toBe(true)
    expect(compatible(ref('coordinate_system'), ref('mobject'))).toBe(true)
    expect(compatible(ref('mobject'), ref('coordinate_system'))).toBe(false)
    expect(compatible(ref('any'), ref('color'))).toBe(true)
  })
})

describe('portType and acceptingPorts', () => {
  it('resolves the self port through the owner class', () => {
    expect(portType(setFill, 'self', index)?.type).toBe('mobject')
    expect(portType(create, 'self', index)).toBeNull()
    expect(portType(create, 'nope', index)).toBeNull()
  })

  it('lists the ports a mobject can be dropped on', () => {
    expect(acceptingPorts(ref('mobject'), setFill, index)).toEqual(['self'])
    expect(acceptingPorts(ref('mobject'), create, index)).toEqual(['mobject'])
    expect(acceptingPorts(ref('number'), create, index)).toEqual(['run_time'])
  })
})
