/**
 * dsh-novel-writer — 伏笔 / 术语 / 灵感 存储（P2-F）。
 * 三个独立 JSON（项目目录），VersionedFile 外壳 + 原子写。
 */

import { join } from 'node:path'
import { atomicWriteFile, readOptional } from '../atomic-file.ts'
import { newId, nowIso } from '../util.ts'

const SCHEMA_VERSION = 1

// ─────────────────────────── 通用读写 ───────────────────────────

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  const text = await readOptional(filePath)
  if (text === undefined) return fallback
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: number; data?: T } | T
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in (parsed as object)) {
      return (parsed as { data: T }).data
    }
    return parsed as T
  } catch {
    return fallback
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, data }, null, 2)}\n`)
}

// ─────────────────────────── 伏笔 ───────────────────────────

export type ForeshadowStatus = 'open' | 'revealed' | 'dropped'

export interface Foreshadow {
  id: string
  /** 伏笔内容。 */
  content: string
  /** 埋设章节。 */
  plantChapter: number
  /** 计划回收章节（超期检测用）。 */
  plannedRevealChapter?: number
  /** 实际回收章节。 */
  revealChapter?: number
  status: ForeshadowStatus
  /** 关联条目/人物（可选）。 */
  related?: string
  createdAt: string
  updatedAt: string
}

export class ForeshadowStore {
  constructor(private readonly filePath: string) {}

  async all(): Promise<Foreshadow[]> {
    return await readJson<Foreshadow[]>(this.filePath, [])
  }

  async plant(params: { content: string; plantChapter: number; plannedRevealChapter?: number; related?: string }): Promise<Foreshadow> {
    const list = await this.all()
    const now = nowIso()
    const item: Foreshadow = {
      id: newId('fs'),
      content: params.content.trim(),
      plantChapter: params.plantChapter,
      ...(params.plannedRevealChapter !== undefined ? { plannedRevealChapter: params.plannedRevealChapter } : {}),
      status: 'open',
      ...(params.related !== undefined ? { related: params.related } : {}),
      createdAt: now,
      updatedAt: now,
    }
    if (!item.content) throw { code: 'INVALID_FIELD_TYPE', message: '伏笔内容不能为空' } as never
    list.push(item)
    await writeJson(this.filePath, list)
    return item
  }

  async reveal(id: string, chapterNo: number): Promise<Foreshadow> {
    const list = await this.all()
    const index = list.findIndex((item) => item.id === id)
    if (index === -1) throw { code: 'ENTRY_NOT_FOUND', message: `伏笔不存在: ${id}` } as never
    const next = { ...list[index]!, status: 'revealed' as const, revealChapter: chapterNo, updatedAt: nowIso() }
    list[index] = next
    await writeJson(this.filePath, list)
    return next
  }

  async drop(id: string): Promise<Foreshadow> {
    const list = await this.all()
    const index = list.findIndex((item) => item.id === id)
    if (index === -1) throw { code: 'ENTRY_NOT_FOUND', message: `伏笔不存在: ${id}` } as never
    const next = { ...list[index]!, status: 'dropped' as const, updatedAt: nowIso() }
    list[index] = next
    await writeJson(this.filePath, list)
    return next
  }

  /** 超期未回收：已过计划回收章节仍未回收（纯函数）。 */
  static overdue(list: readonly Foreshadow[], throughChapter: number): Foreshadow[] {
    return list.filter((item) => item.status === 'open'
      && item.plannedRevealChapter !== undefined
      && item.plannedRevealChapter < throughChapter)
  }
}

// ─────────────────────────── 术语表 ───────────────────────────

export interface GlossaryTerm {
  term: string
  definition: string
  category?: string
  createdAt: string
}

export class GlossaryStore {
  constructor(private readonly filePath: string) {}

  async all(): Promise<GlossaryTerm[]> {
    return await readJson<GlossaryTerm[]>(this.filePath, [])
  }

  async add(term: string, definition: string, category?: string): Promise<GlossaryTerm> {
    const list = await this.all()
    const normalized = term.trim()
    if (!normalized || !definition.trim()) throw { code: 'INVALID_FIELD_TYPE', message: '术语与释义不能为空' } as never
    if (list.some((item) => item.term === normalized)) throw { code: 'INVALID_STATE', message: `术语已存在: ${normalized}` } as never
    const item: GlossaryTerm = {
      term: normalized,
      definition: definition.trim(),
      ...(category !== undefined ? { category } : {}),
      createdAt: nowIso(),
    }
    list.push(item)
    await writeJson(this.filePath, list)
    return item
  }

  /** 从文本提取疑似术语（书名号/引号包裹词），供建议添加。 */
  static extractCandidates(text: string): string[] {
    const candidates = new Set<string>()
    for (const match of text.matchAll(/[《〈「『"]([^》〉」』"]{2,12})[》〉」』"]/g)) {
      if (match[1]) candidates.add(match[1])
    }
    return [...candidates].slice(0, 20)
  }
}

// ─────────────────────────── 灵感库 ───────────────────────────

export interface Idea {
  id: string
  content: string
  tags: string[]
  createdAt: string
}

export class IdeaStore {
  constructor(private readonly filePath: string) {}

  async all(): Promise<Idea[]> {
    return await readJson<Idea[]>(this.filePath, [])
  }

  async add(content: string, tags: string[] = []): Promise<Idea> {
    const list = await this.all()
    const item: Idea = { id: newId('idea'), content: content.trim(), tags, createdAt: nowIso() }
    if (!item.content) throw { code: 'INVALID_FIELD_TYPE', message: '灵感内容不能为空' } as never
    list.push(item)
    await writeJson(this.filePath, list)
    return item
  }

  /** 按标签/关键词检索（最新在前）。 */
  async search(query?: string): Promise<Idea[]> {
    const list = await this.all()
    const needle = query?.trim().toLowerCase()
    if (!needle) return [...list].reverse()
    return list.filter((item) =>
      item.content.toLowerCase().includes(needle)
      || item.tags.some((tag) => tag.toLowerCase().includes(needle)),
    ).reverse()
  }
}

// ─────────────────────────── 路径辅助 ───────────────────────────

export function foreshadowFilePath(bookDir: string): string {
  return join(bookDir, 'foreshadow.json')
}

export function glossaryFilePath(bookDir: string): string {
  return join(bookDir, 'glossary.json')
}

export function ideasFilePath(bookDir: string): string {
  return join(bookDir, 'ideas.json')
}
