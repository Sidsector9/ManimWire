import { beforeEach, describe, expect, it } from 'vitest'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { emptyDocument, starterDocument } from '../model/document'
import { indexDescriptors } from '../model/types'
import { currentScene, useDocumentStore } from './document'

describe('document store', () => {
  beforeEach(() => useDocumentStore.getState().replace(emptyDocument(), null))

  it('records history for edits and supports undo and redo', () => {
    const store = useDocumentStore.getState()
    const id = store.addNode('Circle', [0, 0], { radius: 2 })
    useDocumentStore.getState().setValue(id, 'radius', 3)
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.values.radius).toBe(3)
    expect(useDocumentStore.getState().dirty).toBe(true)

    useDocumentStore.getState().undo()
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.values.radius).toBe(2)
    useDocumentStore.getState().undo()
    expect(currentScene(useDocumentStore.getState()).nodes).toEqual([])
    useDocumentStore.getState().redo()
    expect(currentScene(useDocumentStore.getState()).nodes).toHaveLength(1)
    useDocumentStore.getState().redo()
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.values.radius).toBe(3)
    useDocumentStore.getState().redo() // nothing left, no change
    expect(useDocumentStore.getState().future).toEqual([])
  })

  it('moving a node does not create a history entry', () => {
    const id = useDocumentStore.getState().addNode('Circle', [0, 0])
    const before = useDocumentStore.getState().past.length
    useDocumentStore.getState().moveNode(id, [100, 50])
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.position).toEqual([100, 50])
    expect(useDocumentStore.getState().past).toHaveLength(before)
  })

  it('selects an added node and clears the selection when it is removed', () => {
    const id = useDocumentStore.getState().addNode('Circle', [0, 0])
    expect(useDocumentStore.getState().selected).toBe(id)
    useDocumentStore.getState().removeNodes([id])
    expect(useDocumentStore.getState().selected).toBeNull()
  })

  it('replace resets history and dirty state; markSaved keeps the path', () => {
    useDocumentStore.getState().replace(starterDocument(), '/tmp/a.mnw')
    expect(useDocumentStore.getState().dirty).toBe(false)
    useDocumentStore.getState().addStep({ kind: 'wait', duration: 1 })
    expect(useDocumentStore.getState().dirty).toBe(true)
    useDocumentStore.getState().markSaved('/tmp/b.mnw')
    expect(useDocumentStore.getState().dirty).toBe(false)
    expect(useDocumentStore.getState().filePath).toBe('/tmp/b.mnw')
  })
})

const ref = (type: TypeRef['type']): TypeRef => ({ type, annotation: type, optional: false, collection: false, accepts: [], signature: null, choices: null })
const create: Descriptor = {
  name: 'Create', qualname: 'Create', module: 'manim', kind: 'class', category: 'animation.creation', owner: null, bases: [],
  parameters: [{ name: 'mobject', type: ref('mobject'), kind: 'positional', default: null, display: null, owner: 'Create' }],
  accepts_kwargs: false, returns: ref('animation'), doc: '', is_vmobject: false, hidden: false
}

describe('document store, compound and repeated edits', () => {
  beforeEach(() => useDocumentStore.getState().replace(emptyDocument(), null))

  it('adds, connects, and plays an animation as one history entry', () => {
    const circle = useDocumentStore.getState().addNode('Circle', [0, 0])
    const before = useDocumentStore.getState().past.length
    const id = useDocumentStore.getState().addCatalogueNode(create, [200, 0], indexDescriptors([create]), { node: circle, type: ref('mobject') })
    const scene = currentScene(useDocumentStore.getState())
    expect(scene.edges).toEqual([{ source: circle, target: id, port: 'mobject', live: false }])
    expect(scene.steps).toEqual([{ kind: 'play', animations: [id] }])
    expect(useDocumentStore.getState().past).toHaveLength(before + 1)
    useDocumentStore.getState().undo()
    expect(currentScene(useDocumentStore.getState()).nodes).toHaveLength(1)
  })

  it('merges consecutive edits of the same field into one undo step', () => {
    const id = useDocumentStore.getState().addNode('Circle', [0, 0])
    const before = useDocumentStore.getState().past.length
    useDocumentStore.getState().setValue(id, 'radius', 1)
    useDocumentStore.getState().setValue(id, 'radius', 12)
    useDocumentStore.getState().setValue(id, 'radius', 123)
    expect(useDocumentStore.getState().past).toHaveLength(before + 1)
    useDocumentStore.getState().setValue(id, 'color', 'BLUE') // a different field starts a new entry
    expect(useDocumentStore.getState().past).toHaveLength(before + 2)
    useDocumentStore.getState().undo()
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.values).toEqual({ radius: 123 })
    useDocumentStore.getState().undo()
    expect(currentScene(useDocumentStore.getState()).nodes[0]!.values).toEqual({})
  })

  it('updates a step in place', () => {
    useDocumentStore.getState().addStep({ kind: 'wait', duration: 1 })
    useDocumentStore.getState().addStep({ kind: 'wait', duration: 2 })
    useDocumentStore.getState().updateStep(0, { kind: 'wait', duration: 5 })
    expect(currentScene(useDocumentStore.getState()).steps).toEqual([
      { kind: 'wait', duration: 5 },
      { kind: 'wait', duration: 2 }
    ])
  })
})

describe('step selection follows step edits', () => {
  beforeEach(() => useDocumentStore.getState().replace(emptyDocument(), null))

  it('shifts the selected step when an earlier one is removed and clears it when it is removed', () => {
    const store = useDocumentStore.getState()
    store.addStep({ kind: 'wait', duration: 1 })
    store.addStep({ kind: 'wait', duration: 2 })
    store.addStep({ kind: 'wait', duration: 3 })
    store.selectStep(2)
    useDocumentStore.getState().removeStep(0)
    expect(useDocumentStore.getState().selectedStep).toBe(1)
    useDocumentStore.getState().removeStep(1)
    expect(useDocumentStore.getState().selectedStep).toBeNull()
  })

  it('moveStep keeps the moved step selected', () => {
    const store = useDocumentStore.getState()
    store.addStep({ kind: 'wait', duration: 1 })
    store.addStep({ kind: 'wait', duration: 2 })
    useDocumentStore.getState().moveStep(1, 0)
    expect(useDocumentStore.getState().selectedStep).toBe(0)
    expect(currentScene(useDocumentStore.getState()).steps[0]).toEqual({ kind: 'wait', duration: 2 })
  })
})
