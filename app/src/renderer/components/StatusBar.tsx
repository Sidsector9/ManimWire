import { describeEngine, describeLatex, useEngineStore } from '../store/engine'

const dotColor: Record<string, string> = {
  ready: 'var(--type-vector)',
  starting: 'var(--type-number)',
  restarting: 'var(--type-animation)',
  stopped: 'var(--error)'
}

export function StatusBar() {
  const status = useEngineStore((s) => s.status)
  return (
    <footer className="status">
      <span>
        <span className="dot" style={{ background: dotColor[status.state] }} />
        {describeEngine(status)}
      </span>
      <span>{describeLatex(status)}</span>
      {status.message && <span style={{ color: 'var(--text-muted)' }}>{status.message}</span>}
    </footer>
  )
}
