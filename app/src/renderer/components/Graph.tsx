import {
  applyNodeChanges,
  Background,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type FinalConnectionState,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { absolutePosition, starterDocument } from '../model/document'
import { toFlow, type ManimFlowNode } from '../model/flow'
import { effectiveDescriptor, isObjectType, liveByDefault, producedType } from '../model/live'
import { acceptsManyConnections, compatible, portType } from '../model/types'
import { selectExpressionNames, useCatalogueStore } from '../store/catalogue'
import { useDescriptorIndex } from '../store/descriptors'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { ManimNode } from './ManimNode'
import { QuickAdd } from './QuickAdd'

const nodeTypes = { manim: ManimNode, container: ManimNode }

interface QuickAddState {
  screen: { x: number; y: number }
  flow: { x: number; y: number }
  /** When set, only entries with a port accepting this type are offered, and the new node is connected. */
  from?: { node: string; type: TypeRef }
}

export function Graph() {
  const scene = useDocumentStore(currentScene)
  const selected = useDocumentStore((s) => s.selected)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const store = useDocumentStore()
  const index = useDescriptorIndex()
  const expressionNames = useCatalogueStore(selectExpressionNames)
  const allIssues = useEngineResults((s) => s.issues)
  // Issues carry the group they belong to; the graph shows the ones for what it displays.
  const issues = useMemo(() => allIssues.filter((i) => (editingGroup ? i.group === editingGroup : !i.group)), [allIssues, editingGroup])
  const derived = useMemo(() => toFlow(scene, index, issues, selected, expressionNames), [scene, index, issues, selected, expressionNames])
  const describe = useCallback(
    (id: string | null | undefined): Descriptor | undefined => {
      const node = scene.nodes.find((n) => n.id === id)
      const descriptor = node ? index.get(node.catalogue) : undefined
      return node && descriptor ? effectiveDescriptor(node, descriptor, scene, expressionNames, index) : undefined
    },
    [scene, index, expressionNames]
  )
  // xyflow needs position changes applied while a drag is in progress; the
  // document only records the final position on drop.
  const [nodes, setNodes] = useState(derived.nodes)
  useEffect(() => setNodes(derived.nodes), [derived.nodes])
  const { screenToFlowPosition } = useReactFlow()
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null)
  const mouse = useRef({ x: 200, y: 120 })

  const onNodesChange = useCallback(
    (changes: NodeChange<ManimFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current))
      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          // xyflow positions children relative to their container; the document decides the container.
          const parent = scene.nodes.find((n) => n.id === change.id)?.parent
          const [ox, oy] = parent ? absolutePosition(scene, parent) : [0, 0]
          store.placeNode(change.id, [change.position.x + ox, change.position.y + oy])
        } else if (change.type === 'remove') {
          store.removeNodes([change.id])
        } else if (change.type === 'select' && change.selected) {
          store.select(change.id)
        }
      }
    },
    [store, scene]
  )

  const isValidConnection = useCallback(
    (connection: FlowEdge | Connection): boolean => {
      if (!connection.source || !connection.target || !connection.targetHandle) return false
      if (connection.source === connection.target) return false
      const source = describe(connection.source)
      const target = describe(connection.target)
      if (!source || !target) return false
      const port = connection.targetHandle
      const accepted = portType(target, port, index)
      if (!accepted || !compatible(producedType(source), accepted)) return false
      const already = scene.edges.some((e) => e.target === connection.target && e.port === port && e.source !== connection.source)
      return !already || acceptsManyConnections(target, port) || accepted.collection === true
    },
    [index, scene, describe]
  )

  // A value that changes every frame connects live unless it feeds an object port
  // (a ValueTracker handed to Animate is the object being animated, not a live read).
  const onConnect = useCallback(
    (connection: Connection) => {
      const port = connection.targetHandle
      const target = describe(connection.target)
      if (!port || !target) return
      const live = liveByDefault(scene, connection.source, portType(target, port, index), index)
      store.connect({ source: connection.source, target: connection.target, port, live })
    },
    [store, scene, index, describe]
  )

  const toggleLive = useCallback(
    (edge: FlowEdge) => {
      const current = scene.edges.find((e) => e.source === edge.source && e.target === edge.target && e.port === edge.targetHandle)
      const target = describe(edge.target)
      const accepted = current && target ? portType(target, current.port, index) : null
      if (!current || !accepted || isObjectType(accepted)) return
      store.connect({ ...current, live: !current.live })
    },
    [scene, index, describe, store]
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source') return
      const descriptor = describe(state.fromNode.id)
      if (!descriptor) return
      const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: mouse.current.x, y: mouse.current.y }
      setQuickAdd({ screen: point, flow: screenToFlowPosition(point), from: { node: state.fromNode.id, type: producedType(descriptor) } })
    },
    [describe, screenToFlowPosition]
  )

  const choose = (descriptor: Descriptor): void => {
    if (!quickAdd) return
    const id = store.addCatalogueNode(descriptor, [quickAdd.flow.x, quickAdd.flow.y], index, quickAdd.from)
    // A node dropped over a Map or Repeat joins it.
    if (!quickAdd.from) store.placeNode(id, [quickAdd.flow.x, quickAdd.flow.y])
    setQuickAdd(null)
  }

  return (
    <div
      className="graph"
      onMouseMove={(e) => (mouse.current = { x: e.clientX, y: e.clientY })}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !quickAdd) {
          e.preventDefault()
          setQuickAdd({ screen: mouse.current, flow: screenToFlowPosition(mouse.current) })
        }
      }}
      tabIndex={0}
    >
      <div className="graph-head">
        <span>{editingGroup ? `GROUP ${editingGroup}` : 'GRAPH'}</span>
        <span className="meta">{scene.nodes.length} nodes · Tab to add</span>
      </div>
      <ReactFlow<ManimFlowNode>
        nodes={nodes}
        edges={derived.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesDelete={(deleted) => deleted.forEach((e) => e.targetHandle && store.disconnect({ source: e.source, target: e.target, port: e.targetHandle }))}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onEdgeDoubleClick={(_, edge) => toggleLive(edge)}
        isValidConnection={isValidConnection}
        onPaneClick={() => store.select(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView={false}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#1a1e24" />
      </ReactFlow>
      {scene.nodes.length === 0 && !editingGroup && (
        <div className="graph-empty">
          <div>Press Tab to add a node</div>
          <button className="button" onClick={() => useDocumentStore.getState().replace(starterDocument(), useDocumentStore.getState().filePath)}>
            Start with a circle
          </button>
        </div>
      )}
      {quickAdd && (
        <QuickAdd
          at={quickAdd.screen}
          acceptType={quickAdd.from?.type ?? null}
          onChoose={choose}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  )
}
