/**
 * dsh-novel-writer — lorebook 存储层（模块 2）。
 *
 * 职责：世界书三类文件的「原子写 + schema 迁移 + 自动备份 + 严格错误」。
 * 设计要点（修复夏瑾 storage 层缺陷，见 OPERITFORGE-MIGRATION-PLAN v3 §1）：
 *  - 错误上抛带路径上下文（不静默 catch 返回 []）——修复 E1；
 *  - 版本化外壳 VersionedFile + 迁移链——修复 F9；
 *  - 原子写（tmp + rename）+ 写前自动备份（保留 N 份）——修复 E5；
 *  - 文件路径可配置（baseDir 注入）——修复 S5。
 * 本层只做文件 IO 与形状校验，不做业务规则（规则在 service 层，模块 3）。
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoreEntry, LoreGroup, LoreSettings, PluginError, VersionedFile } from '../types.ts'
import { nowIso } from '../util.ts'

/** 当前存储格式版本（首版：VersionedFile 外壳 + LoreEntry 形状）。 */
export const STORE_SCHEMA_VERSION = 1

/** 默认备份保留份数（构造时可覆盖）。 */
export const DEFAULT_BACKUP_KEEP = 5

function ioError(path: string, cause: unknown): PluginError {
  const message = cause instanceof Error ? cause.message : String(cause)
  return { code: 'IO_FAILURE', message: `lorebook store 读写失败（${path}）: ${message}`, details: { path } }
}

function invalidShape(path: string, reason: string): PluginError {
  return { code: 'INVALID_FIELD_TYPE', message: `lorebook store 数据形状非法（${path}）: ${reason}`, details: { path } }
}

/** 文件名校验：只允许单段安全文件名（防路径穿越）。导出供测试与扩展复用。 */
export function safeFileName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes('..')) {
    throw { code: 'INVALID_FIELD_TYPE', message: `非法存储文件名: ${name}` } as PluginError
  }
  return name
}

/** 迁移链：raw 数据 → 当前版本（按需逐级迁移）。当前仅 v1（旧格式自动包装）。 */
function migrateFile<T>(raw: unknown, path: string): VersionedFile<T> {
  // 旧格式（夏瑾裸数组/裸对象，无外壳）→ 包装为 v1
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { schemaVersion?: unknown }).schemaVersion === 'number') {
    const versioned = raw as VersionedFile<unknown>
    if (versioned.schemaVersion === STORE_SCHEMA_VERSION) return versioned as VersionedFile<T>
    throw invalidShape(path, `不支持的 schemaVersion=${versioned.schemaVersion}（当前 ${STORE_SCHEMA_VERSION}）`)
  }
  return { schemaVersion: STORE_SCHEMA_VERSION, data: raw as T }
}

/** 备份清理：按 mtime 升序保留最近 keep 份，删除更旧的。 */
async function pruneBackups(dir: string, stem: string, keep: number): Promise<void> {
  if (keep < 0) return
  const entries = await readdir(dir).catch(() => [] as string[])
  const backups = entries
    .filter((name) => name.startsWith(`${stem}.bak.`))
    .sort()
  const excess = backups.length - keep
  for (const name of backups.slice(0, excess)) {
    await rm(join(dir, name), { force: true }).catch(() => undefined)
  }
}

export class LoreStore {
  readonly baseDir: string
  private readonly keepBackups: number

  constructor(baseDir: string, options: { keepBackups?: number } = {}) {
    this.baseDir = baseDir
    this.keepBackups = options.keepBackups ?? DEFAULT_BACKUP_KEEP
  }

  /** 确保目录存在（幂等）。 */
  async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 })
  }

  private filePath(stem: string): string {
    return join(this.baseDir, safeFileName(`${stem}.json`))
  }

  /** 原子写 + 写前备份。 */
  private async writeJsonAtomic(stem: string, content: string): Promise<void> {
    await this.ensureDir()
    const path = this.filePath(stem)
    try {
      // 写前备份现有文件
      const existing = await stat(path).catch(() => undefined)
      if (existing?.isFile()) {
        const backupPath = join(this.baseDir, `${safeFileName(stem)}.bak.${nowIso().replace(/[:.]/g, '-')}`)
        await copyFile(path, backupPath)
      }
      const temporary = join(this.baseDir, `${safeFileName(stem)}.tmp.${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
      await pruneBackups(this.baseDir, stem, this.keepBackups)
    } catch (error) {
      if ((error as PluginError)?.code) throw error
      throw ioError(path, error)
    }
  }

  /** 读 JSON：不存在 → 默认值；形状非法/损坏 → 抛错（不静默）。 */
  private async readJson<T>(stem: string, fallback: T, validate: (data: unknown, path: string) => T): Promise<T> {
    await this.ensureDir()
    const path = this.filePath(stem)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw ioError(path, error)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw invalidShape(path, `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    const versioned = migrateFile<T>(parsed, path)
    return validate(versioned.data, path)
  }

  // ── 条目 ──

  async readEntries(): Promise<LoreEntry[]> {
    return this.readJson<LoreEntry[]>('entries', [], (data, path) => {
      if (!Array.isArray(data)) throw invalidShape(path, 'entries 必须是数组')
      // 逐元素形状校验：坏条目（缺 id/非对象）在下游排序/匹配会崩溃，此处直接暴露
      for (const [index, item] of data.entries()) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          throw invalidShape(path, `entries[${index}] 必须是对象`)
        }
        const record = item as Record<string, unknown>
        if (typeof record.id !== 'string' || !record.id) {
          throw invalidShape(path, `entries[${index}].id 缺失或非字符串`)
        }
        if (typeof record.name !== 'string') {
          throw invalidShape(path, `entries[${index}].name 缺失或非字符串`)
        }
        if (record.priority !== undefined && (typeof record.priority !== 'number' || !Number.isFinite(record.priority))) {
          throw invalidShape(path, `entries[${index}].priority 非有限数字`)
        }
      }
      return data
    })
  }

  async writeEntries(entries: LoreEntry[]): Promise<void> {
    await this.writeVersioned('entries', entries)
  }

  // ── 分组 ──

  async readGroups(): Promise<LoreGroup[]> {
    return this.readJson<LoreGroup[]>('groups', [], (data, path) => {
      if (!Array.isArray(data)) throw invalidShape(path, 'groups 必须是数组')
      for (const [index, item] of data.entries()) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          throw invalidShape(path, `groups[${index}] 必须是对象`)
        }
        const record = item as Record<string, unknown>
        if (typeof record.id !== 'string' || !record.id) {
          throw invalidShape(path, `groups[${index}].id 缺失或非字符串`)
        }
        if (record.entry_ids !== undefined && !Array.isArray(record.entry_ids)) {
          throw invalidShape(path, `groups[${index}].entry_ids 必须是数组`)
        }
      }
      return data
    })
  }

  async writeGroups(groups: LoreGroup[]): Promise<void> {
    await this.writeVersioned('groups', groups)
  }

  // ── 设置 ──

  async readSettings(): Promise<LoreSettings> {
    return this.readJson<LoreSettings>('settings', {}, (data, path) => {
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw invalidShape(path, 'settings 必须是对象')
      return data as LoreSettings
    })
  }

  async writeSettings(settings: LoreSettings): Promise<void> {
    await this.writeVersioned('settings', settings)
  }

  /** 统一写出：VersionedFile 外壳（读写格式对称，旧裸数据仅由读路径迁移）。 */
  private async writeVersioned<T>(stem: string, data: T): Promise<void> {
    const versioned: VersionedFile<T> = { schemaVersion: STORE_SCHEMA_VERSION, data }
    await this.writeJsonAtomic(stem, `${JSON.stringify(versioned, null, 2)}\n`)
  }
}

/** 小文件复制（备份用；避免为此引入 stream 样板）。 */
async function copyFile(source: string, destination: string): Promise<void> {
  const content = await readFile(source)
  await writeFile(destination, content, { mode: 0o600 })
}
