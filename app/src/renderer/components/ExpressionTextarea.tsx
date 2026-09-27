import { useId, useLayoutEffect, useRef, useState } from 'react'
import { selectExpressionNames, useCatalogueStore } from '../store/catalogue'

const LATEX_COMMANDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Omega',
  'frac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'lim', 'infty', 'partial', 'nabla',
  'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'left', 'right', 'cdot', 'times', 'div',
  'pm', 'mp', 'leq', 'geq', 'neq', 'approx', 'equiv', 'in', 'notin', 'subset', 'cup', 'cap',
  'to', 'rightarrow', 'Rightarrow', 'leftrightarrow', 'Leftrightarrow',
  'text', 'mathrm', 'mathbf', 'mathit', 'mathbb', 'mathcal', 'operatorname',
  'overline', 'underline', 'underbrace', 'overbrace', 'hat', 'vec', 'dot', 'ddot',
  'begin', 'end', 'quad', 'qquad', 'ldots', 'cdots'
].map((command) => `\\${command}`)

/** Mirror textarea wrapping and typography to locate its insertion caret. */
function caretPosition(input: HTMLTextAreaElement): { left: number; top: number; height: number } {
  const style = getComputedStyle(input)
  const mirror = document.createElement('div')
  for (const key of ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize'] as const) {
    mirror.style[key] = style[key]
  }
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    width: `${input.clientWidth}px`, top: '0', left: '0'
  })
  mirror.textContent = input.value.slice(0, input.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = input.value.slice(input.selectionStart) || '\u200b'
  mirror.append(marker)
  document.body.append(mirror)
  const origin = mirror.getBoundingClientRect()
  const point = marker.getClientRects()[0] ?? marker.getBoundingClientRect()
  const rect = input.getBoundingClientRect()
  const position = {
    left: rect.left + input.clientLeft + point.left - origin.left - input.scrollLeft,
    top: rect.top + input.clientTop + point.top - origin.top - input.scrollTop,
    height: parseFloat(style.lineHeight) || 20
  }
  mirror.remove()
  return position
}

export function ExpressionTextarea({ value, placeholder, onChange, language = 'python' }: {
  value: string; placeholder: string; onChange(value: string | undefined): void; language?: 'python' | 'latex' | 'text'
}) {
  const expressionNames = useCatalogueStore(selectExpressionNames)
  const names = language === 'latex' ? LATEX_COMMANDS : expressionNames
  const label = language === 'text' ? 'Text' : language === 'latex' ? 'LaTeX' : 'Expression'
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [token, setToken] = useState<{ start: number; end: number; prefix: string } | null>(null)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false })
  const matches = token ? names.filter((name) => language === 'latex'
    ? name.startsWith(token.prefix) : name.toLowerCase().startsWith(token.prefix.toLowerCase())) : []
  const suggest = (): void => {
    if (language === 'text') return
    const el = input.current!
    const caret = el.selectionStart
    const before = el.value.slice(0, caret)
    const prefix = language === 'latex'
      ? before.match(/(?:^|[^\\])(?:\\\\)*(\\[A-Za-z]*)$/)?.[1]
      : before.match(/[A-Za-z_][A-Za-z_0-9]*$/)?.[0]
    setToken(prefix && caret === el.selectionEnd ? {
      start: caret - prefix.length,
      end: caret + (el.value.slice(caret).match(language === 'latex' ? /^[A-Za-z]*/ : /^[A-Za-z_0-9]*/)?.[0].length ?? 0), prefix
    } : null)
    setActive(0)
  }
  useLayoutEffect(() => {
    if (!token || !matches.length) return
    const el = input.current!
    const update = (): void => {
      const caret = caretPosition(el)
      const rect = el.getBoundingClientRect()
      const popup = list.current?.getBoundingClientRect()
      const height = popup?.height ?? 160
      setPosition({
        left: Math.max(8, Math.min(caret.left, window.innerWidth - (popup?.width ?? 200) - 8)),
        top: caret.top + caret.height + height + 8 > window.innerHeight
          ? Math.max(8, caret.top - height - 4) : caret.top + caret.height + 4,
        visible: caret.top >= rect.top && caret.top < rect.bottom && caret.left >= rect.left && caret.left <= rect.right
      })
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [token, matches.length, value])
  useLayoutEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  const insert = (name: string): void => {
    if (!token) return
    const el = input.current!
    onChange(el.value.slice(0, token.start) + name + el.value.slice(token.end))
    const caret = token.start + name.length
    setToken(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }
  return <>
    <textarea ref={input} className="expression-textarea nodrag nowheel" aria-label={label}
      aria-autocomplete={language === 'text' ? undefined : 'list'} aria-controls={matches.length ? listId : undefined}
      aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
      rows={8} autoFocus spellCheck={false} value={value} placeholder={placeholder}
      onChange={(event) => { onChange(event.target.value || undefined); suggest() }}
      onClick={suggest}
      onBlur={() => setToken(null)}
      onKeyDown={(event) => {
        if (event.ctrlKey && event.code === 'Space') { event.preventDefault(); suggest(); return }
        if (matches.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(event.key)) {
          event.preventDefault()
          if (event.key === 'Escape') setToken(null)
          else if (event.key === 'Tab') { const name = matches[active] ?? matches[0]; if (name) insert(name) }
          else setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
        } else if (['Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) setToken(null)
      }}
    />
    {matches.length > 0 && <div ref={list} id={listId} role="listbox" aria-label={`${label} suggestions`}
      className="expression-completions" style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}>
      {matches.map((name, index) => <div key={name} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        className={index === active ? 'selected' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(name)}>{name}</div>)}
    </div>}
  </>
}
