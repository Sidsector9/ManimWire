import type { Parameter } from '../../shared/engine'
import type { JsonValue } from '../model/document'
import { selectColors, useCatalogueStore } from '../store/catalogue'

// Direction constants Manim exports; mirrors DIRECTION_NAMES in the engine.
export const DIRECTIONS = ['ORIGIN', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'IN', 'OUT', 'UL', 'UR', 'DL', 'DR', 'X_AXIS', 'Y_AXIS', 'Z_AXIS']

interface Props {
  param: Parameter
  value: JsonValue | undefined
  onChange(value: JsonValue | undefined): void
  compact?: boolean
}

/** Inline editor for one literal port, chosen by the catalogue type. */
export function PortEditor({ param, value, onChange, compact = false }: Props) {
  const colors = useCatalogueStore(selectColors)
  const { type } = param
  const placeholder = param.display ?? ''
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  if (type.collection && type.type === 'number') {
    const text = Array.isArray(value) ? value.join(', ') : ''
    return (
      <input
        className="port-input mono"
        value={text}
        placeholder={placeholder}
        onMouseDown={stop}
        onChange={(e) => {
          const parts = e.target.value.split(',').map((s) => s.trim()).filter((s) => s !== '')
          const numbers = parts.map(Number)
          onChange(parts.length === 0 ? undefined : numbers.every((n) => !Number.isNaN(n)) ? numbers : value)
        }}
      />
    )
  }
  switch (type.type) {
    case 'number':
      return (
        <input
          className="port-input mono"
          type="number"
          step="any"
          value={typeof value === 'number' ? value : ''}
          placeholder={placeholder}
          onMouseDown={stop}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
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
      return (
        <select className="port-select mono" value={typeof value === 'string' ? value : ''} onMouseDown={stop} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{placeholder || 'default'}</option>
          {DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )
    case 'text':
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
      return (
        <input
          className="port-input"
          value={typeof value === 'string' ? value : ''}
          placeholder={placeholder.replace(/^'|'$/g, '')}
          onMouseDown={stop}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )
    default:
      return <span className="port-connect">{compact ? '' : 'connect'}</span>
  }
}

function swatch(value: JsonValue | undefined, colors: { name: string; hex: string }[]): string {
  if (typeof value !== 'string') return 'transparent'
  if (value.startsWith('#')) return value
  return colors.find((c) => c.name === value)?.hex ?? 'transparent'
}
