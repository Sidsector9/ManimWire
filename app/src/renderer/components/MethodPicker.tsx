import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Popover } from './editors'

/** Search the methods available on the connected Animate target. */
export function MethodPicker({ methods, onSelect }: { methods: string[]; onSelect(method: string): void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const anchor = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const normalize = (value: string): string => value.toLowerCase().replace(/[_\s]+/g, '')
  const options = methods.filter((method) => normalize(method).includes(normalize(query)))
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))
  const close = (): void => {
    setOpen(false)
    anchor.current?.focus()
  }
  const choose = (method: string): void => {
    onSelect(method)
    close()
  }
  useLayoutEffect(() => {
    if (open) list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open, query])

  return <span className="editor-anchor nodrag">
    <button ref={anchor} className="port-input color-trigger" aria-haspopup="listbox" aria-expanded={open}
      onClick={() => { setQuery(''); setActive(0); setOpen((current) => !current) }}>
      <span className="color-name">+ add a method call</span>
      <span aria-hidden="true">⌄</span>
    </button>
    <Popover open={open} anchor={anchor} onClose={() => setOpen(false)}>
      <div className="nodrag nowheel" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <input className="port-input" autoFocus role="combobox" aria-label="Search methods"
          aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={options.length ? `${listId}-${activeIndex}` : undefined}
          placeholder="Search methods…" value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (options.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const method = options[activeIndex]
              if (method) choose(method)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }} />
        <div ref={list} id={listId} className="color-options" role="listbox" aria-label="Methods">
          {options.map((method, index) => <div key={method} id={`${listId}-${index}`} role="option"
            aria-selected={index === activeIndex} className={`color-option mono${index === activeIndex ? ' active' : ''}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(method)}>
            {method}
          </div>)}
        </div>
        {!options.length && <div className="muted" role="status">No matching methods.</div>}
      </div>
    </Popover>
  </span>
}
