import { useEffect, useMemo, useRef, useState } from 'react'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { acceptingPorts, type DescriptorIndex } from '../model/types'
import { groupLabel, TYPE_COLOR, selectEntries, selectIndex, useCatalogueStore } from '../store/catalogue'

interface Props {
  at: { x: number; y: number }
  acceptType: TypeRef | null
  onChoose(descriptor: Descriptor): void
  onClose(): void
}

const LIMIT = 12

/** Entries a user can add, or only those with a port accepting `type`. Methods rank after classes and functions. */
export function quickAddResults(entries: Descriptor[], query: string, type: TypeRef | null, index: DescriptorIndex): Descriptor[] {
  const needle = query.trim().toLowerCase()
  return entries
    .filter((e) => !e.hidden)
    .filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.qualname.toLowerCase().includes(needle))
    .filter((e) => type === null || acceptingPorts(type, e, index).length > 0)
    .sort((a, b) => rank(a, needle) - rank(b, needle) || a.name.localeCompare(b.name))
    .slice(0, LIMIT)
}

function rank(entry: Descriptor, needle: string): number {
  const name = entry.name.toLowerCase()
  if (needle && name === needle) return 0
  if (needle && name.startsWith(needle)) return entry.kind === 'method' ? 2 : 1
  return entry.kind === 'class' ? 3 : entry.kind === 'function' ? 4 : 5
}

export function QuickAdd({ at, acceptType, onChoose, onClose }: Props) {
  const entries = useCatalogueStore(selectEntries)
  const index = useCatalogueStore(selectIndex)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => quickAddResults(entries, query, acceptType, index), [entries, query, acceptType, index])

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setCursor(0), [query])

  return (
    <div className="quick-add" style={{ left: at.x, top: at.y }} onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        value={query}
        placeholder={acceptType ? `Nodes that accept ${acceptType.type.replace('_', ' ')}` : 'Add a Manim node'}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1))
          else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
          else if (e.key === 'Enter' && results[cursor]) onChoose(results[cursor])
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }}
        onBlur={onClose}
      />
      <div className="quick-add-list">
        {results.map((entry, i) => (
          <div
            key={entry.qualname}
            className={`quick-add-row${i === cursor ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              onChoose(entry)
            }}
          >
            <span className="dot" style={{ background: TYPE_COLOR[entry.returns.type] }} />
            <span className={entry.kind === 'class' ? 'name' : 'name mono'}>{entry.kind === 'method' ? entry.qualname : entry.name}</span>
            <span className="cat">{groupLabel(entry.category)}</span>
            <span className="desc">{entry.doc}</span>
          </div>
        ))}
        {results.length === 0 && <div className="quick-add-row muted">No match</div>}
      </div>
      <div className="quick-add-hint">↑↓ move · ⏎ place · esc close</div>
    </div>
  )
}
