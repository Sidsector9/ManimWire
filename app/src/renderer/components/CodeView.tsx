import { useDocumentStore } from '../store/document'
import { useEngineResults } from '../store/preview'

/** Generated Manim Python. Selecting a node highlights its lines; clicking a line selects its node. */
export function CodeView() {
  const code = useEngineResults((s) => s.code)
  const sourceMap = useEngineResults((s) => s.sourceMap)
  const failure = useEngineResults((s) => s.failure)
  const selected = useDocumentStore((s) => s.selected)
  const select = useDocumentStore((s) => s.select)
  const highlighted = new Set(selected ? sourceMap.nodes[selected] ?? [] : [])
  const lines = code ? code.replace(/\n$/, '').split('\n') : []
  const nodeForLine = (line: number): string | null =>
    Object.entries(sourceMap.nodes).find(([, numbers]) => numbers.includes(line))?.[0] ?? null

  return (
    <section className="panel code">
      <div className="panel-head">
        <span>Generated Python</span>
        <span>
          <button className="button small" onClick={() => void navigator.clipboard.writeText(code)} disabled={!code}>
            Copy
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
              <span>{text}</span>
            </div>
          )
        })}
        {lines.length === 0 && <div className="code-line muted">Nothing generated yet</div>}
      </pre>
    </section>
  )
}
