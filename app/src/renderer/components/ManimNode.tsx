import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SELF_PORT, isContainer, portValue, visiblePorts } from '../model/document'
import type { ManimFlowNode } from '../model/flow'
import { ANIMATE, chainSummary, isLiveSource, isObjectType } from '../model/live'
import { portType } from '../model/types'
import { TYPE_COLOR } from '../store/catalogue'
import { useDescriptorIndex } from '../store/descriptors'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { PortEditor } from './PortEditor'

/** One node for any catalogue descriptor. Collapsed by default; +N reveals the rest. */
export function ManimNode({ id, data, selected }: NodeProps<ManimFlowNode>) {
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | null>(null)
  useEffect(() => {
    if (!tooltip) return
    const dismiss = (): void => setTooltip(null)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('wheel', dismiss, { passive: true })
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('wheel', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', key)
    }
  }, [tooltip])
  const { node, descriptor, connected, live, issues } = data
  const index = useDescriptorIndex()
  const setValue = useDocumentStore((s) => s.setValue)
  const updateNode = useDocumentStore((s) => s.updateNode)
  const setPortLive = useDocumentStore((s) => s.setPortLive)
  const latex = useEngineStore((s) => s.status.info?.latex)
  const scene = useDocumentStore(currentScene)
  const hasLiveInput = live.length > 0 || scene.edges.some((e) => e.target === node.id && isLiveSource(scene, e.source, index))
  const connectedSet = new Set(connected)
  const visible = visiblePorts(node, descriptor, connectedSet)
  const hidden = (descriptor.parameters.length + (descriptor.kind === 'method' ? 1 : 0)) - visible.length
  const category = TYPE_COLOR[descriptor.returns.type]
  const title = node.label ?? descriptor.name
  const container = isContainer(node)
  const needsLatex = descriptor.requires_latex && latex === false

  return (
    <div className={`node${container ? ' container' : ''}${issues.length ? ' has-issue' : ''}`} style={{ borderLeftColor: category }}
      onPointerOver={(event) => {
        const target = event.target as HTMLElement
        const label = target.closest('.node-row')?.querySelector('.node-label') ?? target.closest('.node-title')
        if (!label) { setTooltip(null); return }
        const rect = label.getBoundingClientRect()
        setTooltip({ label: label.textContent ?? '', left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: Math.max(40, rect.top - 6) })
      }}
      onPointerLeave={() => setTooltip(null)}
      onPointerDown={() => setTooltip(null)}
    >
      {tooltip && createPortal(<div role="tooltip" className="inspector-field-tooltip" style={{ left: tooltip.left, top: tooltip.top, maxWidth: 'min(300px, calc(100vw - 16px))' }}>{tooltip.label}</div>, document.body)}
      {container && <NodeResizer isVisible={selected} minWidth={240} minHeight={140} onResizeEnd={(_, params) => updateNode(id, { size: [params.width, params.height] })} />}
      <div className="node-head">
        <span className={descriptor.kind === 'method' ? 'node-title mono' : 'node-title'}>{title}</span>
        {hasLiveInput && <span className="node-live" title="Has a live input: rebuilt every frame" />}
        {descriptor.kind === 'group' && <span className="node-tag">group</span>}
        {container && <span className="node-tag">{descriptor.name === 'Map' ? 'for each item' : 'repeat'}</span>}
        {needsLatex && (
          <span className="node-badge latex" title="This node renders through LaTeX, which is not installed">
            LaTeX
          </span>
        )}
        {issues.length > 0 && <span className="node-badge" title={issues.map((i) => i.message).join('\n')}>{issues.length}</span>}
        {descriptor.parameters.length > 0 && (hidden > 0 || !node.collapsed) && (
          <button
            className="node-fold"
            title={node.collapsed ? 'Show every port' : 'Show required and used ports'}
            aria-label={node.collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!node.collapsed}
            onClick={() => updateNode(node.id, { collapsed: !node.collapsed })}
          >
            {node.collapsed ? '+' : '\u2212'}
          </button>
        )}
        {descriptor.returns.type !== 'none' && (
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            className={`socket out${descriptor.kind === 'class' && descriptor.returns.type === 'mobject' && !descriptor.is_vmobject ? ' hollow' : ''}`}
            style={{ borderColor: category, background: category }}
          />
        )}
      </div>
      {descriptor.kind === 'method' && <div className="node-sub mono">{descriptor.qualname}</div>}
      {descriptor.name === ANIMATE && <div className="node-sub mono">{chainSummary(node) || 'no method calls'}</div>}
      {visible.map((port) => {
        const param = descriptor.parameters.find((p) => p.name === port)
        const type = portType(descriptor, port, index)
        const color = type ? TYPE_COLOR[type.type] : 'var(--border-strong)'
        const isConnected = connectedSet.has(port)
        return (
          <div className="node-row" key={port}>
            <Handle type="target" position={Position.Left} id={port} className="socket" style={{ borderColor: color, background: isConnected ? color : 'var(--panel)' }} />
            <span className="node-label">{port === SELF_PORT ? 'object' : port}</span>
            <span className="node-value">
              {isConnected && type && !isObjectType(type) && type.type !== 'any' ? (
                <button
                  className={`port-connected link${live.includes(port) ? ' live' : ''}`}
                  style={{ color }}
                  title={live.includes(port) ? 'Live: read every frame. Click to read once.' : 'Read once. Click to read every frame (an updater).'}
                  onClick={() => setPortLive(node.id, port, !live.includes(port))}
                >
                  {live.includes(port) ? 'live' : 'once'}
                </button>
              ) : isConnected ? (
                <span className="port-connected" style={{ color }}>
                  driven
                </span>
              ) : param ? (
                <PortEditor param={param} value={portValue(node, port)} onChange={(v) => setValue(node.id, port, v)} compact />
              ) : null}
            </span>
          </div>
        )
      })}
      {hidden > 0 && (
        <button className="node-more" onClick={() => updateNode(node.id, { collapsed: false })}>
          +{hidden}
        </button>
      )}
      {container && <div className="container-hint">Drop nodes here. Add a Result node for what each run produces.</div>}
    </div>
  )
}
