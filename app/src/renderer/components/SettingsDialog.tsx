import { EXPORT_FORMATS, SCENE_TYPES, type ExportFormat, type SceneType } from '../model/document'
import { selectColors, useCatalogueStore } from '../store/catalogue'
import { previewScene, useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'

/** Manim's quality presets: name, width, height, frame rate. */
const PRESETS: Array<[string, number, number, number]> = [
  ['4k', 3840, 2160, 60],
  ['production', 2560, 1440, 60],
  ['high', 1920, 1080, 60],
  ['medium', 1280, 720, 30],
  ['low', 854, 480, 15]
]

/** Project and scene settings on one screen (design.md section 11). */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const settings = useDocumentStore((s) => s.doc.settings)
  const scene = useDocumentStore(previewScene)
  const store = useDocumentStore()
  const colors = useCatalogueStore(selectColors)
  const layout = useEngineResults((s) => s.layout)
  const preset = PRESETS.find(([, w, h, r]) => w === settings.pixel_width && h === settings.pixel_height && r === settings.frame_rate)?.[0] ?? 'custom'

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="field">
          <span className="field-label">scene type</span>
          <span className="field-value">
            <select className="port-select mono" value={scene.scene_type} onChange={(e) => store.setSceneType(e.target.value as SceneType)}>
              {SCENE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="field">
          <span className="field-label">quality</span>
          <span className="field-value">
            <select
              className="port-select mono"
              value={preset}
              onChange={(e) => {
                const chosen = PRESETS.find(([name]) => name === e.target.value)
                if (chosen) store.setSettings({ pixel_width: chosen[1], pixel_height: chosen[2], frame_rate: chosen[3] })
              }}
            >
              {PRESETS.map(([name, w, h, r]) => (
                <option key={name} value={name}>
                  {name} · {w} × {h} @ {r}
                </option>
              ))}
              {preset === 'custom' && (
                <option value="custom">
                  custom · {settings.pixel_width} × {settings.pixel_height} @ {settings.frame_rate}
                </option>
              )}
            </select>
          </span>
        </div>
        <div className="field">
          <span className="field-label">background</span>
          <span className="field-value">
            <select className="port-select" value={settings.background_color} onChange={(e) => store.setSettings({ background_color: e.target.value })}>
              {colors.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="field">
          <span className="field-label">output format</span>
          <span className="field-value">
            <select className="port-select mono" value={settings.output_format} onChange={(e) => store.setSettings({ output_format: e.target.value as ExportFormat })}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="group-head">Sections</div>
        {layout && layout.sections.length > 0 ? (
          layout.sections.map((section) => (
            <div key={`${section.name}-${section.start}`} className="field">
              <span className="field-label">{section.name}</span>
              <span className="field-value mono">
                {section.start.toFixed(2)} s to {section.end.toFixed(2)} s{section.skip_animations ? ' · skipped' : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="inspector-doc">No sections. Add one from the timeline.</div>
        )}
        <div className="inspector-actions">
          <button className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
