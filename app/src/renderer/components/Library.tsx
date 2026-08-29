import { useEffect, useMemo, useRef, useState } from 'react'
import { GROUP_PREFIX, nextPosition } from '../model/document'
import { groupLibrary, TYPE_COLOR, useCatalogueStore } from '../store/catalogue'
import { useDescriptorIndex, useEntries } from '../store/descriptors'
import { currentScene, useDocumentStore } from '../store/document'

export function Library({ onImportGroup }: { onImportGroup(): void }) {
  const catalogue = useCatalogueStore((s) => s.catalogue)
  const coverage = useCatalogueStore((s) => s.coverage)
  const error = useCatalogueStore((s) => s.error)
  const index = useDescriptorIndex()
  const entries = useEntries()
  const scene = useDocumentStore(currentScene)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const addCatalogueNode = useDocumentStore((s) => s.addCatalogueNode)
  const addGroup = useDocumentStore((s) => s.addGroup)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const groups = useMemo(() => groupLibrary(entries, query), [entries, query])
  const mobjects = entries.filter((e) => e.kind === 'class' && !e.hidden && e.returns.type === 'mobject').length
  const animations = entries.filter((e) => e.kind === 'class' && !e.hidden && e.returns.type === 'animation').length
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <section className="panel library">
      <div className="panel-head">
        <span>Library</span>
        <span className="library-head-key" title="Focus the search">⌘K</span>
      </div>
      <div className="library-search">
        <input
          ref={search}
          type="search"
          placeholder={catalogue ? `Search ${mobjects} mobjects, ${animations} animations` : 'Loading catalogue…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!catalogue}
        />
      </div>
      <div className="library-inline">
        {newGroup === null ? (
          <>
            <button className="button small" onClick={() => setNewGroup('')}>
              + new group
            </button>
            <button className="button small" onClick={onImportGroup}>
              import group…
            </button>
          </>
        ) : (
          <>
            <input
              className="port-input"
              autoFocus
              placeholder="group name"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^[A-Za-z_]\w*$/.test(newGroup)) {
                  addGroup(newGroup)
                  setNewGroup(null)
                } else if (e.key === 'Escape') setNewGroup(null)
              }}
            />
            <button className="button small" disabled={!/^[A-Za-z_]\w*$/.test(newGroup)} onClick={() => (addGroup(newGroup), setNewGroup(null))}>
              create
            </button>
          </>
        )}
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
                group.entries.map((entry) => {
                  // A group cannot contain itself.
                  const disabled = entry.kind === 'group' && entry.qualname === GROUP_PREFIX + editingGroup
                  return (
                    <div
                      key={entry.qualname}
                      className={`library-entry${disabled ? ' disabled' : ''}`}
                      title={entry.doc || entry.qualname}
                      onClick={() => !disabled && addCatalogueNode(entry, nextPosition(scene), index)}
                    >
                      <span className="dot" style={{ background: TYPE_COLOR[entry.returns.type] }} />
                      <span className={entry.kind === 'function' ? 'mono' : ''}>{entry.name}</span>
                      <span className="hint">{entry.doc}</span>
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
      {coverage && (
        <div className="library-foot" title="Parameters whose type the UI cannot present yet. This number must go down with every release.">
          {coverage.unpresentable} of {coverage.parameters} parameters not yet presentable
        </div>
      )}
    </section>
  )
}
