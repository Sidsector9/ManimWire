import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { selectColors, selectDirections, selectRateCurves, useCatalogueStore } from '../store/catalogue'
import { NumberInput } from './inputs'
import { ExpressionTextarea } from './ExpressionTextarea'

// The inspector's richer editors from the handoff: a colour picker that shows Manim's
// palette first, a 3 x 3 direction grid with x y z fields, and a rate function list
// with curve previews. Nodes keep the compact editors in PortEditor.

const POPOVER_WIDTH = 264

/** A full-size editor for expressions and text, shared by the graph and inspector. */
export function ExpressionEditor({ value, placeholder, onChange, language = 'python', multiple = false }: {
  value: string; placeholder: string; onChange(value: string | undefined): void
  language?: 'python' | 'latex' | 'text'; multiple?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const label = language === 'text' ? 'Text' : language === 'latex' ? 'LaTeX' : 'Expression'
  const editLabel = language === 'text' ? 'Edit text' : language === 'latex' ? 'Edit LaTeX' : 'Edit expression'
  return <>
    <input
      className="port-input mono expression-trigger"
      aria-label={editLabel}
      aria-haspopup="dialog"
      readOnly
      value={value}
      placeholder={placeholder}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => dialog.current?.showModal()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          dialog.current?.showModal()
        }
      }}
    />
    {createPortal(<dialog ref={dialog} className="expression-dialog" aria-label={editLabel}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="expression-editor-heading">
        <strong>{label}</strong>
        <button className="button small" onClick={() => dialog.current?.close()}>Done</button>
      </div>
      {multiple && <p className="muted">One TeX string per line. Use \\ for a LaTeX line break.</p>}
      <ExpressionTextarea value={value} placeholder={placeholder} onChange={onChange} language={language} />
    </dialog>, document.body)}
  </>
}

/** A popover under its trigger, rendered at the document root so panels do not clip it. */
export function Popover({ open, anchor, onClose, children }: { open: boolean; anchor: React.RefObject<HTMLElement | null>; onClose(): void; children: React.ReactNode }) {
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
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const anchor = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const shown = value ?? placeholder ?? 'default'
  const hex = shown.startsWith('#') ? shown : colors.find((c) => c.name === shown)?.hex
  const search = query.trim()
  const options: { name: string; hex?: string; value: string | undefined }[] = [
    { name: `Default (${placeholder || 'unset'})`, value: undefined },
    ...colors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).map((c) => ({ ...c, value: c.name })),
    ...(/^#[0-9a-f]{6}$/i.test(search) ? [{ name: search.toUpperCase(), hex: search, value: search.toUpperCase() }] : [])
  ]
  const choose = (next: string | undefined): void => {
    onChange(next)
    setOpen(false)
    anchor.current?.focus()
  }
  useLayoutEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])
  return (
    <span className="editor-anchor nodrag">
      <button ref={anchor} className="port-input color-trigger" aria-haspopup="listbox" aria-expanded={open}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => { setQuery(''); setActive(0); setOpen((current) => !current) }}>
        <span className="swatch" style={{ background: hex ?? 'transparent' }} />
        <span className="color-name mono">{shown}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
        <div className="color-dropdown nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <input className="port-input" autoFocus role="combobox" aria-label="Search colors"
            aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={`${listId}-${active}`}
            placeholder="Search colors or enter #RRGGBB" value={query}
            onChange={(event) => {
              const next = event.target.value.trim()
              setQuery(event.target.value)
              setActive(next && (colors.some((color) => color.name.toLowerCase().includes(next.toLowerCase())) || /^#[0-9a-f]{6}$/i.test(next)) ? 1 : 0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const option = options[active]
                if (option) choose(option.value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
                anchor.current?.focus()
              }
            }} />
          <div ref={list} id={listId} className="color-options" role="listbox" aria-label="Colors">
            {options.map((option, index) => <div key={option.name} id={`${listId}-${index}`} role="option"
              aria-selected={value === option.value} className={`color-option${index === active ? ' active' : ''}`}
              onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}>
              <span className="swatch" style={{ background: option.hex ?? 'transparent' }} />
              <span className="mono">{option.name}</span>
              {value === option.value && <span className="color-check" aria-hidden="true">✓</span>}
            </div>)}
          </div>
          {options.length === 1 && search && <div className="muted">No matching colors. Enter #RRGGBB for a custom color.</div>}
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
