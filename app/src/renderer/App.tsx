import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { Canvas } from './components/Canvas'
import { CodeView } from './components/CodeView'
import { Graph } from './components/Graph'
import { Icon } from './components/Icon'
import { Inspector } from './components/Inspector'
import { Library } from './components/Library'
import { presetLabel, SettingsDialog } from './components/SettingsDialog'
import { Splitter } from './components/Splitter'
import { StatusBar } from './components/StatusBar'
import { Timeline } from './components/Timeline'
import { isTyping } from './model/keyboard'
import { usePlayback } from './engine/usePlayback'
import { useEngineSync } from './engine/useEngineSync'
import { useFiles } from './engine/useFiles'
import { useCatalogueStore } from './store/catalogue'
import { useDocumentStore } from './store/document'
import { useEngineStore } from './store/engine'
import { useUiStore } from './store/ui'

export function App() {
  const setStatus = useEngineStore((s) => s.setStatus)
  const state = useEngineStore((s) => s.status.state)
  const loadCatalogue = useCatalogueStore((s) => s.load)
  const filePath = useDocumentStore((s) => s.filePath)
  const dirty = useDocumentStore((s) => s.dirty)
  const sceneName = useDocumentStore((s) => s.doc.scenes[s.sceneIndex]?.name ?? '')
  const settings = useDocumentStore((s) => s.doc.settings)
  const editingGroup = useDocumentStore((s) => s.editingGroup)
  const editGroup = useDocumentStore((s) => s.editGroup)
  const removeGroup = useDocumentStore((s) => s.removeGroup)
  const layout = useUiStore((s) => s.layout)
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  const setLayout = useUiStore((s) => s.setLayout)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const nodeDensity = useUiStore((s) => s.nodeDensity)
  const splitRatio = useUiStore((s) => s.splitRatio)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const files = useFiles()
  useEngineSync()
  usePlayback()

  useEffect(() => {
    void window.engine.status().then(setStatus)
    return window.engine.onStatus(setStatus)
  }, [setStatus])

  useEffect(() => {
    if (state === 'ready') void loadCatalogue()
  }, [state, loadCatalogue])

  useEffect(() => {
    document.documentElement.dataset['density'] = nodeDensity
  }, [nodeDensity])

  // V and H pick the tool, as they do in Figma and Photoshop. Space pans while held,
  // whichever tool is active, which xyflow binds itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      // Select all belongs to the graph, which takes it while focused. Everywhere else
      // it would select the whole page, which is never what is wanted here.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'v') setTool('select')
      else if (key === 'h') setTool('hand')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTool])

  const projectName = filePath ? filePath.replace(/^.*[/\\]/, '').replace(/\.mnw$/, '') : 'untitled project'

  return (
    <div className="workspace">
      <header className="toolbar">
        <span className="project">
          {projectName}
          {dirty && <span className="dirty" title="Unsaved changes" />}
        </span>
        <span className="vdiv" />
        <button className="chip" title="Scene type and settings" onClick={() => setSettingsOpen(true)}>
          {sceneName}
          <span className="caret">▾</span>
        </button>
        <button className="chip mono" title="Quality preset" onClick={() => setSettingsOpen(true)}>
          {presetLabel(settings)}
        </button>
        {editingGroup && (
          <span className="breadcrumb mono">
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
          </span>
        )}
        <span className="spacer" />
        <span className="icon-group" role="group" aria-label="Tool">
          <button className={`icon${tool === 'hand' ? ' active' : ''}`} title="Hand: drag to move the view (H). Hold Space to pan with either tool." onClick={() => setTool('hand')}>
            <Icon name="hand" />
          </button>
          <button className={`icon${tool === 'select' ? ' active' : ''}`} title="Select: drag to draw a selection box (V)" onClick={() => setTool('select')}>
            <Icon name="pointer" />
          </button>
        </span>
        <span className="vdiv" />
        <span className="icon-group" role="group" aria-label="Layout">
          <button className={`icon${layout === 'stacked' ? ' active' : ''}`} title="Stacked: preview above the graph" onClick={() => setLayout('stacked')}>
            <Icon name="stacked" />
          </button>
          <button className={`icon${layout === 'side' ? ' active' : ''}`} title="Side by side: preview beside the graph" onClick={() => setLayout('side')}>
            <Icon name="side" />
          </button>
        </span>
        <span className="vdiv" />
        <span className="icon-group" role="group" aria-label="View">
          <button className={`icon${view === 'canvas' ? ' active' : ''}`} title="Canvas" onClick={() => setView('canvas')}>
            <Icon name="canvas" />
          </button>
          <button className={`icon${view === 'code' ? ' active' : ''}`} title="Code" onClick={() => setView('code')}>
            <Icon name="code" />
          </button>
        </span>
        <button className="icon" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Icon name="gear" />
        </button>
        <button className="icon export" title="Export video" onClick={() => void files.exportVideo()} disabled={state !== 'ready'}>
          <Icon name="download" />
        </button>
      </header>
      <Library onImportGroup={() => void files.importGroup()} />
      <div className={`center ${layout}`} style={{ '--split': splitRatio } as React.CSSProperties}>
        <div className="center-view">{view === 'canvas' ? <Canvas /> : <CodeView />}</div>
        <Splitter />
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
