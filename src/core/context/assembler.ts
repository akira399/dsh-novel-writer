/**
 * dsh-novel-writer — 上下文包组装器（P1-E）。
 *
 * 三层记忆组装（方案 §3.3 / v3 §3.6）：
 *  - L1 全书级：书名/类型/风格 + 全书大纲（压缩 ≤500 字）；
 *  - L2 卷章级：本卷细纲全文 + 当前章细纲 + 前 N 章全文；
 *  - L3 记忆级：更早章节摘要 + 书级变量 + lorebook 动态命中注入；
 * 预算恒定性：contextBudget 硬上限，裁剪顺序 L3 摘要 → prevChapters → L1 大纲。
 * 依赖注入（store/lore/variables），全部 IO 经依赖；可临时目录 fixture 单测。
 */
import { join } from 'node:path'
import type { InjectionPlan } from '../types.ts'
import { estimateTokens } from '../util.ts'
import { genreLabel } from '../genres.ts'
import type { LoreEntry, LoreGroup } from '../types.ts'
import type { Book } from '../novel/types.ts'
import type { NovelStore } from '../novel/store.ts'
import { buildInjectionPlan } from '../lorebook/injector.ts'
import type { VariableStoreFile } from '../variables/store.ts'
import type { ContextPacket, PrevChapterRef } from './types.ts'

export const DEFAULT_CONTEXT_BUDGET = 12000
export const DEFAULT_PREV_CHAPTERS = 3
const L1_BUDGET = 500
const SUMMARY_BUDGET = 200

export interface AssembleOptions {
  book: Book
  chapterNo: number
  /** 当前章细纲（外部传入优先）。 */
  chapterBrief?: string
  contextBudget?: number
  prevChaptersFull?: number
  /** lorebook 扫描历史（默认取前 N 章全文）。 */
  scanHistory?: string[]
  /** lorebook 注入预算（默认 contextBudget 的 1/3）。 */
  injectionBudget?: number
  charName?: string
  userName?: string
}

export interface AssemblerDeps {
  store: NovelStore
  loreStore: { readEntries(): Promise<LoreEntry[]>; readGroups(): Promise<LoreGroup[]>; readSettings(): Promise<Record<string, unknown>> }
  variables: VariableStoreFile
}

export class ContextAssembler {
  constructor(private readonly deps: AssemblerDeps) {}

  async assemble(options: AssembleOptions): Promise<ContextPacket> {
    const { book, chapterNo } = options
    const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET
    const prevCount = options.prevChaptersFull ?? DEFAULT_PREV_CHAPTERS
    const bookDir = this.deps.store.getBookDir(book.id)
    const truncatedInfo: string[] = []

    // ── L2 章/卷层 ──
    const briefArtifact = await this.deps.store.readArtifact(book.id, 'chapter')
    const currentBrief = (options.chapterBrief ?? '').trim() || briefArtifact || ''
    const volumeOutline = (await this.deps.store.readArtifact(book.id, 'volume')) ?? ''
    const outlineArtifact = (await this.deps.store.readArtifact(book.id, 'outline')) ?? ''

    // 前 N 章全文（最近优先，缺失跳过）
    const prevChapters: PrevChapterRef[] = []
    for (let no = chapterNo - 1; no >= Math.max(1, chapterNo - prevCount); no -= 1) {
      const chapter = await this.deps.store.readChapter(book.id, no)
      if (chapter) prevChapters.unshift({ no, title: chapter.chapter.title, text: chapter.content })
    }

    // ── L3 摘要层（更早章节；缺失降级为正文首 200 字）──
    const prevSummaries: Array<{ no: number; text: string }> = []
    const earliestFull = Math.max(1, chapterNo - prevCount)
    for (let no = earliestFull - 1; no >= 1; no -= 1) {
      const summaryFile = join(bookDir, 'summary', `summary-${no}.md`)
      const { readOptional } = await import('../atomic-file.ts')
      let text = (await readOptional(summaryFile)) ?? ''
      if (!text.trim()) {
        const chapter = await this.deps.store.readChapter(book.id, no)
        text = chapter ? chapter.content.slice(0, SUMMARY_BUDGET) : ''
      }
      if (text.trim()) prevSummaries.unshift({ no, text: text.trim().slice(0, SUMMARY_BUDGET) })
      if (prevSummaries.length >= 50) break
    }

    // ── L3 变量快照 ──
    const variableData = await this.deps.variables.load()
    const variableSnapshot = variableData.books[book.id]?.local_variables?.stat_data as Record<string, unknown> | undefined

    // ── L3 lorebook 注入 ──
    const entries = await this.deps.loreStore.readEntries()
    const groups = await this.deps.loreStore.readGroups()
    const settings = await this.deps.loreStore.readSettings()
    const scanHistory = options.scanHistory ?? prevChapters.map((c) => c.text)
    const loreInjection: InjectionPlan = buildInjectionPlan(entries, groups, {
      scope: 'lorebook',
      bookId: book.id,
      scanText: currentBrief,
      historyTexts: scanHistory,
      budget: options.injectionBudget ?? Math.floor(budget / 3),
      charName: options.charName,
      userName: options.userName,
      variableContext: {
        localVariables: variableData.books[book.id]?.local_variables ?? {},
        bookVariables: variableData.book_variables[book.id] ?? {},
        globalVariables: variableData.global_variables,
      },
    })

    // ── L1 全书级 ──
    const style = book.config.style
    let projectBrief = `《${book.title}》（${genreLabel(book.genre)}）\n风格：${style.pov === 'first' ? '第一人称' : '第三人称'}${style.forbiddenWords.length ? `；禁用词：${style.forbiddenWords.join('、')}` : ''}\n全书大纲：${outlineArtifact || '（待补）'}`
    if (estimateTokens(projectBrief) > L1_BUDGET) {
      projectBrief = projectBrief.slice(0, L1_BUDGET * 2)
      truncatedInfo.push('L1 全书大纲超预算，已截断')
    }

    // ── 预算裁剪（保 L2 全文 → 摘要 → 前章数）──
    let tokenEstimate = estimateTokens(
      projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries),
    )
    const maxL3 = budget - Math.floor(budget / 3)
    if (tokenEstimate > maxL3 && prevSummaries.length > 0) {
      const before = prevSummaries.length
      prevSummaries.length = Math.max(0, Math.floor(prevSummaries.length / 2))
      truncatedInfo.push(`L3 摘要超预算，从 ${before} 条裁剪到 ${prevSummaries.length} 条`)
      tokenEstimate = estimateTokens(
        projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries),
      )
    }
    if (tokenEstimate > budget && prevChapters.length > 1) {
      const before = prevChapters.length
      prevChapters.length = Math.max(1, Math.floor(prevChapters.length / 2))
      truncatedInfo.push(`L2 前章全文超预算，从 ${before} 章裁剪到 ${prevChapters.length} 章`)
      tokenEstimate = estimateTokens(
        projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries),
      )
    }

    // ── 硬约束 ──
    const constraints = [
      `本章目标字数 ${book.config.wordTargets.perChapterMin}-${book.config.wordTargets.perChapterMax}（总字符口径）`,
      `视角：${style.pov === 'first' ? '第一人称' : '第三人称'}`,
      ...(style.forbiddenWords.length > 0 ? [`禁用词：${style.forbiddenWords.join('、')}`] : []),
      '章末必须留有钩子（悬念/冲突/转折）',
      '未回收的伏笔不得提前揭露',
      '设定以世界书条目为准，不得自相矛盾',
    ]

    return {
      bookId: book.id,
      chapterNo,
      projectBrief,
      style,
      currentBrief,
      volumeOutline: volumeOutline || outlineArtifact,
      prevChapters,
      prevSummaries,
      ...(variableSnapshot !== undefined ? { variableSnapshot } : {}),
      loreInjection,
      constraints,
      tokenEstimate,
      truncatedInfo,
    }
  }
}
