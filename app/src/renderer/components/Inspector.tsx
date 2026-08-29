import type { Parameter } from '../../shared/engine'
import { GROUP_PREFIX, SELF_PORT, connectedPorts, type ConfigKey, type DocNode, type JsonValue, type MethodCall, type Scene, type UpdatingAction } from '../model/document'
import { conceptGroups } from '../model/groups'
import { ANIMATE, chainMethods, chainPort, effectiveDescriptor, isLiveSource, rootOf } from '../model/live'
import type { DescriptorIndex } from '../model/types'
import { TYPE_COLOR, selectExpressionNames, useCatalogueStore } from '../store/catalogue'
import { useDescriptorIndex } from '../store/descriptors'
import { currentScene, previewScene, useDocumentStore } from '../store/document'
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
  const index = useDescriptorIndex()
  const sceneType = useDocumentStore((s) => previewScene(s).scene_type)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
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

  const descriptor = effectiveDescriptor(node, catalogued, scene, expressionNames, index)
  const connected = connectedPorts(scene, node.id)
  const groups = conceptGroups(descriptor)
  const pinned = new Set(node.pinned ?? [])
  const togglePin = (port: string): void => store.updateNode(node.id, { pinned: pinned.has(port) ? [...pinned].filter((p) => p !== port) : [...pinned, port] })
  const lines = (sourceMap.nodes[node.id] ?? []).map((n) => code.split('\n')[n - 1] ?? '').map((l) => l.trim())
  const nodeIssues = issues.filter((i) => i.node === node.id)
  const inPlay = scene.steps.some((s) => s.kind === 'play' && s.animations.includes(node.id))
  const live = isLiveSource(scene, node.id, index)
  // Only Manim objects have suspend_updating and friends; a State runs a scene updater.
  const hasUpdaters = catalogued.kind !== 'builtin' && sourceMap.live.some((id) => rootOf(scene, id, index) === node.id)
  const isMobject = descriptor.returns.type === 'mobject' || descriptor.returns.type === 'coordinate_system'

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
          <span className="swatch-bar" style={{ background: TYPE_COLOR[descriptor.returns.type] }} />
          <input
            className="port-input"
            value={node.label ?? ''}
            placeholder={descriptor.name}
            onChange={(e) => store.updateNode(node.id, { label: e.target.value || null })}
          />
          <span className="mono muted" title={descriptor.qualname}>
            {node.id}
          </span>
        </div>
        <div className="mono inspector-path">{descriptor.qualname}</div>
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
        {groups.map((group) => (
          <div key={group.label}>
            <div className="group-head">{group.label}</div>
            {group.description && <div className="group-desc">{group.description}</div>}
            {group.params.map((param) => (
              <Field
                key={param.name}
                param={param}
                connected={connected.has(param.name)}
                value={node.values[param.name]}
                onChange={(v) => store.setValue(node.id, param.name, v)}
                pinned={pinned.has(param.name)}
                onPin={() => togglePin(param.name)}
                onTurnIntoPort={() => {
                  store.setValue(node.id, param.name, undefined)
                  if (!pinned.has(param.name)) togglePin(param.name)
                }}
                onConfig={
                  param.type.type === 'config' && !connected.has(param.name)
                    ? () => {
                        const config = index.get('Config')
                        if (!config) return
                        const id = store.addCatalogueNode(config, [node.position[0] - 220, node.position[1] + 40], index)
                        store.connect({ source: id, target: node.id, port: param.name, live: false })
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ))}
        {node.parent && <div className="inspector-doc">Inside a Map or Repeat: this builds one object per run. The canvas shows the last run's object.</div>}
        {descriptor.name === 'Config' && (
          <ConfigEditor
            keys={node.config ?? []}
            onChange={(config, renamed) => {
              const values = { ...node.values }
              if (renamed && renamed.from in values) {
                values[renamed.to] = values[renamed.from]!
                delete values[renamed.from]
              }
              store.updateNode(node.id, { config, values })
            }}
          />
        )}
        {descriptor.kind === 'group' && (
          <button className="button" onClick={() => store.editGroup(node.catalogue.slice(GROUP_PREFIX.length))}>
            Edit group {descriptor.name}
          </button>
        )}
        {isMobject && sceneType === 'ThreeDScene' && !editingGroup && (
          <div className="inspector-actions">
            <button className="button small" onClick={() => store.addStep({ kind: 'fixed_in_frame', mobjects: [node.id], action: 'add' })}>
              fix in frame
            </button>
          </div>
        )}
        {descriptor.name === ANIMATE && (
          <ChainEditor node={node} scene={scene} index={index} connected={connected} onChange={(chain) => store.updateNode(node.id, { chain })} />
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
  connected,
  onChange
}: {
  node: DocNode
  scene: Scene
  index: DescriptorIndex
  connected: Set<string>
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
                    connected={connected.has(chainPort(at, call.method, param.name))}
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

const KEY_TYPES: ConfigKey['type'][] = ['number', 'text', 'boolean', 'color', 'vector', 'function', 'config', 'mobject']

/** The keys of a Config node. Each key becomes a port typed as chosen here. */
function ConfigEditor({ keys, onChange }: { keys: ConfigKey[]; onChange(keys: ConfigKey[], renamed?: { from: string; to: string }): void }) {
  return (
    <div>
      <div className="group-head">Keys</div>
      {keys.map((key, at) => (
        <div key={at} className="field">
          <span className="field-value">
            <input
              className="port-input mono"
              value={key.name}
              placeholder="key"
              onChange={(e) => onChange(keys.map((k, i) => (i === at ? { ...k, name: e.target.value } : k)), { from: key.name, to: e.target.value })}
            />
          </span>
          <span className="field-value">
            <select className="port-select mono" value={key.type} onChange={(e) => onChange(keys.map((k, i) => (i === at ? { ...k, type: e.target.value as ConfigKey['type'] } : k)))}>
              {KEY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </span>
          <button className="link" onClick={() => onChange(keys.filter((_, i) => i !== at))}>
            remove
          </button>
        </div>
      ))}
      <button className="button small" onClick={() => onChange([...keys, { name: `key${keys.length + 1}`, type: 'number' }])}>
        + add key
      </button>
    </div>
  )
}

function Field({
  param,
  connected,
  value,
  onChange,
  onConfig,
  pinned = false,
  onPin,
  onTurnIntoPort
}: {
  param: Parameter
  connected: boolean
  value: JsonValue | undefined
  onChange(value: JsonValue | undefined): void
  /** For dict parameters: create a Config node and connect it here. */
  onConfig?(): void
  /** The socket at the far right: shown on the collapsed node when pinned. */
  pinned?: boolean
  onPin?(): void
  onTurnIntoPort?(): void
}) {
  const isSet = value !== undefined
  return (
    <div className={`field${isSet ? ' set' : ''}${onPin ? ' with-socket' : ''}`}>
      <span className="field-label" title={`${param.type.annotation}${param.display ? ` · default ${param.display}` : ''}`}>
        {param.name}
      </span>
      <span className="field-value">
        {connected ? (
          <span className="muted mono">driven</span>
        ) : onConfig ? (
          <button className="link" onClick={onConfig}>
            + Config
          </button>
        ) : (
          <PortEditor param={param} value={value} onChange={onChange} onTurnIntoPort={onTurnIntoPort} />
        )}
      </span>
      {onPin && (
        <button
          className={`field-socket${connected || pinned ? ' on' : ''}`}
          style={{ borderColor: TYPE_COLOR[param.type.type], background: connected ? TYPE_COLOR[param.type.type] : pinned ? 'var(--surface)' : 'transparent' }}
          title={connected ? 'Driven by a connection' : pinned ? 'Shown as a port on the node. Click to hide it when empty.' : 'Show as a port on the node, so another node can drive it.'}
          onClick={onPin}
        />
      )}
      <span className="field-default mono">
        {isSet && !connected ? (
          <button className="link" title={`Reset to the Manim default${param.display ? ` (${param.display})` : ''}`} onClick={() => onChange(undefined)}>
            reset
          </button>
        ) : !connected && param.default === null && !isSet ? (
          'required'
        ) : (
          ''
        )}
      </span>
    </div>
  )
}
