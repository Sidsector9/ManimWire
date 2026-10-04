import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { spawnPackagedEngine, systemTexPaths } from './engine'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('launches without a bundled TeX directory and preserves the system tool path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mnw packaged '))
  roots.push(root)
  const resources = path.join(root, 'resources')
  const runtime = path.join(resources, 'runtime')
  mkdirSync(path.join(runtime, 'engine'), { recursive: true })
  const exe = path.join(runtime, 'engine', process.platform === 'win32' ? 'manimwire-engine.exe' : 'manimwire-engine')
  writeFileSync(exe, '')
  vi.stubEnv('PYTHONPATH', '/development/python')
  vi.stubEnv('PYTHONHOME', '/development/home')
  vi.stubEnv('PATH', '/system-tex-tools')
  vi.mocked(spawn).mockReturnValue({ stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), on: vi.fn(), kill: vi.fn() } as unknown as ReturnType<typeof spawn>)
  spawnPackagedEngine(resources, path.join(root, 'user data'))
  expect(spawn).toHaveBeenCalledWith(exe, ['--stdio'], expect.objectContaining({
    cwd: path.join(root, 'user data', 'engine'), windowsHide: true,
    env: expect.objectContaining({
      FONTCONFIG_FILE: path.join(runtime, 'fonts.conf')
    })
  }))
  const options = vi.mocked(spawn).mock.calls[0]![2]!
  expect(options.env?.PYTHONPATH).toBeUndefined()
  expect(options.env?.PYTHONHOME).toBeUndefined()
  expect(options.env?.PATH?.split(path.delimiter).slice(0, 2)).toEqual([path.join(runtime, 'tools'), '/system-tex-tools'])
})

it('finds standard MacTeX and MiKTeX paths without hardcoding user names', () => {
  expect(systemTexPaths('darwin', {})).toEqual(['/Library/TeX/texbin'])
  expect(systemTexPaths('win32', { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local', ProgramFiles: 'C:\\Program Files' })).toEqual([
    'C:\\Users\\Example\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64',
    'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64'
  ])
  expect(systemTexPaths('win32', {})).toEqual([])
})

it('reports a missing runtime instead of falling back to system Python', () => {
  expect(() => spawnPackagedEngine('/missing-manimwire-resources', '/unused')).toThrow('Bundled engine is missing')
  expect(spawn).not.toHaveBeenCalled()
})
