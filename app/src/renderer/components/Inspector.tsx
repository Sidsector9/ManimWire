import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Parameter } from '../../shared/engine'
import { GROUP_PREFIX, SELF_PORT, connectedPorts, type ConfigKey, type DocNode, type JsonValue, type MethodCall, type Scene, type UpdatingAction } from '../model/document'
import { conceptGroups } from '../model/groups'
import { ANIMATE, canAddToScene, chainMethods, chainPort, effectiveDescriptor, isLiveSource, playsEachRun, rootOf } from '../model/live'
import type { DescriptorIndex } from '../model/types'
import { TYPE_COLOR, selectExpressionNames, useCatalogueStore } from '../store/catalogue'
import { useDescriptorIndex } from '../store/descriptors'
import { currentScene, previewScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { PortEditor } from './PortEditor'
import { StepInspector } from './StepInspector'
import { MethodPicker } from './MethodPicker'

const UPDATING_ACTIONS: Array<[UpdatingAction, string]> = [
  ['suspend', 'suspend updating'],
  ['resume', 'resume updating'],
  ['clear', 'clear updaters']
]

/** Every field of the selected node, grouped by the Manim class that declares it. */
export function Inspector() {
  const scene = useDocumentStore(currentScene)
  const selected = useDocumentStore((s) => s.selected)
  const selectedNodes = useDocumentStore((s) => s.selectedNodes)
  const selectedStep = useDocumentStore((s) => s.selectedStep)
  const store = useDocumentStore()
  const index = useDescriptorIndex()
  const sceneType = useDocumentStore((s) => previewScene(s).scene_type)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const expressionNames = useCatalogueStore(selectExpressionNames)
  const code = useEngineResults((s) => s.code)
  const sourceMap = useEngineResults((s) => s.sourceMap)
  const issues = useEngineResults((s) => s.issues)

  const picked = scene.nodes.filter((n) => selectedNodes.includes(n.id))
  if (picked.length > 1) {
    return (
      <section className="panel inspector">
        <div className="panel-head"><span>Inspector</span></div>
        <div className="inspector-body">
          <div className="inspector-title">{picked.length} nodes selected</div>
          {editingGroup
            ? <div className="inspector-doc">Add objects to the scene from the main graph.</div>
            : <SceneActions nodes={picked} scene={scene} index={index} />}
        </div>
      </section>
    )
  }

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
  // A node inside a Map or Repeat runs once per item, so the container goes on the
  // timeline, never the node. Playing the node itself is not a step the engine allows.
  // A container of animations goes on the timeline as a loop: one play per run.
  const loops = playsEachRun(scene, node, index)
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
          <div className="inspector-identity-row">
            <span className="muted">Output type</span>
            <span className="inspector-output-type">
              <span className="swatch-bar" aria-hidden="true" style={{ background: TYPE_COLOR[descriptor.returns.type] }} />
              {descriptor.returns.type.replaceAll('_', ' ')}
            </span>
          </div>
          <label className="inspector-identity-row">
            <span className="muted">Label</span>
            <input
              className="port-input"
              value={node.label ?? ''}
              placeholder={descriptor.name}
              onChange={(e) => store.updateNode(node.id, { label: e.target.value || null })}
            />
          </label>
          <div className="inspector-identity-row">
            <span className="muted">Node ID</span>
            <span className="mono muted">{node.id}</span>
          </div>
        </div>
        <div className="mono inspector-path">{descriptor.qualname}</div>
        {descriptor.doc && <div className="inspector-doc">{descriptor.doc}</div>}
        {nodeIssues.map((issue, i) => (
          <div key={i} className="inspector-issue">
            {issue.message}
          </div>
        ))}
        {(descriptor.returns.type === 'animation' || loops) && !inPlay && node.parent == null && (
          <button className="button" onClick={() => store.addStep({ kind: 'play', animations: [node.id] })}>
            {loops ? 'Play this once per run' : 'Play this animation'}
          </button>
        )}
        {!editingGroup && <SceneActions nodes={[node]} scene={scene} index={index} />}
        {descriptor.kind === 'method' && (
          <div className="field">
            <span className="field-label">object</span>
            <span className="field-value muted">{connected.has(SELF_PORT) ? 'connected' : 'connect a mobject'}</span>
          </div>
        )}
        {groups.map((group) => (
          <section key={group.label} className="inspector-section" data-section={group.label.toLowerCase().replaceAll(' ', '-')} aria-label={group.label}>
            <h3 className="group-head">{group.label}</h3>
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
          </section>
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

/** Edit direct scene additions without deleting the corresponding graph nodes. */
function SceneActions({ nodes, scene, index }: { nodes: DocNode[]; scene: Scene; index: DescriptorIndex }) {
  const add = useDocumentStore((s) => s.addToScene)
  const remove = useDocumentStore((s) => s.removeFromScene)
  const added = new Set(scene.steps.flatMap((step) => step.kind === 'add' ? step.mobjects : []))
  const eligible = nodes.filter((node) => canAddToScene(node, index.get(node.catalogue)))
  const pending = eligible.filter((node) => !added.has(node.id))
  const included = nodes.filter((node) => added.has(node.id))
  const count = nodes.length - eligible.length
  return (
    <>
      {pending.length > 0 && (
        <button className="button" title="Add the objects together at the end of the Timeline, without animation" onClick={() => add(pending.map((node) => node.id), index)}>
          {nodes.length === 1 ? 'Add to the scene' : `Add ${pending.length} ${pending.length === 1 ? 'object' : 'objects'} to the scene`}
        </button>
      )}
      {included.length > 0 && (
        <button className="button danger" title="Remove the explicit scene additions. Animations can still display these objects." onClick={() => remove(included.map((node) => node.id))}>
          {nodes.length === 1 ? 'Remove from the scene' : `Remove ${included.length} ${included.length === 1 ? 'object' : 'objects'} from the scene`}
        </button>
      )}
      {nodes.length > 1 && count > 0 && (
        <div className="inspector-doc">{count} selected {count === 1 ? 'node does' : 'nodes do'} not produce an object that can be added directly to the scene.</div>
      )}
    </>
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
        <MethodPicker methods={methods.map((method) => method.name)}
          onSelect={(method) => onChange([...chain, { method, values: {} }])} />
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
  const [tooltip, setTooltip] = useState<{ right: number; top: number } | null>(null)
  const tooltipId = useId()
  useEffect(() => {
    if (!tooltip) return
    const dismiss = (): void => setTooltip(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [tooltip])
  const isSet = value !== undefined
  return (
    <div className={`field${isSet ? ' set' : ''}${onPin ? ' with-socket' : ''}`}
      aria-describedby={tooltip ? tooltipId : undefined}
      onPointerEnter={(event) => {
        const label = event.currentTarget.querySelector('.field-label')!.getBoundingClientRect()
        setTooltip({ right: window.innerWidth - label.right, top: label.top - 6 })
      }}
      onPointerLeave={() => setTooltip(null)}
      onPointerDown={() => setTooltip(null)}
    >
      {tooltip && createPortal(
        <div id={tooltipId} role="tooltip" className="inspector-field-tooltip" style={tooltip}>
          {param.name}
        </div>, document.body
      )}
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
        ) : !connected && param.default === null && param.kind !== 'var_positional' && !isSet ? (
          'required'
        ) : (
          ''
        )}
      </span>
    </div>
  )
}
