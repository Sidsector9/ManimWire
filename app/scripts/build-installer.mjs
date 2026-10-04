import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.dirname(appDir)
const target = process.argv[2]
if (!['darwin', 'win32', 'linux'].includes(target) || process.platform !== target) {
  throw new Error('Build on the target OS: macOS, Windows, or Linux. Native runtime dependencies cannot be cross-compiled.')
}
if (!['arm64', 'x64'].includes(process.arch) || (target !== 'darwin' && process.arch !== 'x64')) {
  throw new Error('Supported builders: macOS arm64/x64, Windows x64, and Linux x64.')
}
function run(command, args, cwd = repo, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('uv', ['sync', '--frozen', '--group', 'packaging'])
run('uv', ['run', '--no-sync', 'python', 'packaging/build_runtime.py', process.arch])
run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], appDir)
const signingEnv = { ...process.env }
if (!signingEnv.CSC_LINK && !signingEnv.CSC_NAME && !signingEnv.CSC_IDENTITY_AUTO_DISCOVERY) signingEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
const platformFlag = { darwin: '--mac', win32: '--win', linux: '--linux' }[target]
run(process.execPath, ['node_modules/electron-builder/cli.js', platformFlag, `--${process.arch}`, '--publish', 'never'], appDir, signingEnv)
