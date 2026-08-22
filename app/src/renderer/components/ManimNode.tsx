import { Handle, Position, type NodeProps } from '@xyflow/react'
import { SELF_PORT, visiblePorts } from '../model/document'
import type { ManimFlowNode } from '../model/flow'
import { ANIMATE, chainSummary } from '../model/live'
import { portType } from '../model/types'
import { TYPE_COLOR, selectIndex, useCatalogueStore } from '../store/catalogue'
import { useDocumentStore } from '../store/document'
import { PortEditor } from './PortEditor'

/** One node for any catalogue descriptor. Collapsed by default; +N reveals the rest. */
export function ManimNode({ data }: NodeProps<ManimFlowNode>) {
  const { node, descriptor, connected, issues } = data
  const index = useCatalogueStore(selectIndex)
  const setValue = useDocumentStore((s) => s.setValue)
  const updateNode = useDocumentStore((s) => s.updateNode)
  const connectedSet = new Set(connected)
  const visible = visiblePorts(node, descriptor, connectedSet)
  const hidden = (descriptor.parameters.length + (descriptor.kind === 'method' ? 1 : 0)) - visible.length
  const category = TYPE_COLOR[descriptor.returns.type]
  const title = node.label ?? (descriptor.kind === 'method' ? descriptor.name : descriptor.name)

  return (
    <div className={`node${issues.length ? ' has-issue' : ''}`} style={{ borderLeftColor: category }}>
      <div className="node-head">
        <span className={descriptor.kind === 'method' ? 'node-title mono' : 'node-title'}>{title}</span>
        {issues.length > 0 && <span className="node-badge" title={issues.map((i) => i.message).join('\n')}>{issues.length}</span>}
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
              {isConnected ? (
                <span className="port-connected" style={{ color }}>
                  connected
                </span>
              ) : param ? (
                <PortEditor param={param} value={node.values[port]} onChange={(v) => setValue(node.id, port, v)} compact />
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
      {!node.collapsed && descriptor.parameters.length > 0 && (
        <button className="node-more" onClick={() => updateNode(node.id, { collapsed: true })}>
          collapse
        </button>
      )}
    </div>
  )
}
