import type { Parameter } from '../../shared/engine'
import type { JsonValue } from '../model/document'
import { isMatrix } from '../model/types'
import { selectColors, selectDirections, selectEntries, selectFonts, useCatalogueStore } from '../store/catalogue'
import { ColorPicker, RateFuncPicker, VectorEditor } from './editors'
import { MatrixInput, NumberInput, NumberListInput } from './inputs'

interface Props {
  param: Parameter
  value: JsonValue | undefined
  onChange(value: JsonValue | undefined): void
  compact?: boolean
  /** Inspector only: expose the field as a port on the node (rate_func "custom"). */
  onTurnIntoPort?(): void
}

/** Inline editor for one literal port, chosen by the catalogue type. */
export function PortEditor({ param, value, onChange, compact = false, onTurnIntoPort }: Props) {
  const colors = useCatalogueStore(selectColors)
  const entries = useCatalogueStore(selectEntries)
  const directions = useCatalogueStore(selectDirections)
  const fonts = useCatalogueStore(selectFonts)
  const { type } = param
  // Manim takes a point wherever it takes a mobject: Line's start, move_to, next_to.
  // Mirrors the rule in engine/document/validate.py.
  const kind = type.type !== 'vector' && (type.accepts ?? []).includes('vector') ? 'vector' : type.type
  const placeholder = param.display ?? ''
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  if (type.collection && type.type === 'number') {
    const numbers = Array.isArray(value) && value.every((v) => typeof v === 'number') ? (value as number[]) : undefined
    return <NumberListInput value={numbers} placeholder={placeholder} onChange={onChange} />
  }
  switch (kind) {
    case 'number':
      return <NumberInput value={typeof value === 'number' ? value : undefined} placeholder={placeholder} onChange={onChange} />
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={typeof value === 'boolean' ? value : param.default === 'True'}
          onMouseDown={stop}
          onChange={(e) => onChange(e.target.checked)}
        />
      )
    case 'color':
      if (!compact) return <ColorPicker value={typeof value === 'string' ? value : undefined} placeholder={placeholder} onChange={onChange} />
      return (
        <span className="port-color">
          <span className="swatch" style={{ background: swatch(value, colors) }} />
          <select className="port-select" value={typeof value === 'string' ? value : ''} onMouseDown={stop} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">{placeholder || 'default'}</option>
            {colors.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </span>
      )
    case 'vector':
      if (isMatrix(type)) {
        const rows = Array.isArray(value) && value.every((row) => Array.isArray(row)) ? (value as number[][]) : undefined
        return <MatrixInput value={rows} placeholder={placeholder} onChange={onChange} />
      }
      if (!compact) return <VectorEditor value={typeof value === 'string' || Array.isArray(value) ? (value as string | number[]) : undefined} placeholder={placeholder} onChange={onChange} />
      return (
        <select className="port-select mono" value={typeof value === 'string' ? value : ''} onMouseDown={stop} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{placeholder || 'default'}</option>
          {directions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )
    case 'text':
      if (param.kind === 'var_positional') {
        // Several strings for one *args port (Tex takes one string per part): one per line.
        const lines = Array.isArray(value) ? value.map(String).join('\n') : typeof value === 'string' ? value : ''
        return (
          <textarea
            className="port-input"
            rows={compact ? 1 : 3}
            value={lines}
            placeholder="one item per line"
            onMouseDown={stop}
            onChange={(e) => {
              const items = e.target.value.split('\n')
              onChange(e.target.value === '' ? undefined : items.length === 1 ? items[0] : items)
            }}
          />
        )
      }
      if (type.choices) {
        return (
          <select className="port-select mono" value={typeof value === 'string' ? value : ''} onMouseDown={stop} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">{placeholder || 'default'}</option>
            {type.choices.map((c) => (
              <option key={c} value={c}>
                {c.replace(/^'|'$/g, '')}
              </option>
            ))}
          </select>
        )
      }
      if (param.name === 'font' && fonts.length > 0) {
        // Fonts Pango can render on this machine, from manimpango.
        return (
          <>
            <input
              className="port-input"
              list="manim-fonts"
              value={typeof value === 'string' ? value : ''}
              placeholder="system default"
              onMouseDown={stop}
              onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            />
            <datalist id="manim-fonts">
              {fonts.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </>
        )
      }
      return (
        <input
          className="port-input"
          value={typeof value === 'string' ? value : ''}
          placeholder={placeholder.replace(/^'|'$/g, '')}
          onMouseDown={stop}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )
    case 'function': {
      // Catalogue functions whose signature matches the port, for example rate functions.
      const names = type.signature ? entries.filter((e) => e.kind === 'function' && e.signature === type.signature).map((e) => e.name) : []
      if (names.length === 0) return <span className="port-connect">{compact ? '' : 'connect'}</span>
      if (!compact && type.signature === '(float) -> float') {
        return <RateFuncPicker value={typeof value === 'string' ? value : undefined} placeholder={placeholder} onChange={onChange} onTurnIntoPort={onTurnIntoPort} />
      }
      return (
        <select className="port-select mono" value={typeof value === 'string' ? value : ''} onMouseDown={stop} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{placeholder || 'default'}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )
    }
    default:
      return <span className="port-connect">{compact ? '' : 'connect'}</span>
  }
}

function swatch(value: JsonValue | undefined, colors: { name: string; hex: string }[]): string {
  if (typeof value !== 'string') return 'transparent'
  if (value.startsWith('#')) return value
  return colors.find((c) => c.name === value)?.hex ?? 'transparent'
}
