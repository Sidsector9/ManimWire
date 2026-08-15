import { useMemo, useState } from 'react'
import { groupLibrary, TYPE_COLOR, useCatalogueStore } from '../store/catalogue'

export function Library() {
  const catalogue = useCatalogueStore((s) => s.catalogue)
  const error = useCatalogueStore((s) => s.error)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupLibrary(catalogue?.entries ?? [], query), [catalogue, query])
  const total = catalogue ? catalogue.entries.filter((e) => e.kind !== 'method' && !e.hidden).length : 0

  return (
    <section className="panel library">
      <div className="panel-head">
        <span>Library</span>
        <span className="mono" style={{ fontWeight: 400 }}>
          {catalogue ? `${total} entries` : ''}
        </span>
      </div>
      <div className="library-search">
        <input
          type="search"
          placeholder={catalogue ? `Search Manim CE ${catalogue.manim_version}` : 'Loading catalogue…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!catalogue}
        />
      </div>
      <div className="library-list">
        {error && <div className="library-error">{error}</div>}
        {groups.map((group) => {
          const isCollapsed = collapsed[group.label] ?? false
          return (
            <div key={group.label}>
              <button
                className="library-group"
                onClick={() => setCollapsed({ ...collapsed, [group.label]: !isCollapsed })}
              >
                <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
                <span>{group.label}</span>
                <span className="count">{group.entries.length}</span>
              </button>
              {!isCollapsed &&
                group.entries.map((entry) => (
                  <div key={entry.qualname} className="library-entry" title={entry.doc || entry.qualname}>
                    <span className="dot" style={{ background: TYPE_COLOR[entry.returns.type] }} />
                    <span className={entry.kind === 'function' ? 'mono' : ''}>{entry.name}</span>
                    <span className="hint">{entry.doc}</span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
