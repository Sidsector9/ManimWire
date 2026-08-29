import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { selectColors, selectDirections, selectRateCurves, useCatalogueStore } from '../store/catalogue'
import { NumberInput } from './inputs'

// The inspector's richer editors from the handoff: a colour picker that shows Manim's
// palette first, a 3 x 3 direction grid with x y z fields, and a rate function list
// with curve previews. Nodes keep the compact editors in PortEditor.

const POPOVER_WIDTH = 264

/** A popover under its trigger, rendered at the document root so panels do not clip it. */
function Popover({ open, anchor, onClose, children }: { open: boolean; anchor: React.RefObject<HTMLElement | null>; onClose(): void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const rect = anchor.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, rect.right - POPOVER_WIDTH))
    const top = rect.bottom + 4 + 320 > window.innerHeight ? Math.max(8, rect.top - 4 - 320) : rect.bottom + 4
    setPosition({ top, left })
  }, [open, anchor])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open, onClose, anchor])
  if (!open) return null
  return createPortal(
    <div ref={box} className="popover" style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}>
      {children}
    </div>,
    document.body
  )
}

export function ColorPicker({ value, placeholder, onChange }: { value: string | undefined; placeholder: string; onChange(value: string | undefined): void }) {
  const colors = useCatalogueStore(selectColors)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const hex = value?.startsWith('#') ? value : (colors.find((c) => c.name === value)?.hex ?? null)
  return (
    <span className="editor-anchor">
      <button ref={anchor} className="port-input color-trigger" onClick={() => setOpen((o) => !o)} title="Manim palette, then any colour">
        <span className="swatch" style={{ background: hex ?? 'transparent' }} />
        <span className="mono">{value ?? placeholder ?? 'default'}</span>
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="popover-title">Manim palette</div>
        <div className="palette">
          {colors.map((c) => (
            <button
              key={c.name}
              className={`palette-swatch${value === c.name ? ' active' : ''}`}
              style={{ background: c.hex }}
              title={c.name}
              onClick={() => {
                onChange(c.name)
                setOpen(false)
              }}
            />
          ))}
        </div>
        <div className="popover-title">Any colour</div>
        <div className="popover-row">
          <input type="color" value={hex ?? '#ffffff'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
          <input className="port-input mono" value={value?.startsWith('#') ? value : ''} placeholder="#RRGGBB" onChange={(e) => /^#[0-9A-Fa-f]{6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())} />
          <button className="link" onClick={() => onChange(undefined)}>
            default
          </button>
        </div>
      </Popover>
    </span>
  )
}

const GRID = ['UL', 'UP', 'UR', 'LEFT', 'ORIGIN', 'RIGHT', 'DL', 'DOWN', 'DR']
const GRID_XYZ: Record<string, [number, number, number]> = {
  UL: [-1, 1, 0], UP: [0, 1, 0], UR: [1, 1, 0], LEFT: [-1, 0, 0], ORIGIN: [0, 0, 0], RIGHT: [1, 0, 0], DL: [-1, -1, 0], DOWN: [0, -1, 0], DR: [1, -1, 0]
}

/** Direction grid shortcut, then x y z, so both `RIGHT` and `2 * RIGHT + 0.5 * UP` are expressible. */
export function VectorEditor({ value, placeholder, onChange }: { value: string | number[] | undefined; placeholder: string; onChange(value: string | number[] | undefined): void }) {
  const directions = useCatalogueStore(selectDirections)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const xyz: [number, number, number] = Array.isArray(value) && value.length === 3 ? [value[0]!, value[1]!, value[2]!] : typeof value === 'string' && GRID_XYZ[value] ? GRID_XYZ[value] : [0, 0, 0]
  const shown = Array.isArray(value) ? `[${value.join(', ')}]` : (value ?? placeholder ?? 'default')
  const setAxis = (axis: number, n: number | undefined): void => {
    const next: [number, number, number] = [...xyz]
    next[axis] = n ?? 0
    onChange(next)
  }
  return (
    <span className="editor-anchor">
      <button ref={anchor} className="port-input mono vector-trigger" onClick={() => setOpen((o) => !o)}>
        {shown}
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="popover-title">Direction</div>
        <div className="direction-grid">
          {GRID.map((d) => (
            <button
              key={d}
              className={`direction-cell${value === d ? ' active' : ''}`}
              title={d}
              onClick={() => {
                onChange(d)
                setOpen(false)
              }}
            >
              <span className="dot" />
            </button>
          ))}
        </div>
        <div className="popover-title">x y z</div>
        <div className="popover-row xyz">
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <label key={axis} className="mono">
              {axis}
              <NumberInput value={xyz[i]} onChange={(n) => setAxis(i, n)} />
            </label>
          ))}
        </div>
        {directions.length > 9 && (
          <div className="popover-row">
            <select className="port-select mono" value={typeof value === 'string' ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
              <option value="">other constant…</option>
              {directions.filter((d) => !GRID.includes(d)).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button className="link" onClick={() => onChange(undefined)}>
              default
            </button>
          </div>
        )}
      </Popover>
    </span>
  )
}

/** A 24 x 22 curve of a rate function sampled by the engine. */
export function RateCurve({ name, width = 24, height = 22 }: { name: string | undefined; width?: number; height?: number }) {
  const curves = useCatalogueStore(selectRateCurves)
  const samples = name ? curves[name] : undefined
  if (!samples || samples.length < 2) return <span className="rate-curve empty" style={{ width, height }} />
  const points = samples.map((v, i) => `${((i / (samples.length - 1)) * (width - 2) + 1).toFixed(1)},${((1 - Math.min(1.2, Math.max(-0.2, v))) * (height - 4) + 2).toFixed(1)}`)
  return (
    <svg className="rate-curve" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}

/** Rate function list with curve previews; "custom · turn into a port" hands the field to the graph. */
export function RateFuncPicker({
  value,
  placeholder,
  onChange,
  onTurnIntoPort
}: {
  value: string | undefined
  placeholder: string
  onChange(value: string | undefined): void
  onTurnIntoPort?(): void
}) {
  const curves = useCatalogueStore(selectRateCurves)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const names = Object.keys(curves)
  return (
    <span className="editor-anchor">
      <button ref={anchor} className="port-input rate-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="mono">{value ?? placeholder ?? 'default'}</span>
        <RateCurve name={value ?? (placeholder || undefined)} />
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="popover-title">{names.length} exported rate functions</div>
        <div className="rate-list">
          {names.map((name) => (
            <button
              key={name}
              className={`rate-row${value === name ? ' active' : ''}`}
              onClick={() => {
                onChange(name)
                setOpen(false)
              }}
            >
              <RateCurve name={name} width={22} height={14} />
              <span className="mono">{name}</span>
            </button>
          ))}
        </div>
        <div className="popover-row">
          <button className="link" onClick={() => onChange(undefined)}>
            default
          </button>
          {onTurnIntoPort && (
            <button
              className="link"
              onClick={() => {
                onTurnIntoPort()
                setOpen(false)
              }}
            >
              custom · turn into a port
            </button>
          )}
        </div>
      </Popover>
    </span>
  )
}
