import { describeEngine, describeLatex, useEngineStore } from '../store/engine'
import { useEngineResults } from '../store/preview'

const dotColor: Record<string, string> = {
  ready: 'var(--type-vector)',
  starting: 'var(--type-number)',
  restarting: 'var(--type-animation)',
  stopped: 'var(--error)'
}

export function StatusBar() {
  const status = useEngineStore((s) => s.status)
  const message = useEngineStore((s) => s.message)
  const frame = useEngineResults((s) => s.frame)
  const rendering = useEngineResults((s) => s.rendering)
  const latexMissing = status.info ? !(status.info.latex && status.info.dvisvgm) : false
  return (
    <footer className="status mono">
      <span>
        <span className="dot" style={{ background: dotColor[status.state] }} />
        {describeEngine(status)}
      </span>
      <span className={latexMissing ? 'warning' : ''}>{describeLatex(status)}</span>
      {status.message && <span style={{ color: 'var(--text-dim)' }}>{status.message}</span>}
      {message && <span className="status-message">{message}</span>}
      <span className="spacer" />
      <span style={{ color: 'var(--text-dim)' }}>
        {rendering ? 'rendering frame…' : frame && frame.render_ms ? `last render ${(frame.render_ms / 1000).toFixed(2)} s` : frame ? 'last render cached' : ''}
      </span>
    </footer>
  )
}
