/**
 * dsh-novel-writer — 账本与时间线存储（P2-D）。
 * ledger.json / timeline.json 位于项目目录（VersionedFile 外壳）。
 * 账本增量来自章节 <JSONPatch>（与变量引擎同源，方案 v3 融合设计）。
 */
import { join } from 'node:path'
import { atomicWriteFile, readOptional } from '../atomic-file.ts'
import { extractJsonPatchOperations } from '../variables/engine.ts'
import type { LedgerEntry, TimelineEvent } from './types.ts'

export const LEDGER_SCHEMA_VERSION = 1

export class LedgerStore {
  constructor(private readonly filePath: string) {}

  private async load(): Promise<LedgerEntry[]> {
    const text = await readOptional(this.filePath)
    if (text === undefined) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // 损坏 → 抛可报告错误（防止后续空数据覆盖损坏文件；写章/巡检会明确报错）
      throw { code: 'INVALID_FIELD_TYPE', message: `ledger.json 损坏（非法 JSON）: ${this.filePath}` } as never
    }
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
      return (parsed as { data: LedgerEntry[] }).data
    }
    throw { code: 'INVALID_FIELD_TYPE', message: `ledger.json 形状非法: ${this.filePath}` } as never
  }

  private async save(entries: LedgerEntry[]): Promise<void> {
    await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, data: entries }, null, 2)}\n`)
  }

  async all(): Promise<LedgerEntry[]> {
    return await this.load()
  }

  async byEntity(entity: string): Promise<LedgerEntry[]> {
    const entries = await this.load()
    return entries.filter((entry) => entry.entity === entity)
  }

  /**
   * 从章节正文提取 <JSONPatch> 并落账本（replace/insert 转为 LedgerEntry）。
   * 幂等语义：同 chapterNo 的旧条目**先清除再写入**——即使本章不再含 patch
   * （作者删除了 <JSONPatch>）也会清除该章旧条目，避免残留事实污染冲突检测。
   * 返回本次净新增条数。
   */
  async applyChapterPatch(bookId: string, chapterNo: number, chapterText: string): Promise<number> {
    const entries = await this.load()
    const withoutChapter = entries.filter((entry) => !(entry.source === `ch${chapterNo}`))
    const operations = extractJsonPatchOperations(chapterText)
    if (operations.length === 0) {
      // 清除旧条目（如有）也要落盘
      if (withoutChapter.length !== entries.length) await this.save(withoutChapter)
      return 0
    }
    const added: LedgerEntry[] = []
    for (const op of operations) {
      if (op.op !== 'replace' && op.op !== 'insert') continue
      const tokens = (op.path ?? '').split('/').filter(Boolean)
      // 形如 /stat_data/人物/境界 或 /stat_data/林远/修为
      const statRoot = tokens.findIndex((token) => token === 'stat_data')
      const rest = statRoot >= 0 ? tokens.slice(statRoot + 1) : tokens
      if (rest.length < 2) continue
      const [entity, ...fieldTokens] = rest
      // 数组追加路径（如 法宝/-）拍平为实体字段（避免每次覆盖同一 field）
      const field = fieldTokens.filter((token) => token !== '-').join('.') || 'value'
      const value = typeof op.value === 'object' ? JSON.stringify(op.value) : String(op.value ?? '')
      if (!entity) continue
      added.push({
        entity,
        field,
        value,
        chapterNo,
        confidence: 'high',
        source: `ch${chapterNo}`,
      })
    }
    await this.save([...withoutChapter, ...added])
    return added.length
  }

  /** 记录一条显式账本变更（工具/模型直接调用）。 */
  async record(entry: Omit<LedgerEntry, 'source'>, source: string): Promise<void> {
    const entries = await this.load()
    entries.push({ ...entry, source })
    await this.save(entries)
  }

  /** 清空（项目重置/测试）。 */
  async clear(): Promise<void> {
    await this.save([])
  }
}

export class TimelineStore {
  constructor(private readonly filePath: string) {}

  private async load(): Promise<TimelineEvent[]> {
    const text = await readOptional(this.filePath)
    if (text === undefined) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw { code: 'INVALID_FIELD_TYPE', message: `timeline.json 损坏（非法 JSON）: ${this.filePath}` } as never
    }
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
      return (parsed as { data: TimelineEvent[] }).data
    }
    throw { code: 'INVALID_FIELD_TYPE', message: `timeline.json 形状非法: ${this.filePath}` } as never
  }

  private async save(events: TimelineEvent[]): Promise<void> {
    await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, data: events }, null, 2)}\n`)
  }

  async all(): Promise<TimelineEvent[]> {
    return await this.load()
  }

  async record(event: Omit<TimelineEvent, 'createdAt'>): Promise<void> {
    const events = await this.load()
    events.push({ ...event, createdAt: new Date().toISOString() })
    await this.save(events)
  }
}

/** 项目目录内文件路径辅助。 */
export function ledgerFilePath(bookDir: string): string {
  return join(bookDir, 'ledger.json')
}

export function timelineFilePath(bookDir: string): string {
  return join(bookDir, 'timeline.json')
}
