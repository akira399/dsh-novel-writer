/**
 * dsh-novel-writer — 小说项目存储层（P1-B）。
 *
 * 目录布局（DEVELOPMENT-PLAN §6.1 对齐）：
 *   <baseDir>/<bookId>/
 *     book.json            # VersionedFile 外壳（schemaVersion + Book）
 *     audit.jsonl          # 审计事件（append-only，seq=行号）
 *     docs/<phase>.md      # 阶段产物（topic/setting/...）
 *     versions/<phase>/v<n>.md   # 产物版本快照（每次写 artifact +1）
 *     chapters/ch<no>.md   # 正文（首行 HTML 注释内嵌章节元数据 JSON）
 * 设计要点：原子写（atomic-file）、bookId 路径安全校验、章节 frontmatter
 * 容错解析（缺字段默认值、未知字段保留）、旧格式自动迁移。
 */
import { join } from 'node:path'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { appendLine, atomicWriteFile, readOptional } from '../atomic-file.ts'
import { newId, nowIso } from '../util.ts'
import { createLedger, PHASE_ORDER } from '../workflow/engine.ts'
import type { AuditEvent, PhaseId } from '../workflow/types.ts'
import type { Book, BookConfig, BookSummary, Chapter } from './types.ts'

/** 当前 book.json 格式版本。 */
export const BOOK_SCHEMA_VERSION = 1

/** bookId 校验：单段安全标识符（防路径穿越）。 */
export function assertBookId(id: string): string {
  const normalized = String(id ?? '').trim()
  if (!/^bk_[a-z0-9._-]+$/i.test(normalized) || normalized.includes('..')) {
    throw { code: 'INVALID_ENTRY_ID', message: `非法项目 ID: ${normalized}` } as never
  }
  return normalized
}

function defaultConfig(genre: string): BookConfig {
  return {
    title: '',
    genre,
    wordTargets: { perChapterMin: 2000, perChapterMax: 4000 },
    style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] },
    phaseGating: true,
  }
}

function toSummary(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    genre: book.genre,
    status: book.status,
    currentPhase: book.currentPhase,
    chapterCount: book.stats.chapterCount,
    totalWords: book.stats.totalWords,
    updatedAt: book.updatedAt,
  }
}

/** 章节元数据 frontmatter 编码/解析（HTML 注释内嵌 JSON，markdown 兼容）。 */
export function encodeChapterFrontmatter(chapter: Chapter): string {
  return `<!-- novel: ${JSON.stringify(chapter)} -->\n`
}

export function parseChapterFrontmatter(text: string): { chapter: Chapter; body: string } | null {
  const firstLineEnd = text.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  const match = /^<!--\s*novel:\s*(\{.*\})\s*-->$/.exec(firstLine.trim())
  if (!match) return null
  try {
    const raw = JSON.parse(match[1] ?? '{}') as Partial<Chapter>
    const chapter: Chapter = {
      no: typeof raw.no === 'number' ? raw.no : 0,
      title: typeof raw.title === 'string' ? raw.title : '',
      status: raw.status === 'approved' || raw.status === 'revised' ? raw.status : 'draft',
      version: typeof raw.version === 'number' ? raw.version : 1,
      words: typeof raw.words === 'number' ? raw.words : 0,
      ...(typeof raw.brief === 'string' ? { brief: raw.brief } : {}),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
    const body = firstLineEnd === -1 ? '' : text.slice(firstLineEnd + 1)
    return { chapter, body }
  } catch {
    return null
  }
}

export class NovelStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private bookDir(id: string): string {
    return join(this.baseDir, assertBookId(id))
  }

  /** 公共目录访问（供组装器/变量存储等模块定位项目内文件）。 */
  getBookDir(id: string): string {
    return this.bookDir(id)
  }

  private bookFile(id: string): string {
    return join(this.bookDir(id), 'book.json')
  }

  // ── 项目 ──

  async createBook(params: { title: string; genre: string }): Promise<Book> {
    const id = newId('bk')
    const now = nowIso()
    const genre = params.genre.trim() || 'fantasy'
    const config = defaultConfig(genre)
    config.title = params.title.trim()
    const ledger = createLedger(id, now)
    const book: Book = {
      id,
      title: params.title.trim(),
      genre,
      status: 'drafting',
      config,
      phases: ledger.phases,
      currentPhase: ledger.currentPhase,
      stats: { totalWords: 0, chapterCount: 0 },
      createdAt: now,
      updatedAt: now,
      schemaVersion: BOOK_SCHEMA_VERSION,
    }
    await mkdir(this.bookDir(id), { recursive: true, mode: 0o700 })
    await atomicWriteFile(this.bookFile(id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: book }, null, 2)}\n`)
    await appendLine(join(this.bookDir(id), 'audit.jsonl'), `${JSON.stringify({ seq: 1, at: now, action: 'create', phase: 'topic', actor: 'user', detail: 'project created' })}`)
    return book
  }

  /** 加载项目；旧格式（裸 Book 对象）自动包装迁移。损坏/非法 JSON 抛 PluginError（可报告）。 */
  async loadBook(id: string): Promise<Book> {
    const text = await readOptional(this.bookFile(id))
    if (text === undefined) throw { code: 'ENTRY_NOT_FOUND', message: `项目不存在: ${id}` } as never
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw { code: 'INVALID_FIELD_TYPE', message: `book.json 损坏（非法 JSON）: ${id}` } as never
    }
    const raw = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number'
      ? (parsed as { schemaVersion: number; data: Book }).data
      : (parsed as Book)
    if (!raw || typeof raw.id !== 'string' || !raw.phases || typeof raw.config !== 'object' || typeof raw.stats !== 'object') {
      throw { code: 'INVALID_FIELD_TYPE', message: `book.json 形状非法: ${id}` } as never
    }
    // 迁移：缺失阶段记录补全为 locked
    const phases = { ...raw.phases }
    for (const phaseId of PHASE_ORDER) {
      if (!phases[phaseId]) phases[phaseId] = { id: phaseId, state: 'locked', version: 0 }
    }
    return { ...raw, phases, schemaVersion: BOOK_SCHEMA_VERSION }
  }

  async saveBook(book: Book): Promise<void> {
    const saved: Book = { ...book, updatedAt: nowIso() }
    await atomicWriteFile(this.bookFile(book.id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: saved }, null, 2)}\n`)
  }

  async listBooks(): Promise<BookSummary[]> {
    const names = await readdir(this.baseDir).catch(() => [] as string[])
    const summaries: BookSummary[] = []
    for (const name of names) {
      if (!/^bk_[a-z0-9._-]+$/i.test(name)) continue
      try {
        summaries.push(toSummary(await this.loadBook(name)))
      } catch {
        // 损坏项目不隐藏健康项目（doctor/审计另行报告）
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * 删除项目。keepChapters=true 时保留 chapters/ 目录（正文文件不删，
   * 仅移除 book.json/docs/audit 等元数据——项目从列表消失，正文可手动取回）；
   * false 时删除整个项目目录。
   */
  async deleteProject(id: string, keepChapters: boolean): Promise<{ deleted: boolean; keptChapters: boolean }> {
    const dir = this.bookDir(id)
    const { rm } = await import('node:fs/promises')
    if (keepChapters) {
      // 保留 chapters/，删除其余元数据文件
      await rm(this.bookFile(id), { force: true })
      await rm(join(dir, 'docs'), { recursive: true, force: true })
      await rm(join(dir, 'versions'), { recursive: true, force: true })
      await rm(join(dir, 'summary'), { recursive: true, force: true })
      await rm(join(dir, 'exports'), { recursive: true, force: true })
      await rm(join(dir, 'audit.jsonl'), { force: true })
      await rm(join(dir, 'ledger.json'), { force: true })
      await rm(join(dir, 'timeline.json'), { force: true })
      await rm(join(dir, 'variables.json'), { force: true })
      await rm(join(dir, 'wizard.json'), { force: true })
      await rm(join(dir, 'foreshadow.json'), { force: true })
      await rm(join(dir, 'glossary.json'), { force: true })
      await rm(join(dir, 'ideas.json'), { force: true })
      return { deleted: true, keptChapters: true }
    }
    await rm(dir, { recursive: true, force: true })
    return { deleted: true, keptChapters: false }
  }

  // ── 审计 ──

  async appendAudit(bookId: string, event: Omit<AuditEvent, 'seq'>): Promise<AuditEvent> {
    const path = join(this.bookDir(bookId), 'audit.jsonl')
    const existing = await readOptional(path).then((text) => (text ? text.trim().split('\n').filter(Boolean).length : 0))
    const seq = existing + 1
    const full: AuditEvent = { ...event, seq }
    await appendLine(path, JSON.stringify(full))
    return full
  }

  async readAudit(bookId: string): Promise<AuditEvent[]> {
    const text = await readOptional(join(this.bookDir(bookId), 'audit.jsonl'))
    if (text === undefined) return []
    return text.trim().split('\n').filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as AuditEvent
      } catch {
        return null
      }
    }).filter((event): event is AuditEvent => event !== null)
  }

  // ── 阶段产物与版本快照 ──

  /** 写阶段产物：docs/<phase>.md + versions/<phase>/v<n>.md（n = 现有快照数+1）。 */
  async writeArtifact(bookId: string, phase: PhaseId, content: string): Promise<{ file: string; version: number }> {
    const dir = this.bookDir(bookId)
    await mkdir(join(dir, 'docs'), { recursive: true, mode: 0o700 })
    await mkdir(join(dir, 'versions', phase), { recursive: true, mode: 0o700 })
    const versionsDir = join(dir, 'versions', phase)
    const existing = await readdir(versionsDir).catch(() => [] as string[])
    // 快照号 = 现有最大 vN + 1（防历史快照被覆盖）
    let maxVersion = 0
    for (const name of existing) {
      const match = /^v(\d+)\.md$/.exec(name)
      if (match) maxVersion = Math.max(maxVersion, Number(match[1]))
    }
    const version = maxVersion + 1
    const file = join(dir, 'docs', `${phase}.md`)
    await atomicWriteFile(file, content)
    await atomicWriteFile(join(versionsDir, `v${version}.md`), content)
    return { file, version }
  }

  async readArtifact(bookId: string, phase: PhaseId): Promise<string | undefined> {
    return await readOptional(join(this.bookDir(bookId), 'docs', `${phase}.md`))
  }

  // ── 章节 ──

  async writeChapter(bookId: string, chapter: Chapter, content: string): Promise<Chapter> {
    // 章节号合法性：0/负数/NaN 会写出 ch0.md / ch-1.md / chNaN.md
    if (!Number.isInteger(chapter.no) || chapter.no < 1) {
      throw { code: 'INVALID_FIELD_TYPE', message: `非法章节号: ${chapter.no}` } as never
    }
    const path = join(this.bookDir(bookId), 'chapters', `ch${chapter.no}.md`)
    await mkdir(join(this.bookDir(bookId), 'chapters'), { recursive: true, mode: 0o700 })
    await atomicWriteFile(path, `${encodeChapterFrontmatter(chapter)}${content.trimEnd()}\n`)
    return chapter
  }

  async readChapter(bookId: string, no: number): Promise<{ chapter: Chapter; content: string } | undefined> {
    const text = await readOptional(join(this.bookDir(bookId), 'chapters', `ch${no}.md`))
    if (text === undefined) return undefined
    const parsed = parseChapterFrontmatter(text)
    if (parsed) return { chapter: parsed.chapter, content: parsed.body.trimEnd() }
    // 容错：无 frontmatter 的裸正文 → 构造默认章节元数据
    return {
      chapter: { no, title: `第 ${no} 章`, status: 'draft', version: 1, words: 0, createdAt: '', updatedAt: '' },
      content: text.trimEnd(),
    }
  }

  async readChapterContent(bookId: string, no: number): Promise<string> {
    const chapter = await this.readChapter(bookId, no)
    return chapter?.content ?? ''
  }

  /** 已存在的章节号（解析 chapters/ 下 ch<N>.md；稀疏编号也正确）。 */
  async listChapterNumbers(bookId: string): Promise<number[]> {
    const dir = join(this.bookDir(bookId), 'chapters')
    const names = await readdir(dir).catch(() => [] as string[])
    const numbers: number[] = []
    for (const name of names) {
      const match = /^ch(\d+)\.md$/.exec(name)
      if (match) numbers.push(Number(match[1]))
    }
    return numbers.sort((a, b) => a - b)
  }
}
