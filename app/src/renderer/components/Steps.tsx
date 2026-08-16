import { selectIndex, useCatalogueStore } from '../store/catalogue'
import { currentScene, useDocumentStore } from '../store/document'

/** The scene's steps in order. The full timeline replaces this in phase 5. */
export function Steps() {
  const scene = useDocumentStore(currentScene)
  const store = useDocumentStore()
  const index = useCatalogueStore(selectIndex)
  const nameOf = (id: string): string => {
    const node = scene.nodes.find((n) => n.id === id)
    return node ? (node.label ?? index.get(node.catalogue)?.name ?? node.catalogue) : id
  }

  return (
    <section className="panel timeline">
      <div className="panel-head">
        <span>Steps</span>
        <span>
          <button className="button small" onClick={() => store.addStep({ kind: 'wait', duration: 1 })}>
            + wait
          </button>
        </span>
      </div>
      <div className="steps">
        {scene.steps.map((step, i) => (
          <div key={i} className={`step step-${step.kind}`}>
            <span className="step-index mono">{i + 1}</span>
            {step.kind === 'play' && <span>play {step.animations.map(nameOf).join(', ')}</span>}
            {step.kind === 'wait' && (
              <span>
                wait{' '}
                <input
                  className="port-input mono"
                  type="number"
                  step="0.5"
                  min="0"
                  value={step.duration}
                  onChange={(e) => store.updateStep(i, { kind: 'wait', duration: Number(e.target.value) })}
                />{' '}
                s
              </span>
            )}
            {step.kind === 'add' && <span>add {step.mobjects.map(nameOf).join(', ')}</span>}
            {step.kind === 'remove' && <span>remove {step.mobjects.map(nameOf).join(', ')}</span>}
            <button className="link" onClick={() => store.removeStep(i)}>
              remove
            </button>
          </div>
        ))}
        {scene.steps.length === 0 && <div className="muted steps-empty">No steps yet. Add an animation node and play it.</div>}
      </div>
    </section>
  )
}
