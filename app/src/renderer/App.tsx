import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { Canvas } from './components/Canvas'
import { CodeView } from './components/CodeView'
import { Graph } from './components/Graph'
import { Inspector } from './components/Inspector'
import { Library } from './components/Library'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { Timeline } from './components/Timeline'
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
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const editGroup = useDocumentStore((s) => s.editGroup)
  const removeGroup = useDocumentStore((s) => s.removeGroup)
  const [tab, setTab] = useState<'canvas' | 'code'>('canvas')
  const [settingsOpen, setSettingsOpen] = useState(false)
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
        <span className="breadcrumb mono">
          <span>{sceneName}</span>
          {editingGroup && (
            <>
              <span>›</span>
              <span>group {editingGroup}</span>
              <button className="button small" onClick={() => editGroup(null)}>
                Done
              </button>
              <button className="button small" onClick={() => void files.exportGroup(editingGroup)}>
                Export group
              </button>
              <button className="button small danger" onClick={() => removeGroup(editingGroup)}>
                Delete group
              </button>
            </>
          )}
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
        <button className="button" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <button className="button" onClick={() => void files.exportVideo()} disabled={state !== 'ready'}>
          Export
        </button>
      </header>
      <Library onImportGroup={() => void files.importGroup()} />
      <div className="center">
        {tab === 'canvas' ? <Canvas /> : <CodeView />}
        <div className="divider" />
        <ReactFlowProvider>
          <Graph />
        </ReactFlowProvider>
      </div>
      <Inspector />
      <Timeline />
      <StatusBar />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
