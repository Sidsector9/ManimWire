import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import type { EngineInfo, EngineStatus } from '../shared/engine'

/** The part of a child process the supervisor depends on. */
export interface EngineProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable | null
  onExit(listener: (code: number | null) => void): void
  kill(): void
}

export type SpawnEngine = () => EngineProcess

export interface SupervisorOptions {
  spawn: SpawnEngine
  /** Delay before restart attempt n (1-based). */
  backoff?: (attempt: number) => number
  /** How long the engine may take to answer engine.info before it is restarted. */
  probeTimeoutMs?: number
  log?: (line: string) => void
}

const defaultBackoff = (attempt: number): number => Math.min(500 * 2 ** (attempt - 1), 5000)

/**
 * Keeps one engine process alive and exposes it as a JSON-RPC connection.
 * Restarts on exit with backoff and reports every state change.
 */
export class EngineSupervisor {
  private connection: MessageConnection | null = null
  private process: EngineProcess | null = null
  private status: EngineStatus = { state: 'stopped', attempt: 0 }
  private listeners = new Set<(status: EngineStatus) => void>()
  private stopped = true
  private attempt = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private readonly spawn: SpawnEngine
  private readonly backoff: (attempt: number) => number
  private readonly probeTimeoutMs: number
  private readonly log: (line: string) => void

  constructor(options: SupervisorOptions) {
    this.spawn = options.spawn
    this.backoff = options.backoff ?? defaultBackoff
    this.probeTimeoutMs = options.probeTimeoutMs ?? 30_000
    this.log = options.log ?? (() => {})
  }

  start(): void {
    this.stopped = false
    this.attempt = 0
    this.launch('starting')
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.teardown()
    this.setStatus({ state: 'stopped', attempt: this.attempt })
  }

  getStatus(): EngineStatus {
    return this.status
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.connection) throw new Error(`engine is ${this.status.state}`)
    return params === undefined
      ? this.connection.sendRequest(method)
      : this.connection.sendRequest(method, params)
  }

  private launch(state: 'starting' | 'restarting'): void {
    this.setStatus({ state, attempt: this.attempt })
    let child: EngineProcess
    try {
      child = this.spawn()
    } catch (error) {
      // A missing interpreter is a setup problem; retrying would not help.
      this.stopped = true
      this.setStatus({ state: 'stopped', attempt: this.attempt, message: String(error) })
      return
    }
    this.process = child
    child.stderr?.on('data', (chunk: Buffer) => this.log(chunk.toString()))
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    )
    connection.listen()
    this.connection = connection
    child.onExit((code) => {
      if (this.process !== child) return
      this.teardown()
      if (this.stopped) return
      this.scheduleRestart(`engine exited with code ${code ?? 'null'}`)
    })
    void this.probe(connection, child)
  }

  private async probe(connection: MessageConnection, child: EngineProcess): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${this.probeTimeoutMs} ms`)), this.probeTimeoutMs)
    })
    try {
      const info = (await Promise.race([connection.sendRequest('engine.info'), timeout])) as EngineInfo
      if (this.connection !== connection) return
      this.attempt = 0
      this.setStatus({ state: 'ready', attempt: 0, info })
    } catch (error) {
      if (this.connection !== connection) return
      this.log(`engine.info failed: ${String(error)}`)
      child.kill() // the exit listener schedules the restart
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private scheduleRestart(message: string): void {
    this.attempt += 1
    this.setStatus({ state: 'restarting', attempt: this.attempt, message })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopped) this.launch('restarting')
    }, this.backoff(this.attempt))
  }

  private teardown(): void {
    this.connection?.dispose()
    this.connection = null
    const child = this.process
    this.process = null
    child?.kill()
  }

  private setStatus(status: EngineStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}

/** Locate the Python interpreter that has the engine installed. */
export function resolvePython(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  const candidate =
    platform === 'win32'
      ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, '.venv', 'bin', 'python')
  if (!existsSync(candidate)) {
    throw new Error(`no Python environment at ${candidate}. Run "uv sync" in ${repoRoot}.`)
  }
  return candidate
}

export function spawnDevelopmentEngine(repoRoot: string): EngineProcess {
  const python = resolvePython(repoRoot)
  const child = nodeSpawn(python, ['-m', 'engine'], {
    cwd: path.join(repoRoot, 'engine'),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    onExit: (listener) => child.on('exit', listener),
    kill: () => child.kill()
  }
}
