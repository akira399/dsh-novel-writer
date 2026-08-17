/**
 * dsh-novel-writer — 原子文件写入工具（P1-B）。
 * 供 LoreStore 与 NovelStore 共用：tmp+rename 原子写 + 可选写前备份。
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { nowIso } from './util.ts'

export interface AtomicWriteOptions {
  /** 写前把现有文件备份为 `<name>.bak.<ts>`。 */
  backup?: boolean
  /** 备份保留份数（≤0 = 不清理；默认 5）。 */
  keepBackups?: number
}

/** 原子写（tmp + rename）；父目录自动创建。 */
export async function atomicWriteFile(path: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  if (options.backup) {
    const existing = await stat(path).catch(() => undefined)
    if (existing?.isFile()) {
      const backupPath = join(dirname(path), `${baseStem(path)}.bak.${nowIso().replace(/[:.]/g, '-')}`)
      await copyFile(path, backupPath)
      const keep = options.keepBackups ?? 5
      if (keep > 0) await pruneBackups(dirname(path), baseStem(path), keep)
    }
  }
  const temporary = `${path}.tmp.${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 追加写（审计日志等 append-only 场景；无备份）。 */
export async function appendLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(path, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** 读文件；不存在返回 undefined（不抛错）。 */
export async function readOptional(path: string): Promise<string | undefined> {
  return await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
}

function baseStem(path: string): string {
  const base = path.split(/[\\/]/).at(-1) ?? path
  return base.replace(/\.json$|\.md$|\.jsonl$/, '')
}

async function copyFile(source: string, destination: string): Promise<void> {
  const content = await readFile(source)
  await writeFile(destination, content, { mode: 0o600 })
}

/** 按字典序（=时间序）保留最近 keep 份备份。 */
async function pruneBackups(dir: string, stem: string, keep: number): Promise<void> {
  const entries = await readdirSafe(dir)
  const backups = entries.filter((name) => name.startsWith(`${stem}.bak.`)).sort()
  for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
    await rm(join(dir, name), { force: true }).catch(() => undefined)
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return await readdir(dir).catch(() => [] as string[])
}
