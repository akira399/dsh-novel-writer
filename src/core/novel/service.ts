/**
 * dsh-novel-writer — 小说创作组合服务（P1-F1）。
 *
 * 职责：把 workflow 引擎 + NovelStore + 字数统计 + 变量引擎 + 上下文组装
 * 组合为面向工具层/会话驱动的统一服务面。所有操作写审计日志。
 * 不包含会话驱动（P1-F2 ChapterWriter 单独实现）。
 */
import type { AuditEvent, PhaseId, PhaseLedger } from '../workflow/types.ts'
import { PHASE_ORDER, enter, forceApprove, reopen, rollback, skip, submit } from '../workflow/engine.ts'
import type { PhaseReport } from '../workflow/types.ts'
import type { Book, BookConfig, BookSummary, Chapter } from './types.ts'
import type { NovelStore } from './store.ts'
import { checkWordTarget, countChapter } from '../stats/wordcount.ts'
import type { VariableStoreFile } from '../variables/store.ts'
import type { ContextPacket } from '../context/types.ts'
import { ContextAssembler } from '../context/assembler.ts'
import type { LoreStore } from '../lorebook/store.ts'

export interface NovelServiceDeps {
  store: NovelStore
  loreStore: LoreStore
  variables: VariableStoreFile
  assembler?: ContextAssembler
}

export class NovelService {
  private readonly store: NovelStore
  private readonly variables: VariableStoreFile
  private readonly assembler: ContextAssembler

  constructor(deps: NovelServiceDeps) {
    this.store = deps.store
    this.variables = deps.variables
    this.assembler = deps.assembler ?? new ContextAssembler({ store: deps.store, loreStore: deps.loreStore, variables: deps.variables })
  }

  // ── 项目 ──

  async createProject(title: string, genre: string): Promise<Book> {
    return await this.store.createBook({ title, genre })
  }

  /** 读阶段产物（docs/<phase>.md）；无产物返回 undefined。 */
  async artifactOf(bookId: string, phase: PhaseId): Promise<string | undefined> {
    return await this.store.readArtifact(bookId, phase)
  }

  /**
   * 以「已完本项目」为模板克隆新项目（§3.5-11 模板复制）：
   *  复制 config（字数目标/风格视角/禁用词/AI味词）+ 已完成的阶段设定文档
   *  （选题/设定/人设/大纲/分卷/细纲）；**正文不复制**（chapters/）。状态机重置。
   */
  async cloneProject(sourceId: string, options: { title?: string; genre?: string } = {}): Promise<Book> {
    const source = await this.store.loadBook(sourceId)
    const title = String(options.title ?? '').trim() || `${source.title}（模板）`
    const genre = String(options.genre ?? '').trim() || source.genre
    const book = await this.store.createBook({ title, genre })
    // 保留源的字数目标/风格/禁用词/AI味词；title/genre 更新为新项目
    const config: BookConfig = { ...source.config, title, genre, phaseGating: true }
    await this.store.saveBook({ ...book, config })
    // 复制已完成阶段的设定文档（正文、完本、修订阶段不复制）
    for (const phase of PHASE_ORDER) {
      if (phase === 'writing' || phase === 'revision' || phase === 'done') continue
      const artifact = await this.store.readArtifact(sourceId, phase)
      if (artifact) await this.store.writeArtifact(book.id, phase, artifact)
    }
    return await this.store.loadBook(book.id)
  }

  listProjects(): Promise<BookSummary[]> {
    return this.store.listBooks()
  }

  /** 项目目录（向导状态等辅助文件落点）。 */
  projectDir(bookId: string): string {
    return this.store.getBookDir(bookId)
  }

  async load(bookId: string): Promise<Book> {
    return await this.store.loadBook(bookId)
  }

  // ── 流程 ──

  /** 合并 workflow 返回的 PhaseLedger 到完整 Book（防止 ledger 残缺对象覆写 book.json）。 */
  private mergeLedger(book: Book, ledger: PhaseLedger, now: string): Book {
    return {
      ...book,
      phases: ledger.phases,
      currentPhase: ledger.currentPhase,
      updatedAt: now,
    }
  }

  /** 进入阶段（门禁检查；审计 enter）。 */
  async enterPhase(bookId: string, phaseId: PhaseId, actor: AuditEvent['actor'] = 'agent'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const result = enter(book, phaseId, now, actor)
    if (!result.ok) throw result.error
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  /** 提交阶段产物：写 docs/<phase>.md + 版本快照 → 状态机 submit → 审计。 */
  async commitPhase(bookId: string, phaseId: PhaseId, artifact: string, report: PhaseReport, actor: AuditEvent['actor'] = 'agent'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const result = submit(book, phaseId, report, now, actor)
    if (!result.ok) throw result.error
    await this.store.writeArtifact(bookId, phaseId, artifact)
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  /** 用户覆盖：force（放行）/ reopen（驳回）/ skip（跳过）/ rollback（回退）。 */
  async overridePhase(bookId: string, phaseId: PhaseId, action: 'force' | 'reopen' | 'skip' | 'rollback', actor: AuditEvent['actor'] = 'user'): Promise<Book> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const result = action === 'force'
      ? forceApprove(book, phaseId, now, actor)
      : action === 'reopen'
        ? reopen(book, phaseId, now, actor)
        : action === 'skip'
          ? skip(book, phaseId, now, actor)
          : rollback(book, phaseId, now, actor)
    if (!result.ok) throw result.error
    await this.store.appendAudit(bookId, result.value.event)
    await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now))
    return await this.store.loadBook(bookId)
  }

  audit(bookId: string): Promise<AuditEvent[]> {
    return this.store.readAudit(bookId)
  }

  // ── 章节 ──

  /** 上下文包组装（写章指令数据源）。 */
  async assemble(bookId: string, chapterNo: number, chapterBrief?: string): Promise<ContextPacket> {
    const book = await this.store.loadBook(bookId)
    return await this.assembler.assemble({ book, chapterNo, chapterBrief })
  }

  /**
   * 保存章节正文：字数统计 → 落盘（frontmatter 带统计）→ Book.stats 增量 →
   * 变量 JSONPatch 提取应用 → 审计。返回落盘章节。
   */
  async saveChapter(bookId: string, chapterNo: number, title: string, text: string, brief?: string): Promise<Chapter> {
    const book = await this.store.loadBook(bookId)
    const now = new Date().toISOString()
    const raw = countChapter(text, chapterNo)
    const stats = checkWordTarget(raw, book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax)
    const previous = await this.store.readChapter(bookId, chapterNo)
    const previousWords = previous?.chapter.words ?? 0
    const chapter: Chapter = {
      no: chapterNo,
      title,
      status: 'draft',
      version: (previous?.chapter.version ?? 0) + 1,
      words: stats.totalChars,
      ...(brief !== undefined ? { brief } : {}),
      createdAt: previous?.chapter.createdAt ?? now,
      updatedAt: now,
    }
    await this.store.writeChapter(bookId, chapter, text)
    // Book.stats 增量（覆盖写入场景：减去旧字数再加新字数）
    const nextBook: Book = {
      ...book,
      stats: {
        totalWords: Math.max(0, book.stats.totalWords - previousWords + stats.totalChars),
        chapterCount: Math.max(book.stats.chapterCount, previous ? book.stats.chapterCount : book.stats.chapterCount + 1),
        lastWriteAt: now,
      },
      updatedAt: now,
    }
    await this.store.saveBook(nextBook)
    // 变量 JSONPatch 增量
    await this.variables.applyChapterPatch(bookId, chapterNo, text)
    // 账本增量（一致性引擎数据源；按项目目录）
    const { LedgerStore, ledgerFilePath } = await import('../consistency/store.ts')
    await new LedgerStore(ledgerFilePath(this.store.getBookDir(bookId))).applyChapterPatch(bookId, chapterNo, text)
    await this.store.appendAudit(bookId, {
      at: now,
      action: 'submit',
      phase: 'writing',
      actor: 'agent',
      detail: `chapter ${chapterNo} saved (${stats.totalChars} chars, ${stats.meetsTarget ? 'meets' : 'below'} target)`,
    })
    return chapter
  }

  /** 章节统计（含达标判定）。 */
  async chapterStats(bookId: string, chapterNo: number): Promise<{ words: number; meetsTarget: boolean } | undefined> {
    const book = await this.store.loadBook(bookId)
    const chapter = await this.store.readChapter(bookId, chapterNo)
    if (!chapter) return undefined
    const stats = checkWordTarget(countChapter(chapter.content, chapterNo), book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax)
    return { words: stats.totalChars, meetsTarget: stats.meetsTarget }
  }

  /** 章节正文（质量/校验工具用）。 */
  async chapterText(bookId: string, chapterNo: number): Promise<string> {
    return await this.store.readChapterContent(bookId, chapterNo)
  }

  /** 章节元数据 + 正文。 */
  async chapterWithText(bookId: string, chapterNo: number): Promise<{ chapter: Chapter; content: string } | undefined> {
    return await this.store.readChapter(bookId, chapterNo)
  }

  /** 全部章节（导出用，按序；稀疏编号也正确）。 */
  async allChapters(bookId: string): Promise<Array<{ chapter: Chapter; content: string }>> {
    const numbers = await this.store.listChapterNumbers(bookId)
    const items: Array<{ chapter: Chapter; content: string }> = []
    for (const no of numbers) {
      const chapter = await this.store.readChapter(bookId, no)
      if (chapter) items.push(chapter)
    }
    return items
  }

  /** 删除项目（keepChapters=true 保留正文目录）。 */
  async deleteProject(bookId: string, keepChapters: boolean): Promise<{ deleted: boolean; keptChapters: boolean }> {
    return await this.store.deleteProject(bookId, keepChapters)
  }

  /** 导出成稿（txt/markdown/platform），返回文件名与内容（GUI 直接下载）。 */
  async exportProject(bookId: string, format: 'txt' | 'markdown' | 'platform'): Promise<{ fileName: string; content: string }> {
    const { exportBook } = await import('../export/engine.ts')
    const book = await this.store.loadBook(bookId)
    const chapters = await this.allChapters(bookId)
    const content = exportBook(chapters, {
      format,
      title: book.title,
      author: book.config.author,
      splitVolumes: format === 'platform',
    })
    const ext = format === 'markdown' ? 'md' : 'txt'
    const fileName = `${book.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`
    return { fileName, content }
  }
}
