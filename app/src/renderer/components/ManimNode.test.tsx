// @vitest-environment jsdom
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Descriptor } from '../../shared/engine'
import type { ManimFlowNode } from '../model/flow'
import { useCatalogueStore } from '../store/catalogue'
import { ManimNode } from './ManimNode'

const number = { type: 'number' as const, annotation: 'float', optional: false, collection: false, accepts: [], signature: null, choices: null }
const circle: Descriptor = {
  name: 'Circle',
  qualname: 'Circle',
  module: 'manim.mobject.geometry.arc',
  kind: 'class',
  category: 'geometry',
  owner: null,
  bases: ['Arc'],
  parameters: [
    { name: 'radius', type: number, kind: 'positional', default: '1.0', display: '1.0', owner: 'Circle' },
    { name: 'color', type: { ...number, type: 'color' }, kind: 'positional', default: 'RED', display: 'RED', owner: 'Circle' },
    { name: 'fill_opacity', type: number, kind: 'positional', default: '0.0', display: '0.0', owner: 'VMobject' },
    { name: 'stroke_width', type: number, kind: 'positional', default: '4', display: '4', owner: 'VMobject' }
  ],
  accepts_kwargs: false,
  returns: { ...number, type: 'mobject' },
  doc: 'A circle.',
  is_vmobject: true,
  hidden: false
}

function renderNode(collapsed: boolean, connected: string[] = []) {
  useCatalogueStore.setState({ catalogue: { manim_version: '0.21.0', entries: [circle], colors: [{ name: 'BLUE', hex: '#58C4DD' }], directions: ['ORIGIN', 'UP'], unknown_annotations: [], expression_names: [] } })
  const node: ManimFlowNode = {
    id: 'c',
    type: 'manim',
    position: { x: 0, y: 0 },
    data: {
      node: { id: 'c', catalogue: 'Circle', values: { radius: 2 }, label: null, position: [0, 0], collapsed },
      descriptor: circle,
      connected,
      issues: []
    }
  }
  const props: NodeProps<ManimFlowNode> = {
    id: 'c',
    type: 'manim',
    data: node.data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true
  }
  return render(
    <ReactFlowProvider>
      <ManimNode {...props} />
    </ReactFlowProvider>
  )
}

describe('ManimNode', () => {
  afterEach(cleanup)

  it('collapsed: shows valued and connected ports, hides the rest behind +N', () => {
    renderNode(true, ['stroke_width'])
    expect(screen.getByText('Circle')).toBeTruthy()
    expect(screen.getByText('radius')).toBeTruthy()
    expect(screen.getByText('stroke_width')).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
    expect(screen.queryByText('color')).toBeNull()
    expect(screen.queryByText('fill_opacity')).toBeNull()
    expect(screen.getByText('+2')).toBeTruthy()
    expect((screen.getByDisplayValue('2') as HTMLInputElement).type).toBe('number')
  })

  it('expanded: shows every port and a collapse control', () => {
    renderNode(false)
    for (const port of ['radius', 'color', 'fill_opacity', 'stroke_width']) {
      expect(screen.getByText(port)).toBeTruthy()
    }
    expect(screen.queryByText(/^\+\d/)).toBeNull()
    expect(screen.getByText('collapse')).toBeTruthy()
  })
})
