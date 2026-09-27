import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/ui'
import { discardRecording, recordingSeconds, saveRecording, startRecording, stopRecording, toggleRecordingPause, useRecordingStore } from '../store/recording'

const SIZES = [
  ['16:9 · 1280 × 720', 1280, 720],
  ['16:9 · 1920 × 1080', 1920, 1080],
  ['16:9 · 2K / QHD · 2560 × 1440', 2560, 1440],
  ['16:9 · 4K / UHD · 3840 × 2160', 3840, 2160],
  ['4:3 · 1200 × 900', 1200, 900],
  ['1:1 · 1080 × 1080', 1080, 1080],
  ['9:16 · 720 × 1280', 720, 1280],
  ['9:16 · 1080 × 1920', 1080, 1920]
] as const

export function DeveloperSettings() {
  const enabled = useUiStore((s) => s.developerMode)
  const setEnabled = useUiStore((s) => s.setDeveloperMode)
  const phase = useRecordingStore((s) => s.phase)
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const toggle = async (value: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.developer.setEnabled(value)
      setEnabled(value)
      setError('')
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  const resize = async (): Promise<void> => {
    setBusy(true)
    try {
      setSize(await window.developer.resize(width, height))
      setError('')
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <>
    <div className="dialog-section">Developer tools</div>
    <label className="radio-row">
      <input type="checkbox" checked={enabled} disabled={phase !== 'idle' || busy} onChange={(e) => void toggle(e.target.checked)} />
      Developer mode
    </label>
    {phase !== 'idle' && <p className="muted">Stop and save or discard your recording before changing Developer mode.</p>}
    {enabled && <>
      <p className="muted">Record the app with cursor and click highlights. Silent WebM video; native menus and dialogs are outside the recording.</p>
      <div className="dialog-section">App window dimensions</div>
      <select className="port-select" aria-label="Window size preset" value={SIZES.findIndex(([, w, h]) => w === width && h === height)} onChange={(e) => {
        const preset = SIZES[Number(e.target.value)]
        if (preset) { setWidth(preset[1]); setHeight(preset[2]) }
      }}>
        <option value="-1">Custom dimensions</option>
        {SIZES.map(([label], i) => <option key={label} value={i}>{label}</option>)}
      </select>
      <div className="developer-size">
        <label>Width <input aria-label="Window width" type="number" min="320" max="7680" value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
        <span>×</span>
        <label>Height <input aria-label="Window height" type="number" min="320" max="7680" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
        <button className="button" disabled={busy || phase !== 'idle'} onClick={() => void resize()}>Apply size</button>
      </div>
      <p className="muted">Content area: {size.width} × {size.height}. Oversized presets fit your display while preserving the ratio. Title bar excluded.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </>
}

function PointerHighlights() {
  const pointer = useRef<HTMLDivElement>(null)
  const [clicks, setClicks] = useState<Array<{ id: number; x: number; y: number }>>([])
  useEffect(() => {
    let id = 0
    const move = (event: PointerEvent) => {
      if (pointer.current) {
        pointer.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
        pointer.current.style.display = 'block'
      }
    }
    const click = (event: PointerEvent) => {
      move(event)
      setClicks((current) => [...current.slice(-15), { id: ++id, x: event.clientX, y: event.clientY }])
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', click, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', click, true)
    }
  }, [])
  return <div className="recording-highlights" aria-hidden="true">
    <div ref={pointer} className="recording-pointer" />
    {clicks.map((click) => <div key={click.id} className="recording-click" style={{ left: click.x, top: click.y }} onAnimationEnd={() => setClicks((current) => current.filter((c) => c.id !== click.id))} />)}
  </div>
}

export function DeveloperTools() {
  const enabled = useUiStore((s) => s.developerMode)
  const { phase, error, savedPath } = useRecordingStore()
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    void window.developer.setEnabled(enabled).catch((error: unknown) => useRecordingStore.setState({ error: String(error) }))
  }, [enabled])
  useEffect(() => {
    const tick = () => setSeconds(recordingSeconds())
    const interval = window.setInterval(tick, 250)
    const prevent = (event: BeforeUnloadEvent) => {
      if (useRecordingStore.getState().phase !== 'idle') {
        useRecordingStore.setState({ error: 'Stop and save or discard your recording before closing or reloading.' })
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', prevent)
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', prevent) }
  }, [])
  if (!enabled) return null
  const active = phase === 'recording' || phase === 'paused'
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
  return <>
    <div className="developer-recording" role="group" aria-label="Screen recording">
      <span className={`recording-indicator ${phase}`} />
      {phase === 'idle' ? <button className="button small" onClick={() => void startRecording()}>Record app</button> : <span className="mono">{phase} · {time}</span>}
      {active && <>
        <button className="button small" onClick={toggleRecordingPause}>{phase === 'paused' ? 'Resume recording' : 'Pause recording'}</button>
        <button className="button small" onClick={stopRecording}>Stop recording</button>
      </>}
      {phase === 'ready' && <>
        <button className="button small" onClick={() => void saveRecording()}>Save recording</button>
        <button className="button small" onClick={() => void discardRecording()}>Discard recording</button>
      </>}
      {savedPath && phase === 'idle' && <button className="button small" onClick={() => void window.files.reveal(savedPath)}>Show recording</button>}
      {error && <span role="alert">{error}</span>}
    </div>
    {phase === 'recording' && <PointerHighlights />}
  </>
}
