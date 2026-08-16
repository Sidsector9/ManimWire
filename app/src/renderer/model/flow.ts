// Conversion between the document and xyflow's node and edge records.

import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'
import type { Descriptor, Issue } from '../../shared/engine'
import { TYPE_COLOR } from '../store/catalogue'
import { connectedPorts, type DocNode, type Scene } from './document'
import type { DescriptorIndex } from './types'

export interface ManimNodeData extends Record<string, unknown> {
  node: DocNode
  descriptor: Descriptor
  connected: string[]
  issues: Issue[]
}

export type ManimFlowNode = FlowNode<ManimNodeData, 'manim'>

export function edgeId(source: string, target: string, port: string): string {
  return `${source}->${target}.${port}`
}

export function toFlow(
  scene: Scene,
  index: DescriptorIndex,
  issues: Issue[],
  selected: string | null
): { nodes: ManimFlowNode[]; edges: FlowEdge[] } {
  const nodes: ManimFlowNode[] = []
  for (const node of scene.nodes) {
    const descriptor = index.get(node.catalogue)
    if (!descriptor) continue
    nodes.push({
      id: node.id,
      type: 'manim',
      position: { x: node.position[0], y: node.position[1] },
      selected: node.id === selected,
      data: {
        node,
        descriptor,
        connected: [...connectedPorts(scene, node.id)],
        issues: issues.filter((i) => i.node === node.id)
      }
    })
  }
  const edges: FlowEdge[] = scene.edges.map((edge) => {
    const source = scene.nodes.find((n) => n.id === edge.source)
    const type = source ? index.get(source.catalogue)?.returns.type : undefined
    return {
      id: edgeId(edge.source, edge.target, edge.port),
      source: edge.source,
      sourceHandle: 'out',
      target: edge.target,
      targetHandle: edge.port,
      style: { stroke: type ? TYPE_COLOR[type] : 'var(--border-strong)', strokeWidth: 2, strokeDasharray: edge.live ? '5 4' : undefined }
    }
  })
  return { nodes, edges }
}
