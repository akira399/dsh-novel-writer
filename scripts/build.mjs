#!/usr/bin/env node
/**
 * dsh-novel-writer host build: compile src/ -> lib/ with the project-local tsc.
 *
 * 与 scripts/build.sh 等价，但用 Node 实现，因此 Windows / macOS / Linux 都无需 bash
 * （原 bash 脚本在 Windows 上会因缺少 bash 而失败）。scripts/build.sh 仍保留，供
 * dev_build_plugin 这类固定调用 `bash scripts/build.sh` 的宿主使用。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))

/**
 * 直接定位 tsc 的 JS 入口并用当前 node 执行。
 *
 * 不走 node_modules/.bin（POSIX 是脚本、Windows 是 .cmd）：既避免 Windows 上
 * 必须经 shell 执行 .cmd 的告警，也让三个平台共用同一条代码路径。
 */
function resolveTscEntry() {
  try {
    return require.resolve('typescript/bin/tsc')
  } catch {
    return null
  }
}

const tscEntry = resolveTscEntry()
if (tscEntry === null) {
  console.error("build: tsc not found; run 'npm install' first (node_modules/typescript)")
  process.exit(1)
}

console.log('=== Compiling src -> lib ===')
const result = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json'], {
  cwd: ROOT,
  stdio: 'inherit',
})

if (result.error) {
  console.error('build: failed to run tsc:', result.error.message)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

console.log('=== Build complete (lib/) ===')
