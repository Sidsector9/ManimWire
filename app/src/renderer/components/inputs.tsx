import { useEffect, useState } from 'react'

// Number editors that keep their own draft text. A browser number input reports
// an empty value for a lone "-" or "1e", and committing every keystroke sends
// half-typed values (a one-element x_range) to Manim. These commit only complete
// values: a number as soon as it parses, a list when the field is left or Enter is pressed.

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
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
