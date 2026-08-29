import { CAMERA_FIELDS, type Step } from '../model/document'
import { selectEntries, useCatalogueStore } from '../store/catalogue'
import { previewScene, useDocumentStore } from '../store/document'
import { NumberInput } from './inputs'

/** Fields of the selected timeline step. */
export function StepInspector({ index }: { index: number }) {
  const scene = useDocumentStore(previewScene)
  const store = useDocumentStore()
  const entries = useCatalogueStore(selectEntries)
  const step = scene.steps[index]
  if (!step) return null
  const update = (change: Partial<Step>): void => store.updateStep(index, { ...step, ...change } as Step)
  const rateFunctions = entries.filter((e) => e.kind === 'function' && e.signature === '(float) -> float').map((e) => e.name)
  const nameOf = (id: string): string => scene.nodes.find((n) => n.id === id)?.label ?? id

  return (
    <section className="panel inspector">
      <div className="panel-head">
        <span>Step {index + 1}</span>
        <span className="mono" style={{ fontWeight: 400 }}>
          {step.kind}
        </span>
      </div>
      <div className="inspector-body">
        {step.kind === 'play' && (
          <>
            <div className="inspector-doc">The step lasts as long as its longest animation. These values apply to every animation in it.</div>
            <div className="group-head">Animations</div>
            {step.animations.map((id) => (
              <div key={id} className="field">
                <span className="field-label">{nameOf(id)}</span>
                <span className="field-value">
                  <button className="link" onClick={() => store.select(id)}>
                    select node
                  </button>
                </span>
              </div>
            ))}
            <div className="group-head">Animation timing</div>
            <NumberField label="run_time" value={step.run_time} placeholder="per animation" onChange={(v) => update({ run_time: v })} />
            <div className="field">
              <span className="field-label">rate_func</span>
              <span className="field-value">
                <select className="port-select mono" value={step.rate_func ?? ''} onChange={(e) => update({ rate_func: e.target.value || null })}>
                  <option value="">per animation</option>
                  {rateFunctions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <NumberField label="lag_ratio" value={step.lag_ratio} placeholder="per animation" onChange={(v) => update({ lag_ratio: v })} />
            <div className="group-head">Subcaption</div>
            <TextField label="text" value={step.subcaption ?? ''} onChange={(v) => update({ subcaption: v || null })} />
            <NumberField label="duration" value={step.subcaption_duration} placeholder="run_time" onChange={(v) => update({ subcaption_duration: v })} />
            <NumberField label="offset" value={step.subcaption_offset} placeholder="0" onChange={(v) => update({ subcaption_offset: v ?? 0 })} />
          </>
        )}
        {step.kind === 'wait' && <NumberField label="duration" value={step.duration} placeholder="1" onChange={(v) => update({ duration: v ?? 1 })} />}
        {step.kind === 'section' && (
          <>
            <TextField label="name" value={step.name} onChange={(v) => update({ name: v })} />
            <div className="field">
              <span className="field-label">skip_animations</span>
              <span className="field-value">
                <input type="checkbox" checked={step.skip_animations} onChange={(e) => update({ skip_animations: e.target.checked })} />
              </span>
            </div>
          </>
        )}
        {step.kind === 'sound' && (
          <>
            <TextField label="file" value={step.file} onChange={(v) => update({ file: v })} />
            <NumberField label="time_offset" value={step.time_offset} placeholder="0" onChange={(v) => update({ time_offset: v ?? 0 })} />
            <NumberField label="gain" value={step.gain} placeholder="none" onChange={(v) => update({ gain: v })} />
          </>
        )}
        {step.kind === 'subcaption' && (
          <>
            <TextField label="content" value={step.content} onChange={(v) => update({ content: v })} />
            <NumberField label="duration" value={step.duration} placeholder="1" onChange={(v) => update({ duration: v ?? 1 })} />
            <NumberField label="offset" value={step.offset} placeholder="0" onChange={(v) => update({ offset: v ?? 0 })} />
          </>
        )}
        {step.kind === 'updating' && (
          <>
            <div className="inspector-doc">Updaters of {step.mobjects.map(nameOf).join(', ')}. Suspend and resume keep them; clear removes them.</div>
            <div className="field">
              <span className="field-label">action</span>
              <span className="field-value">
                <select className="port-select mono" value={step.action} onChange={(e) => update({ action: e.target.value as typeof step.action })}>
                  <option value="suspend">suspend_updating</option>
                  <option value="resume">resume_updating</option>
                  <option value="clear">clear_updaters</option>
                </select>
              </span>
            </div>
          </>
        )}
        {step.kind === 'camera' && (
          <>
            <div className="inspector-doc">
              {step.action === 'orient' ? 'set_camera_orientation: jump to these angles.' : 'move_camera: animate the camera to these angles over run_time.'} Empty fields keep their current value.
            </div>
            <div className="field">
              <span className="field-label">action</span>
              <span className="field-value">
                <select className="port-select mono" value={step.action} onChange={(e) => update({ action: e.target.value as typeof step.action })}>
                  <option value="orient">set_camera_orientation</option>
                  <option value="move">move_camera</option>
                </select>
              </span>
            </div>
            {CAMERA_FIELDS.map((field) => (
              <NumberField key={field} label={field} value={step[field]} placeholder="unchanged" onChange={(v) => update({ [field]: v })} />
            ))}
            {step.action === 'move' && <NumberField label="run_time" value={step.run_time} placeholder="1" onChange={(v) => update({ run_time: v })} />}
          </>
        )}
        {step.kind === 'fixed_in_frame' && (
          <>
            <div className="inspector-doc">Objects fixed in frame stay in place while the 3D camera moves: {step.mobjects.map(nameOf).join(', ')}</div>
            <div className="field">
              <span className="field-label">action</span>
              <span className="field-value">
                <select className="port-select mono" value={step.action} onChange={(e) => update({ action: e.target.value as typeof step.action })}>
                  <option value="add">add_fixed_in_frame_mobjects</option>
                  <option value="remove">remove_fixed_in_frame_mobjects</option>
                </select>
              </span>
            </div>
          </>
        )}
        {(step.kind === 'add' || step.kind === 'remove' || step.kind === 'bring_to_front' || step.kind === 'bring_to_back') && (
          <div className="inspector-doc">{step.kind.replace(/_/g, ' ')}: {step.mobjects.map(nameOf).join(', ')}</div>
        )}
        <div className="inspector-actions">
          <button className="button small" onClick={() => index > 0 && store.moveStep(index, index - 1)} disabled={index === 0}>
            move earlier
          </button>
          <button className="button small" onClick={() => index < scene.steps.length - 1 && store.moveStep(index, index + 1)} disabled={index >= scene.steps.length - 1}>
            move later
          </button>
          <button className="button small danger" onClick={() => store.removeStep(index)}>
            remove step
          </button>
        </div>
      </div>
    </section>
  )
}

function NumberField({ label, value, placeholder, onChange }: { label: string; value: number | null | undefined; placeholder: string; onChange(value: number | null): void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">
        <NumberInput value={value} placeholder={placeholder} onChange={(v) => onChange(v ?? null)} />
      </span>
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">
        <input className="port-input" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  )
}
