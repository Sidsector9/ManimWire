import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { Canvas } from './components/Canvas'
import { CodeView } from './components/CodeView'
import { Graph } from './components/Graph'
import { Inspector } from './components/Inspector'
import { Library } from './components/Library'
import { StatusBar } from './components/StatusBar'
import { Steps } from './components/Steps'
import { useEngineSync } from './engine/useEngineSync'
import { useFiles } from './engine/useFiles'
import { useCatalogueStore } from './store/catalogue'
import { useDocumentStore } from './store/document'
import { useEngineStore } from './store/engine'

export function App() {
  const setStatus = useEngineStore((s) => s.setStatus)
  const state = useEngineStore((s) => s.status.state)
  const loadCatalogue = useCatalogueStore((s) => s.load)
  const filePath = useDocumentStore((s) => s.filePath)
  const dirty = useDocumentStore((s) => s.dirty)
  const sceneName = useDocumentStore((s) => s.doc.scenes[s.sceneIndex]?.name ?? '')
  const [tab, setTab] = useState<'canvas' | 'code'>('canvas')
  const files = useFiles()
  useEngineSync()

  useEffect(() => {
    void window.engine.status().then(setStatus)
    return window.engine.onStatus(setStatus)
  }, [setStatus])

  useEffect(() => {
    if (state === 'ready') void loadCatalogue()
  }, [state, loadCatalogue])

  const projectName = filePath ? filePath.replace(/^.*[/\\]/, '').replace(/\.mnw$/, '') : 'untitled project'

  return (
    <div className="workspace">
      <header className="title">
        <span className="project">
          {projectName}
          {dirty && <span className="dirty" title="Unsaved changes" />}
        </span>
        <span className="mono" style={{ color: 'var(--text-secondary)' }}>
          {sceneName}
        </span>
        <span className="tabs">
          <button className={`tab${tab === 'canvas' ? ' active' : ''}`} onClick={() => setTab('canvas')}>
            Canvas
          </button>
          <button className={`tab${tab === 'code' ? ' active' : ''}`} onClick={() => setTab('code')}>
            Code
          </button>
        </span>
        <span className="spacer" />
        <button className="button" onClick={() => void files.exportVideo()} disabled={state !== 'ready'}>
          Export
        </button>
      </header>
      <Library />
      <div className="center">
        {tab === 'canvas' ? <Canvas /> : <CodeView />}
        <div className="divider" />
        <ReactFlowProvider>
          <Graph />
        </ReactFlowProvider>
      </div>
      <Inspector />
      <Steps />
      <StatusBar />
    </div>
  )
}
