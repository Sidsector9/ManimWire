import type { Descriptor, Parameter } from '../../shared/engine'
import { SELF_PORT, connectedPorts, type DocNode, type JsonValue, type MethodCall, type Scene, type UpdatingAction } from '../model/document'
import { ANIMATE, chainMethods, effectiveDescriptor, isLiveSource, rootOf } from '../model/live'
import type { DescriptorIndex } from '../model/types'
import { TYPE_COLOR, selectExpressionNames, selectIndex, useCatalogueStore } from '../store/catalogue'
import { currentScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { PortEditor } from './PortEditor'
import { StepInspector } from './StepInspector'

const UPDATING_ACTIONS: Array<[UpdatingAction, string]> = [
  ['suspend', 'suspend updating'],
  ['resume', 'resume updating'],
  ['clear', 'clear updaters']
]

/** Every field of the selected node, grouped by the Manim class that declares it. */
export function Inspector() {
  const scene = useDocumentStore(currentScene)
  const selected = useDocumentStore((s) => s.selected)
  const selectedStep = useDocumentStore((s) => s.selectedStep)
  const store = useDocumentStore()
  const index = useCatalogueStore(selectIndex)
  const expressionNames = useCatalogueStore(selectExpressionNames)
  const code = useEngineResults((s) => s.code)
  const sourceMap = useEngineResults((s) => s.sourceMap)
  const issues = useEngineResults((s) => s.issues)

  const node = scene.nodes.find((n) => n.id === selected)
  const catalogued = node ? index.get(node.catalogue) : undefined
  if ((!node || !catalogued) && selectedStep !== null) return <StepInspector index={selectedStep} />
  if (!node || !catalogued) {
    return (
      <section className="panel inspector">
        <div className="panel-head">
          <span>Inspector</span>
        </div>
        <div className="inspector-empty">Select a node</div>
      </section>
    )
  }

  const descriptor = effectiveDescriptor(node, catalogued, scene, expressionNames)
  const connected = connectedPorts(scene, node.id)
  const groups = groupByOwner(descriptor)
  const lines = (sourceMap.nodes[node.id] ?? []).map((n) => code.split('\n')[n - 1] ?? '').map((l) => l.trim())
  const nodeIssues = issues.filter((i) => i.node === node.id)
  const inPlay = scene.steps.some((s) => s.kind === 'play' && s.animations.includes(node.id))
  const live = isLiveSource(scene, node.id, index)
  const hasUpdaters = sourceMap.live.some((id) => rootOf(scene, id, index) === node.id)

  return (
    <section className="panel inspector">
      <div className="panel-head">
        <span>Inspector</span>
        <span className="mono" style={{ fontWeight: 400, color: TYPE_COLOR[descriptor.returns.type] }}>
          {live && descriptor.returns.type !== 'live_number' ? 'live ' : ''}
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
        {descriptor.name === ANIMATE && (
          <ChainEditor node={node} scene={scene} index={index} onChange={(chain) => store.updateNode(node.id, { chain })} />
        )}
        {hasUpdaters && (
          <div>
            <div className="group-head">Updaters</div>
            <div className="inspector-doc">This object changes every frame. Add a step to pause, continue, or remove its updaters.</div>
            <div className="inspector-actions">
              {UPDATING_ACTIONS.map(([action, label]) => (
                <button key={action} className="button small" onClick={() => store.addStep({ kind: 'updating', mobjects: [node.id], action })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
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

/** The method calls of an Animate node, each with the parameters Manim declares for it. */
function ChainEditor({
  node,
  scene,
  index,
  onChange
}: {
  node: DocNode
  scene: Scene
  index: DescriptorIndex
  onChange(chain: MethodCall[]): void
}) {
  const source = scene.edges.find((e) => e.target === node.id && e.port === 'mobject')
  const methods = source ? chainMethods(scene, source.source, index) : []
  const chain = node.chain ?? []
  const replace = (at: number, call: MethodCall | null): void =>
    onChange(call === null ? chain.filter((_, i) => i !== at) : chain.map((c, i) => (i === at ? call : c)))

  return (
    <div>
      <div className="group-head">Method calls</div>
      {!source && <div className="inspector-doc">Connect the object to animate first.</div>}
      {chain.map((call, at) => {
        const method = methods.find((m) => m.name === call.method)
        return (
          <div key={at} className="chain-call">
            <div className="field">
              <span className="field-label mono">.{call.method}()</span>
              <span className="field-value">
                <button className="link" onClick={() => replace(at, null)}>
                  remove
                </button>
              </span>
            </div>
            {method
              ? method.parameters.map((param) => (
                  <Field
                    key={param.name}
                    param={param}
                    connected={false}
                    value={call.values[param.name]}
                    onChange={(v) => {
                      const values = { ...call.values }
                      if (v === undefined) delete values[param.name]
                      else values[param.name] = v
                      replace(at, { ...call, values })
                    }}
                  />
                ))
              : source && <div className="inspector-issue">{call.method} is not a method of this object</div>}
          </div>
        )
      })}
      {methods.length > 0 && (
        <select className="port-select mono" value="" onChange={(e) => e.target.value && onChange([...chain, { method: e.target.value, values: {} }])}>
          <option value="">+ add a method call</option>
          {methods.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </div>
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
