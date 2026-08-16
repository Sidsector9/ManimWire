import type { Descriptor, Parameter } from '../../shared/engine'
import { SELF_PORT, connectedPorts, type JsonValue } from '../model/document'
import { TYPE_COLOR, selectIndex, useCatalogueStore } from '../store/catalogue'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { PortEditor } from './PortEditor'

/** Every field of the selected node, grouped by the Manim class that declares it. */
export function Inspector() {
  const scene = useDocumentStore(currentScene)
  const selected = useDocumentStore((s) => s.selected)
  const store = useDocumentStore()
  const index = useCatalogueStore(selectIndex)
  const code = useEngineResults((s) => s.code)
  const sourceMap = useEngineResults((s) => s.sourceMap)
  const issues = useEngineResults((s) => s.issues)

  const node = scene.nodes.find((n) => n.id === selected)
  const descriptor = node ? index.get(node.catalogue) : undefined
  if (!node || !descriptor) {
    return (
      <section className="panel inspector">
        <div className="panel-head">
          <span>Inspector</span>
        </div>
        <div className="inspector-empty">Select a node</div>
      </section>
    )
  }

  const connected = connectedPorts(scene, node.id)
  const groups = groupByOwner(descriptor)
  const lines = (sourceMap.nodes[node.id] ?? []).map((n) => code.split('\n')[n - 1] ?? '').map((l) => l.trim())
  const nodeIssues = issues.filter((i) => i.node === node.id)
  const inPlay = scene.steps.some((s) => s.kind === 'play' && s.animations.includes(node.id))

  return (
    <section className="panel inspector">
      <div className="panel-head">
        <span>Inspector</span>
        <span className="mono" style={{ fontWeight: 400, color: TYPE_COLOR[descriptor.returns.type] }}>
          {descriptor.returns.type.replace('_', ' ')}
        </span>
      </div>
      <div className="inspector-body">
        <div className="inspector-title">
          <input
            className="port-input"
            value={node.label ?? ''}
            placeholder={descriptor.name}
            onChange={(e) => store.updateNode(node.id, { label: e.target.value || null })}
          />
          <span className="mono muted">{descriptor.qualname}</span>
        </div>
        {descriptor.doc && <div className="inspector-doc">{descriptor.doc}</div>}
        {nodeIssues.map((issue, i) => (
          <div key={i} className="inspector-issue">
            {issue.message}
          </div>
        ))}
        {descriptor.returns.type === 'animation' && !inPlay && (
          <button className="button" onClick={() => store.addStep({ kind: 'play', animations: [node.id] })}>
            Play this animation
          </button>
        )}
        {descriptor.kind === 'method' && (
          <div className="field">
            <span className="field-label">object</span>
            <span className="field-value muted">{connected.has(SELF_PORT) ? 'connected' : 'connect a mobject'}</span>
          </div>
        )}
        {groups.map(([owner, params]) => (
          <div key={owner}>
            <div className="group-head">{owner}</div>
            {params.map((param) => (
              <Field
                key={param.name}
                param={param}
                connected={connected.has(param.name)}
                value={node.values[param.name]}
                onChange={(v) => store.setValue(node.id, param.name, v)}
              />
            ))}
          </div>
        ))}
        {lines.length > 0 && (
          <div>
            <div className="group-head">Manim</div>
            <pre className="mono inspector-code">{lines.join('\n')}</pre>
          </div>
        )}
        <button className="button danger" onClick={() => store.removeNodes([node.id])}>
          Delete node
        </button>
      </div>
    </section>
  )
}

function Field({
  param,
  connected,
  value,
  onChange
}: {
  param: Parameter
  connected: boolean
  value: JsonValue | undefined
  onChange(value: JsonValue | undefined): void
}) {
  const isSet = value !== undefined
  return (
    <div className={`field${isSet ? ' set' : ''}`}>
      <span className="field-label" title={param.type.annotation}>
        <span className="dot" style={{ background: TYPE_COLOR[param.type.type] }} />
        {param.name}
      </span>
      <span className="field-value">
        {connected ? <span className="muted">connected</span> : <PortEditor param={param} value={value} onChange={onChange} />}
      </span>
      <span className="field-default mono">
        {isSet && !connected ? (
          <button className="link" title="Reset to the Manim default" onClick={() => onChange(undefined)}>
            reset
          </button>
        ) : (
          (param.display ?? 'required')
        )}
      </span>
    </div>
  )
}

function groupByOwner(descriptor: Descriptor): [string, Parameter[]][] {
  const groups = new Map<string, Parameter[]>()
  for (const param of descriptor.parameters) {
    const list = groups.get(param.owner) ?? []
    list.push(param)
    groups.set(param.owner, list)
  }
  return [...groups.entries()]
}
