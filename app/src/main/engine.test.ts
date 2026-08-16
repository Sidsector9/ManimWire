import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-jsonrpc/node'
import { EngineSupervisor, type EngineProcess } from './engine'
import type { EngineStatus } from '../shared/engine'

/** An in-memory engine that answers engine.info and can be made to exit. */
function fakeEngine(
  info: Record<string, unknown>,
  options: { silent?: boolean } = {}
): EngineProcess & { exit(code: number): void } {
  const toEngine = new PassThrough()
  const fromEngine = new PassThrough()
  const exitListeners: Array<(code: number | null) => void> = []
  const connection = createMessageConnection(
    new StreamMessageReader(toEngine),
    new StreamMessageWriter(fromEngine)
  )
  if (!options.silent) connection.onRequest('engine.info', () => info)
  connection.listen()
  const exit = (code: number | null): void => {
    connection.dispose()
    for (const listener of exitListeners) listener(code)
  }
  return {
    stdin: toEngine,
    stdout: fromEngine,
    stderr: null,
    onExit: (listener) => exitListeners.push(listener),
    kill: () => exit(null),
    exit
  }
}

function waitFor(
  supervisor: EngineSupervisor,
  predicate: (status: EngineStatus) => boolean
): Promise<EngineStatus> {
  return new Promise((resolve) => {
    if (predicate(supervisor.getStatus())) return resolve(supervisor.getStatus())
    const off = supervisor.onStatus((status) => {
      if (predicate(status)) {
        off()
        resolve(status)
      }
    })
  })
}

describe('EngineSupervisor', () => {
  const info = { python: '3.12.6', manim: '0.21.0', latex: false, dvisvgm: false }

  it('becomes ready with the engine info after start', async () => {
    const supervisor = new EngineSupervisor({ spawn: () => fakeEngine(info) })
    supervisor.start()
    const ready = await waitFor(supervisor, (s) => s.state === 'ready')
    expect(ready.info).toEqual(info)
    supervisor.stop()
    expect(supervisor.getStatus().state).toBe('stopped')
  })

  it('restarts after the process exits and becomes ready again', async () => {
    const engines: ReturnType<typeof fakeEngine>[] = []
    const supervisor = new EngineSupervisor({
      spawn: () => {
        const engine = fakeEngine(info)
        engines.push(engine)
        return engine
      },
      backoff: () => 1
    })
    supervisor.start()
    await waitFor(supervisor, (s) => s.state === 'ready')
    engines[0]!.exit(1)
    const restarting = await waitFor(supervisor, (s) => s.state === 'restarting')
    expect(restarting.attempt).toBe(1)
    expect(restarting.message).toContain('code 1')
    const ready = await waitFor(supervisor, (s) => s.state === 'ready')
    expect(ready.attempt).toBe(0)
    expect(engines).toHaveLength(2)
    supervisor.stop()
  })

  it('restarts an engine that never answers the probe', async () => {
    let spawned = 0
    const supervisor = new EngineSupervisor({
      spawn: () => fakeEngine(info, { silent: spawned++ === 0 }),
      backoff: () => 1,
      probeTimeoutMs: 20
    })
    supervisor.start()
    const restarting = await waitFor(supervisor, (s) => s.state === 'restarting')
    expect(restarting.attempt).toBe(1)
    const ready = await waitFor(supervisor, (s) => s.state === 'ready')
    expect(ready.info).toEqual(info)
    expect(spawned).toBe(2)
    supervisor.stop()
  })

  it('reports a spawn failure as stopped with the reason', () => {
    const supervisor = new EngineSupervisor({
      spawn: () => {
        throw new Error('no Python environment at /nowhere')
      }
    })
    supervisor.start()
    expect(supervisor.getStatus().state).toBe('stopped')
    expect(supervisor.getStatus().message).toContain('no Python environment')
  })

  it('rejects calls while not ready', async () => {
    const supervisor = new EngineSupervisor({ spawn: () => fakeEngine(info) })
    await expect(supervisor.call('ping')).rejects.toThrow('engine is stopped')
  })

  it('forwards calls to the engine', async () => {
    const supervisor = new EngineSupervisor({ spawn: () => fakeEngine(info) })
    supervisor.start()
    await waitFor(supervisor, (s) => s.state === 'ready')
    expect(await supervisor.call('engine.info')).toEqual(info)
    supervisor.stop()
  })
})
