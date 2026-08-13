import { useEffect } from 'react'
import { StatusBar } from './components/StatusBar'
import { useEngineStore } from './store/engine'

function Panel({ title, className }: { title: string; className: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <span>{title}</span>
      </div>
    </section>
  )
}

export function App() {
  const setStatus = useEngineStore((s) => s.setStatus)

  useEffect(() => {
    void window.engine.status().then(setStatus)
    return window.engine.onStatus(setStatus)
  }, [setStatus])

  return (
    <div className="workspace">
      <header className="title">
        <span className="project">untitled project</span>
        <span className="mono" style={{ color: 'var(--text-secondary)' }}>
          Scene
        </span>
      </header>
      <Panel title="Library" className="library" />
      <div className="center">
        <section className="panel canvas">
          <div className="frame" />
        </section>
        <div className="divider" />
        <Panel title="Graph" className="graph" />
      </div>
      <Panel title="Inspector" className="inspector" />
      <Panel title="Timeline" className="timeline" />
      <StatusBar />
    </div>
  )
}
