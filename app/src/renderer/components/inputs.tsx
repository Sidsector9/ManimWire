import { useEffect, useState } from 'react'
import type { JsonValue } from '../model/document'

/** Untyped Manim options can accept JSON literals or a typed node connection. */
export function JsonInput({ value, onChange, label }: {
  value: JsonValue | undefined; onChange(value: JsonValue | undefined): void; label: string
}) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value))
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!focused && !error) setText(value === undefined ? '' : JSON.stringify(value))
  }, [value, focused, error])
  const commit = (): void => {
    try {
      onChange(text.trim() ? JSON.parse(text) as JsonValue : undefined)
      setError(false)
    } catch { setError(true) }
  }
  return <input className="port-input mono" aria-label={label} aria-invalid={error}
    title={error ? 'Enter valid JSON: a number, true/false, quoted text, list, or object.' : 'JSON value, or connect a node'}
    placeholder="JSON or connect" value={text}
    onMouseDown={(event) => event.stopPropagation()}
    onFocus={() => setFocused(true)}
    onChange={(event) => { setText(event.target.value); setError(false) }}
    onBlur={() => { commit(); setFocused(false) }}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
}

// Number editors that keep their own draft text. A browser number input reports
// an empty value for a lone "-" or "1e", and committing every keystroke sends
// half-typed values (a one-element x_range) to Manim. These commit only complete
// values: a number as soon as it parses, a list when the field is left or Enter is pressed.

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

/** Retain an angle expression verbatim; the engine validates it before rendering. */
export function AngleInput({ value, onChange, label }: {
  value: number | string | null | undefined
  onChange(value: number | string | null): void
  label: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value == null ? '' : String(value))
  }, [value, focused])
  const commit = (): void => {
    const trimmed = text.trim()
    const next = trimmed === '' ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed
    if (next !== (value ?? null)) onChange(next)
  }
  return <input
    className="port-input mono"
    aria-label={label}
    type="text"
    placeholder="unchanged"
    value={text}
    onMouseDown={(e) => e.stopPropagation()}
    onFocus={() => setFocused(true)}
    onChange={(e) => setText(e.target.value)}
    onBlur={() => { commit(); setFocused(false) }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
    }}
  />
}

export function NumberInput({
  value,
  placeholder,
  onChange,
  className = 'port-input mono'
}: {
  value: number | null | undefined
  placeholder?: string
  onChange(value: number | undefined): void
  className?: string
}) {
  const [text, setText] = useState(formatNumber(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatNumber(value))
  }, [value, focused])

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setText(formatNumber(value))
      }}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        if (next.trim() === '') onChange(undefined)
        else if (Number.isFinite(Number(next))) onChange(Number(next))
      }}
    />
  )
}

function parseList(text: string): number[] | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (parts.length === 0) return null
  const numbers = parts.map(Number)
  return numbers.every((n) => Number.isFinite(n)) ? numbers : null
}

/** Rows of numbers, written "1, 1; 0, 1": commas between values, semicolons between rows. */
function parseMatrix(text: string): number[][] | null {
  const rows = text
    .split(';')
    .map((row) => row.trim())
    .filter((row) => row !== '')
  if (rows.length === 0) return null
  const parsed = rows.map(parseList)
  if (parsed.some((row) => row === null)) return null
  const numbers = parsed as number[][]
  return numbers.every((row) => row.length === numbers[0]!.length) ? numbers : null
}

export function MatrixInput({
  value,
  placeholder,
  onChange
}: {
  value: number[][] | undefined
  placeholder?: string
  onChange(value: number[][] | undefined): void
}) {
  const committed = Array.isArray(value) ? value.map((row) => row.join(', ')).join('; ') : ''
  const [text, setText] = useState(committed)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(committed)
  }, [committed, focused])

  const commit = (): void => {
    if (text.trim() === '') onChange(undefined)
    else {
      const parsed = parseMatrix(text)
      if (parsed) onChange(parsed)
      else setText(committed)
    }
  }

  return (
    <input
      className={`port-input mono${text !== committed ? ' draft' : ''}`}
      type="text"
      value={text}
      placeholder={placeholder}
      title="Rows of numbers: commas between values, semicolons between rows, such as 1, 1; 0, 1"
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setText(committed)
      }}
    />
  )
}

/** Comma-separated numbers, such as an x_range. Committed on Enter or when the field is left. */
export function NumberListInput({
  value,
  placeholder,
  onChange
}: {
  value: number[] | undefined
  placeholder?: string
  onChange(value: number[] | undefined): void
}) {
  const committed = Array.isArray(value) ? value.join(', ') : ''
  const [text, setText] = useState(committed)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(committed)
  }, [committed, focused])

  const commit = (): void => {
    if (text.trim() === '') onChange(undefined)
    else {
      const parsed = parseList(text)
      if (parsed) onChange(parsed)
      else setText(committed)
    }
  }

  return (
    <input
      className={`port-input mono${text !== committed ? ' draft' : ''}`}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      title="Numbers separated by commas. Press Enter or leave the field to apply."
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setText(committed)
      }}
    />
  )
}
