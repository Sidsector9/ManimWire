import { useDocumentStore } from '../store/document'
import { useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'
import { Icon } from './Icon'

/** Generated Manim Python. Selecting a node highlights its lines; clicking a line selects its node. */
export function CodeView() {
  const code = useEngineResults((s) => s.code)
  const sourceMap = useEngineResults((s) => s.sourceMap)
  const failure = useEngineResults((s) => s.failure)
  const selected = useDocumentStore((s) => s.selected)
  const select = useDocumentStore((s) => s.select)
  const scene = useDocumentStore((s) => s.doc.scenes[s.sceneIndex])
  const setMessage = useEngineStore((s) => s.setMessage)
  const highlighted = new Set(selected ? sourceMap.nodes[selected] ?? [] : [])
  const lines = code ? code.replace(/\n$/, '').split('\n') : []
  const nodeForLine = (line: number): string | null =>
    Object.entries(sourceMap.nodes).find(([, numbers]) => numbers.includes(line))?.[0] ?? null
  const fileName = `${snake(scene?.name ?? 'scene')}.py`
  const selectedNode = scene?.nodes.find((n) => n.id === selected)
  const selectedLines = selected ? (sourceMap.nodes[selected] ?? []) : []

  const exportPython = async (): Promise<void> => {
    const saved = await window.files.saveText(fileName, 'py', code)
    if (saved) setMessage(`exported ${saved}`)
  }

  return (
    <section className="panel code">
      <div className="panel-head">
        <span className="mono code-title">
          {fileName} · read only · generated from {scene?.nodes.length ?? 0} nodes
        </span>
        <span className="code-actions">
          <button className="button small" onClick={() => void navigator.clipboard.writeText(code)} disabled={!code}>
            <Icon name="copy" size={11} /> Copy
          </button>
          <button className="button small" onClick={() => void exportPython()} disabled={!code}>
            <Icon name="download" size={11} /> Export .py
          </button>
        </span>
      </div>
      <pre className="code-lines mono">
        {lines.map((text, i) => {
          const number = i + 1
          const node = nodeForLine(number)
          return (
            <div
              key={number}
              className={`code-line${highlighted.has(number) ? ' highlight' : ''}${failure?.line === number ? ' error' : ''}${node ? ' linked' : ''}`}
              onClick={() => node && select(node)}
            >
              <span className="line-number">{number}</span>
              <span>{tokens(text)}</span>
            </div>
          )
        })}
        {lines.length === 0 && <div className="code-line muted">Nothing generated yet</div>}
      </pre>
      <div className="code-foot mono">
        <span>
          {selectedNode
            ? `${selectedNode.label ?? selectedNode.catalogue} · ${selectedLines.length === 1 ? `line ${selectedLines[0]}` : `lines ${selectedLines.join(' and ')}`}`
            : ''}
        </span>
        <span>select a line to select its node</span>
      </div>
    </section>
  )
}

function snake(name: string): string {
  return name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toLowerCase()
}

const TOKEN = /(\s+)|(#.*$)|(r?"(?:[^"\\]|\\.)*"|r?'(?:[^'\\]|\\.)*')|(\b(?:from|import|class|def|self|lambda|return|None|True|False|for|in|if|else|and|or|not)\b)|(\b[A-Z][A-Z_0-9]{2,}\b)|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|(\b[A-Z][A-Za-z0-9_]*\b)|([A-Za-z_][A-Za-z0-9_]*)|([^\s])/g

/** Syntax colours reuse the type palette (handoff section 9). */
function tokens(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let match: RegExpExecArray | null
  let key = 0
  while ((match = TOKEN.exec(line)) !== null) {
    const [text, space, comment, string, keyword, constant, number, className] = match
    const cls = space ? '' : comment ? 'tok-comment' : string ? 'tok-string' : keyword ? 'tok-keyword' : constant ? 'tok-constant' : number ? 'tok-number' : className ? 'tok-class' : match[8] ? 'tok-ident' : 'tok-punct'
    out.push(
      <span key={key++} className={cls}>
        {text}
      </span>
    )
  }
  return out
}
