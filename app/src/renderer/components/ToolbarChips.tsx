import { useRef, useState } from 'react'
import { SCENE_TYPES, type SceneType } from '../model/document'
import { previewScene, useDocumentStore } from '../store/document'
import { Popover } from './editors'
import { PRESETS, presetLabel } from './SettingsDialog'

/** The scene's type, on the chip that names the scene. */
export function SceneChip() {
  const scene = useDocumentStore(previewScene)
  const setSceneType = useDocumentStore((s) => s.setSceneType)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  return (
    <span className="editor-anchor">
      <button ref={anchor} className="chip" title="Scene type" onClick={() => setOpen((o) => !o)}>
        {scene.name}
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="popover-title">Scene type</div>
        <div className="setting-list">
          {SCENE_TYPES.map((type) => (
            <button
              key={type}
              className={`setting-row${scene.scene_type === type ? ' active' : ''}`}
              onClick={() => {
                setSceneType(type as SceneType)
                setOpen(false)
              }}
            >
              <span>{type}</span>
            </button>
          ))}
        </div>
      </Popover>
    </span>
  )
}

/** Resolution and frame rate, on the chip that shows them. */
export function QualityChip() {
  const settings = useDocumentStore((s) => s.doc.settings)
  const setSettings = useDocumentStore((s) => s.setSettings)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  return (
    <span className="editor-anchor">
      <button ref={anchor} className="chip mono" title="Quality preset" onClick={() => setOpen((o) => !o)}>
        {presetLabel(settings)}
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="popover-title">Quality preset</div>
        <div className="setting-list">
          {PRESETS.map(([name, width, height, rate]) => (
            <button
              key={name}
              className={`setting-row${settings.pixel_width === width && settings.pixel_height === height && settings.frame_rate === rate ? ' active' : ''}`}
              onClick={() => {
                setSettings({ pixel_width: width, pixel_height: height, frame_rate: rate })
                setOpen(false)
              }}
            >
              <span>{name}</span>
              <span className="detail">
                {width}×{height} · {rate} fps
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </span>
  )
}
