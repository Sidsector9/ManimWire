import { EXPORT_FORMATS, SCENE_TYPES, type ExportFormat, type SceneType } from '../model/document'
import { selectColors, useCatalogueStore } from '../store/catalogue'
import { previewScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'
import { useUiStore, type NodeDensity } from '../store/ui'

/** Manim's quality presets: name, width, height, frame rate. */
export const PRESETS: Array<[string, number, number, number]> = [
  ['4k', 3840, 2160, 60],
  ['production', 2560, 1440, 60],
  ['high', 1920, 1080, 60],
  ['medium', 1280, 720, 30],
  ['low', 854, 480, 15]
]

/** "high · 1920×1080 · 60 fps" for the toolbar chip. */
export function presetLabel(settings: { pixel_width: number; pixel_height: number; frame_rate: number }): string {
  const name = PRESETS.find(([, w, h, r]) => w === settings.pixel_width && h === settings.pixel_height && r === settings.frame_rate)?.[0] ?? 'custom'
  return `${name} · ${settings.pixel_width}×${settings.pixel_height} · ${settings.frame_rate} fps`
}

/** Background swatches from the handoff: BLACK, dark grey, white, Manim's dark blue. */
const BACKGROUNDS: Array<[string, string]> = [
  ['BLACK', '#000000'],
  ['#222222', '#222222'],
  ['#FFFFFF', '#FFFFFF'],
  ['#236B8E', '#236B8E']
]

/** Project and scene settings on one screen (handoff section 10). Changes apply at once. */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const settings = useDocumentStore((s) => s.doc.settings)
  const scene = useDocumentStore(previewScene)
  const store = useDocumentStore()
  const colors = useCatalogueStore(selectColors)
  const layout = useEngineResults((s) => s.layout)
  const density = useUiStore((s) => s.nodeDensity)
  const setDensity = useUiStore((s) => s.setNodeDensity)
  const preset = PRESETS.find(([, w, h, r]) => w === settings.pixel_width && h === settings.pixel_height && r === settings.frame_rate)?.[0] ?? 'custom'
  const sectionSteps = scene.steps.map((step, index) => ({ step, index })).filter((s) => s.step.kind === 'section')

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Project and scene</h2>
        <div className="dialog-section">Scene type</div>
        <div className="chips">
          {SCENE_TYPES.map((t) => (
            <button key={t} className={`chip mono${scene.scene_type === t ? ' active' : ''}`} onClick={() => store.setSceneType(t as SceneType)}>
              {t}
            </button>
          ))}
        </div>
        <div className="dialog-section">Quality preset</div>
        <div className="radio-list">
          {PRESETS.map(([name, w, h, r]) => (
            <label key={name} className={`radio-row${preset === name ? ' active' : ''}`}>
              <input type="radio" name="quality" checked={preset === name} onChange={() => store.setSettings({ pixel_width: w, pixel_height: h, frame_rate: r })} />
              <span>{name}</span>
              <span className="mono muted">
                {w} × {h} · {r} fps
              </span>
            </label>
          ))}
          {preset === 'custom' && (
            <div className="radio-row active">
              <span>custom</span>
              <span className="mono muted">
                {settings.pixel_width} × {settings.pixel_height} · {settings.frame_rate} fps
              </span>
            </div>
          )}
        </div>
        <div className="dialog-section">Background colour</div>
        <div className="chips">
          {BACKGROUNDS.map(([name, hex]) => (
            <button key={name} className={`bg-swatch${settings.background_color === name ? ' active' : ''}`} style={{ background: hex }} title={name} onClick={() => store.setSettings({ background_color: name })} />
          ))}
          <select className="port-select" value={settings.background_color} onChange={(e) => store.setSettings({ background_color: e.target.value })}>
            {!colors.some((c) => c.name === settings.background_color) && <option value={settings.background_color}>{settings.background_color}</option>}
            {colors.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-section">Output format</div>
        <div className="chips">
          {EXPORT_FORMATS.map((f) => (
            <button key={f} className={`chip mono${settings.output_format === f ? ' active' : ''}`} onClick={() => store.setSettings({ output_format: f as ExportFormat })}>
              {f}
            </button>
          ))}
        </div>
        <div className="dialog-section">Sections</div>
        {sectionSteps.length > 0 ? (
          sectionSteps.map(({ step, index }, n) => {
            if (step.kind !== 'section') return null
            const span = layout?.sections[n]
            return (
              <div key={index} className="field">
                <span className="field-label">
                  {n + 1} {step.name}
                </span>
                <span className="field-value mono muted">{span ? `${span.start.toFixed(2)} – ${span.end.toFixed(2)} s` : ''}</span>
                <label className="toggle" title="skip_animations">
                  <input type="checkbox" checked={step.skip_animations} onChange={(e) => store.updateStep(index, { ...step, skip_animations: e.target.checked })} />
                  <span className="pill" />
                  skip
                </label>
              </div>
            )
          })
        ) : (
          <div className="inspector-doc">No sections. Add one from the timeline: next_section(name, skip_animations).</div>
        )}
        <div className="dialog-section">Node density</div>
        <div className="chips">
          {(['compact', 'comfortable'] as NodeDensity[]).map((d) => (
            <button key={d} className={`chip${density === d ? ' active' : ''}`} onClick={() => setDensity(d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="inspector-actions">
          <button className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
