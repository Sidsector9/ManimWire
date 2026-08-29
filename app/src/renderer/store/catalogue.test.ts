import { describe, expect, it } from 'vitest'
import type { Descriptor } from '../../shared/engine'
import { groupLabel, groupLibrary } from './catalogue'

function entry(overrides: Partial<Descriptor>): Descriptor {
  return {
    name: 'X',
    qualname: 'X',
    module: 'manim.x',
    kind: 'class',
    category: 'geometry',
    owner: null,
    bases: [],
    parameters: [],
    accepts_kwargs: false,
    returns: { type: 'mobject', annotation: 'X', optional: false, collection: false, accepts: [], signature: null, choices: null },
    doc: '',
    is_vmobject: true,
    hidden: false,
    ...overrides
  }
}

const entries = [
  entry({ name: 'Square', qualname: 'Square' }),
  entry({ name: 'Circle', qualname: 'Circle' }),
  entry({ name: 'Create', qualname: 'Create', category: 'animation.creation' }),
  entry({ name: 'FadeIn', qualname: 'FadeIn', category: 'animation.fading' }),
  entry({ name: 'set_fill', qualname: 'VMobject.set_fill', kind: 'method', owner: 'VMobject' }),
  entry({ name: 'get_start', qualname: 'Mobject.get_start', kind: 'method', owner: 'Mobject' }),
  entry({ name: 'TipableVMobject', qualname: 'TipableVMobject', hidden: true }),
  entry({ name: 'smooth', qualname: 'smooth', kind: 'function', category: 'rate_functions' })
]

describe('groupLibrary', () => {
  it('groups classes, functions, and concept methods; drops other methods and hidden entries', () => {
    const groups = groupLibrary(entries)
    expect(groups.map((g) => g.label)).toEqual(['Shapes', 'Style', 'Animations', 'Rate functions'])
    expect(groups[1]!.entries.map((e) => e.name)).toEqual(['set_fill'])
    expect(groups[0]!.entries.map((e) => e.name)).toEqual(['Circle', 'Square'])
    expect(groups[2]!.entries.map((e) => e.name)).toEqual(['Create', 'FadeIn'])
  })

  it('filters by a case insensitive substring', () => {
    const groups = groupLibrary(entries, 'CIRC')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.entries[0]!.name).toBe('Circle')
  })

  it('maps categories to labels and keeps unknown ones as is', () => {
    expect(groupLabel('graphing')).toBe('Coordinate systems')
    expect(groupLabel('animation.transform')).toBe('Animations')
    expect(groupLabel('utils.bezier')).toBe('Utilities')
    expect(groupLabel('something_new')).toBe('something_new')
  })
})
