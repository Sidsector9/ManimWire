import { useEffect, useMemo, useRef, useState } from 'react'
import type { Descriptor, TypeRef } from '../../shared/engine'
import { acceptingPorts, type DescriptorIndex } from '../model/types'
import { groupLabel, TYPE_COLOR } from '../store/catalogue'
import { useDescriptorIndex, useEntries } from '../store/descriptors'

interface Props {
  at: { x: number; y: number }
  acceptType: TypeRef | null
  onChoose(descriptor: Descriptor): void
  onClose(): void
}

const LIMIT = 12
const RECENT_KEY = 'mnw.recent'
const RECENT_LIMIT = 8

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** Remember a chosen entry for the unfiltered popover's "Recent" section. */
export function rememberRecent(qualname: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([qualname, ...loadRecent().filter((q) => q !== qualname)].slice(0, RECENT_LIMIT)))
  } catch {
    // Storage can be unavailable; then there is no recent list.
  }
}

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
  const entries = useEntries()
  const index = useDescriptorIndex()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matching = useMemo(() => (acceptType === null ? entries.filter((e) => !e.hidden) : entries.filter((e) => !e.hidden && acceptingPorts(acceptType, e, index).length > 0)), [entries, acceptType, index])
  const results = useMemo(() => quickAddResults(entries, query, acceptType, index), [entries, query, acceptType, index])
  const recent = useMemo(() => {
    if (query.trim() || acceptType) return []
    const byName = new Map(entries.map((e) => [e.qualname, e]))
    return loadRecent().map((q) => byName.get(q)).filter((e): e is Descriptor => e !== undefined)
  }, [entries, query, acceptType])
  const shown = recent.length > 0 ? [...recent, ...results.filter((r) => !recent.includes(r))].slice(0, LIMIT) : results
  const matchCount = query.trim() ? matching.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()) || e.qualname.toLowerCase().includes(query.trim().toLowerCase())).length : matching.length
  const hint = acceptType ? `Only nodes that accept a ${acceptType.type.replace('_', ' ')}` : query.trim() ? `${matchCount} of ${matching.length} match` : `Type to search ${matching.length} nodes`
  const choose = (entry: Descriptor): void => {
    rememberRecent(entry.qualname)
    onChoose(entry)
  }

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
          if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, shown.length - 1))
          else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
          else if (e.key === 'Enter' && shown[cursor]) choose(shown[cursor])
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }}
        onBlur={onClose}
      />
      <div className="quick-add-section">
        <span>{acceptType ? `Accepts ${acceptType.type.replace('_', ' ')}` : recent.length > 0 && !query.trim() ? 'Recent' : 'Matches'}</span>
        <span className="mono">{hint}</span>
      </div>
      <div className="quick-add-list">
        {shown.map((entry, i) => (
          <div
            key={entry.qualname}
            className={`quick-add-row${i === cursor ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(entry)
            }}
          >
            <span className="dot" style={{ background: TYPE_COLOR[entry.returns.type] }} />
            <span className={entry.kind === 'class' ? 'name' : 'name mono'}>{entry.kind === 'method' ? entry.qualname : entry.name}</span>
            <span className="cat mono">{groupLabel(entry.category)}</span>
            <span className="desc">{entry.doc}</span>
          </div>
        ))}
        {shown.length === 0 && <div className="quick-add-row muted">No match</div>}
      </div>
      <div className="quick-add-hint mono">↑↓ move · ⏎ place · esc close</div>
    </div>
  )
}
