// Conversion between the document and xyflow's node and edge records.

import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'
import type { Descriptor, Issue } from '../../shared/engine'
import { TYPE_COLOR } from '../store/catalogue'
import { connectedPorts, type DocNode, type Scene } from './document'
import { effectiveDescriptor } from './live'
import type { DescriptorIndex } from './types'

export interface ManimNodeData extends Record<string, unknown> {
  node: DocNode
  /** The node's descriptor after per-node adjustments (Expression ports and output). */
  descriptor: Descriptor
  connected: string[]
  /** Ports whose connection is live. */
  live: string[]
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
  selected: string | null,
  expressionNames: string[]
): { nodes: ManimFlowNode[]; edges: FlowEdge[] } {
  const nodes: ManimFlowNode[] = []
  const descriptors = new Map<string, Descriptor>()
  for (const node of scene.nodes) {
    const descriptor = index.get(node.catalogue)
    if (!descriptor) continue
    const effective = effectiveDescriptor(node, descriptor, scene, expressionNames, index)
    descriptors.set(node.id, effective)
    nodes.push({
      id: node.id,
      type: 'manim',
      position: { x: node.position[0], y: node.position[1] },
      selected: node.id === selected,
      data: {
        node,
        descriptor: effective,
        connected: [...connectedPorts(scene, node.id)],
        live: scene.edges.filter((e) => e.target === node.id && e.live).map((e) => e.port),
        issues: issues.filter((i) => i.node === node.id)
      }
    })
  }
  const edges: FlowEdge[] = scene.edges.map((edge) => {
    const type = descriptors.get(edge.source)?.returns.type
    return {
      id: edgeId(edge.source, edge.target, edge.port),
      source: edge.source,
      sourceHandle: 'out',
      target: edge.target,
      targetHandle: edge.port,
      className: edge.live ? 'live' : undefined,
      style: { stroke: type ? TYPE_COLOR[type] : 'var(--border-strong)', strokeWidth: 2, strokeDasharray: edge.live ? '5 4' : undefined }
    }
  })
  return { nodes, edges }
}
