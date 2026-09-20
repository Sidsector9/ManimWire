import { describe, expect, it } from 'vitest'
import { copySelection, parseSelection, pasteSelection } from './clipboard'
import { addNode, addGroup, connect, emptyDocument, graphOf, starterDocument, updateNode } from './document'

describe('graph clipboard', () => {
  it('copies an isolated snapshot and only wires between included nodes', () => {
    const original = starterDocument()
    const scene = original.scenes[0]!
    scene.edges[0]!.live = true
    scene.nodes[1]!.pinned = ['opacity']
    const copied = copySelection(scene, ['circle', 'fill'])!
    expect(copied.nodes.map((node) => node.position)).toEqual([[0, 0], [240, 0]])
    expect(copied.edges).toEqual([scene.edges[0]])
    expect(copySelection(scene, ['circle'])!.edges).toEqual([])
    scene.nodes[0]!.values.radius = 99
    expect(copied.nodes[0]!.values.radius).toBe(2)
    const pasted = pasteSelection(original, 0, copied, [800, 300])
    const result = pasted.doc.scenes[0]!
    expect(pasted.ids).toHaveLength(2)
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(5)
    expect(result.nodes.slice(-2).map((node) => node.position)).toEqual([[800, 300], [1040, 300]])
    expect(result.nodes.at(-1)!.pinned).toEqual(['opacity'])
    expect(result.edges.at(-1)).toEqual({ source: pasted.ids[0], target: pasted.ids[1], port: 'self', live: true })
    expect(result.steps).toEqual(scene.steps)
    result.nodes.at(-1)!.pinned!.push('color')
    expect(copied.nodes[1]!.pinned).toEqual(['opacity'])
    const again = pasteSelection(pasted.doc, 0, copied, [824, 324])
    expect(again.ids.some((id) => pasted.ids.includes(id))).toBe(false)
  })

  it('preserves Animate chains, Config keys, labels, and editor settings', () => {
    let doc = addNode(emptyDocument(), 0, 'Animate', [0, 0], {}, 'a')
    doc = updateNode(doc, 0, 'a', { chain: [{ method: 'shift', values: { direction: [1, 2, 3] } }], collapsed: false, label: 'Move' })
    doc = addNode(doc, 0, 'Config', [100, 0], { color: 'BLUE' }, 'cfg')
    doc = updateNode(doc, 0, 'cfg', { config: [{ name: 'color', type: 'color' }] })
    const copied = parseSelection(JSON.stringify(copySelection(doc.scenes[0]!, ['a', 'cfg'])))!
    const pasted = pasteSelection(doc, 0, copied, [400, 200]).doc.scenes[0]!.nodes.slice(-2)
    expect(pasted[0]).toMatchObject({ chain: [{ method: 'shift', values: { direction: [1, 2, 3] } }], collapsed: false, label: 'Move' })
    expect(pasted[1]).toMatchObject({ config: [{ name: 'color', type: 'color' }], values: { color: 'BLUE' } })
  })

  it('copies nested container contents and remaps parents without duplicating selected children', () => {
    let doc = addNode(emptyDocument(), 0, 'Map', [100, 200], {}, 'map')
    doc = addNode(doc, 0, 'Repeat', [30, 40], { count: 2 }, 'repeat', 'map')
    doc = addNode(doc, 0, 'Circle', [20, 60], {}, 'circle', 'repeat')
    doc = addNode(doc, 0, 'Result', [200, 60], {}, 'result', 'repeat')
    doc = connect(doc, 0, { source: 'circle', target: 'result', port: 'value', live: false })
    doc = updateNode(doc, 0, 'map', { size: [800, 500] })
    const copied = copySelection(doc.scenes[0]!, ['map', 'circle'])!
    expect(copied.nodes).toHaveLength(4)
    expect(parseSelection(JSON.stringify(copied))).toEqual(copied)
    const { doc: next, ids } = pasteSelection(doc, 0, copied, [150, 220])
    const nodes = next.scenes[0]!.nodes.slice(-4)
    expect(nodes[0]).toMatchObject({ parent: null, position: [150, 220], size: [800, 500] })
    expect(nodes[1]).toMatchObject({ parent: ids[0], position: [30, 40] })
    expect(nodes[2]).toMatchObject({ parent: ids[1], position: [20, 60] })
    expect(nodes[3]).toMatchObject({ parent: ids[1], position: [200, 60] })
    expect(next.scenes[0]!.edges.at(-1)).toMatchObject({ source: ids[2], target: ids[3] })
  })

  it('detaches copied children from absent parents and places them in the destination container', () => {
    let doc = addNode(emptyDocument(), 0, 'Map', [100, 100], {}, 'map')
    doc = addNode(doc, 0, 'Number', [30, 40], { value: 2 }, 'n', 'map')
    const copied = copySelection(doc.scenes[0]!, ['n'])!
    expect(copied.nodes[0]).toMatchObject({ parent: null, position: [0, 0] })
    const outside = pasteSelection(doc, 0, copied, [900, 900]).doc.scenes[0]!.nodes.at(-1)!
    expect(outside).toMatchObject({ parent: null, position: [900, 900] })
    const inside = pasteSelection(doc, 0, copied, [150, 160]).doc.scenes[0]!.nodes.at(-1)!
    expect(inside).toMatchObject({ parent: 'map', position: [50, 60] })
  })

  it('pastes into other scenes and reusable group definitions', () => {
    const copied = copySelection(starterDocument().scenes[0]!, ['circle', 'fill'])!
    let doc = addGroup(emptyDocument(), 'MyGroup')
    doc = { ...doc, scenes: [...doc.scenes, { ...emptyDocument().scenes[0]!, name: 'Scene2' }] }
    doc = pasteSelection(doc, 1, copied, [10, 20]).doc
    expect(doc.scenes[0]!.nodes).toHaveLength(0)
    expect(doc.scenes[1]!.nodes).toHaveLength(2)
    doc = pasteSelection(doc, 'MyGroup', copied, [40, 60]).doc
    expect(graphOf(doc, 'MyGroup')!.nodes).toHaveLength(3)
    expect(graphOf(doc, 'MyGroup')!.edges).toHaveLength(1)
  })

  it('ignores empty selections, unrelated text, and malformed graph payloads', () => {
    expect(copySelection(starterDocument().scenes[0]!, [])).toBeNull()
    expect(copySelection(starterDocument().scenes[0]!, ['missing'])).toBeNull()
    const selection = copySelection(starterDocument().scenes[0]!, ['circle'])!
    const node = selection.nodes[0]!
    for (const value of [
      null, {}, { ...selection, version: 2 }, { ...selection, nodes: [node, node] },
      { ...selection, nodes: [{ ...node, position: ['x', 0] }] },
      { ...selection, nodes: [{ ...node, values: { bad: {} } }] },
      { ...selection, nodes: [{ ...node, chain: [null] }] },
      { ...selection, nodes: [{ ...node, catalogue: 'Map', parent: node.id }] },
      { ...selection, nodes: [{ ...node, parent: 'missing' }] },
      { ...selection, edges: [{ source: node.id, target: 'missing', port: 'self', live: false }] }
    ]) expect(parseSelection(JSON.stringify(value))).toBeNull()
    expect(parseSelection('hello')).toBeNull()
    expect(parseSelection('{')).toBeNull()
  })
})
