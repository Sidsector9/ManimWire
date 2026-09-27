import { create } from 'zustand'

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'ready' | 'saving'
interface RecordingState {
  phase: Phase
  error: string | null
  savedPath: string | null
  elapsed: number
  since: number
}
export const useRecordingStore = create<RecordingState>(() => ({ phase: 'idle', error: null, savedPath: null, elapsed: 0, since: 0 }))
let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let writes: Promise<void> = Promise.resolve()
let writeError: unknown
const update = useRecordingStore.setState
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const release = (): void => {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  recorder = null
}

export function recordingSeconds(): number {
  const state = useRecordingStore.getState()
  return state.elapsed + (state.phase === 'recording' ? (performance.now() - state.since) / 1000 : 0)
}

export async function saveRecording(): Promise<void> {
  if (useRecordingStore.getState().phase !== 'ready') return
  update({ phase: 'saving', error: null })
  try {
    const savedPath = await window.developer.save()
    update(savedPath ? { phase: 'idle', savedPath } : { phase: 'ready' })
  } catch (error) {
    update({ phase: 'ready', error: message(error) })
  }
}

export async function discardRecording(): Promise<void> {
  if (useRecordingStore.getState().phase !== 'ready') return
  update({ phase: 'stopping' })
  try {
    await window.developer.discard()
    update({ phase: 'idle', error: null })
  } catch (error) {
    update({ phase: 'ready', error: message(error) })
  }
}

export function stopRecording(): void {
  if (!recorder || !['recording', 'paused'].includes(useRecordingStore.getState().phase)) return
  update({ elapsed: recordingSeconds(), phase: 'stopping' })
  if (recorder.state !== 'inactive') recorder.stop()
}

export function toggleRecordingPause(): void {
  if (recorder?.state === 'recording') {
    const elapsed = recordingSeconds()
    recorder.pause()
    update({ phase: 'paused', elapsed })
  } else if (recorder?.state === 'paused') {
    recorder.resume()
    update({ phase: 'recording', since: performance.now() })
  }
}

export async function startRecording(): Promise<void> {
  if (useRecordingStore.getState().phase !== 'idle') return
  update({ phase: 'starting', error: null, savedPath: null, elapsed: 0 })
  writes = Promise.resolve()
  writeError = undefined
  try {
    await window.developer.setEnabled(true)
    await window.developer.begin()
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: window.innerWidth, max: window.innerWidth }, height: { ideal: window.innerHeight, max: window.innerHeight } },
      audio: false
    })
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) throw new Error('This system does not support WebM recording.')
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      // Serialize conversion and writes: keep chunks in order and off the JS heap.
      writes = writes.then(async () => {
        if (!writeError) await window.developer.append(await event.data.arrayBuffer())
      }).catch((error: unknown) => {
        writeError = error
        stopRecording()
      })
    }
    recorder.onerror = (event) => {
      writeError = new Error(`Recording failed: ${event.type}`)
      stopRecording()
    }
    recorder.onstop = () => {
      update({ elapsed: recordingSeconds(), phase: 'stopping' })
      release()
      void (async () => {
        try {
          await writes
          if (writeError) throw writeError
          await window.developer.finish()
          update({ phase: 'ready' })
          await saveRecording()
        } catch (error) {
          await window.developer.discard().catch(() => undefined)
          update({ phase: 'idle', error: message(error) })
        }
      })()
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', stopRecording)
    recorder.start(1000)
    update({ phase: 'recording', since: performance.now() })
  } catch (error) {
    release()
    await window.developer.discard().catch(() => undefined)
    update({ phase: 'idle', error: message(error) })
  }
}
