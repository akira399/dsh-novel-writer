/**
 * dsh-novel-writer — 扩展工具（P2-G）：伏笔/灵感/术语/一致性巡检/时间线/修订/导出。
 * 伏笔/术语/灵感/账本/时间线按项目隔离（bookDirOf 定位，工具内构造 store）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult } from '../core/lorebook/service.ts'
import type { NovelService } from '../core/novel/service.ts'
import type { LlmClient } from '../core/llm/client.ts'
import {
  ForeshadowStore, GlossaryStore, IdeaStore,
  foreshadowFilePath, glossaryFilePath, ideasFilePath,
} from '../core/auxiliary/index.ts'
import { LedgerStore, TimelineStore, ledgerFilePath, timelineFilePath } from '../core/consistency/index.ts'
import { detectLedgerConflicts, detectTimelineAnomalies, normalizeBookTime, suggestSediment } from '../core/consistency/index.ts'
import { buildRevisionResult } from '../core/revision/index.ts'
import { exportBook } from '../core/export/index.ts'
import { jsonOutput } from './json.ts'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')

export interface ExtrasToolDeps {
  novel: NovelService
  llm: LlmClient | null
  bookDirOf(bookId: string): string
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerExtrasTools(ctx: Context, deps: ExtrasToolDeps): Array<() => void> {
  const { novel, llm, bookDirOf } = deps

  // 按项目构造的 store 便捷访问
  const storesOf = (projectId: string): {
    foreshadow: ForeshadowStore
    glossary: GlossaryStore
    ideas: IdeaStore
    ledger: LedgerStore
    timeline: TimelineStore
  } => {
    const dir = bookDirOf(projectId)
    return {
      foreshadow: new ForeshadowStore(foreshadowFilePath(dir)),
      glossary: new GlossaryStore(glossaryFilePath(dir)),
      ideas: new IdeaStore(ideasFilePath(dir)),
      ledger: new LedgerStore(ledgerFilePath(dir)),
      timeline: new TimelineStore(timelineFilePath(dir)),
    }
  }

  return [
    // ── 伏笔 ──
    ctx.tools.register(defineTool({
      name: 'novel_foreshadow',
      description: '伏笔管理：action=plant 登记（content/章节/计划回收章）；action=reveal 回收；action=list 列表（含超期未回收）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', required: true, description: 'plant | reveal | list' },
        content: { type: 'string', description: '伏笔内容（plant）' },
        plantChapter: { type: 'number', description: '埋设章节（plant）' },
        plannedRevealChapter: { type: 'number', description: '计划回收章节（plant）' },
        id: { type: 'string', description: '伏笔 id（reveal）' },
        chapterNo: { type: 'number', description: '回收章节（reveal）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; action: 'plant' | 'reveal' | 'list'; content?: string; plantChapter?: number; plannedRevealChapter?: number; id?: string; chapterNo?: number }
        return asJson(await asResult(async () => {
          const stores = storesOf(args.projectId)
          const all = await stores.foreshadow.all()
          const overdue = ForeshadowStore.overdue(all, (await novel.load(args.projectId)).stats.chapterCount)
          if (args.action === 'list') return { foreshadows: all, overdue }
          if (args.action === 'plant') {
            return { foreshadow: await stores.foreshadow.plant({ content: args.content ?? '', plantChapter: args.plantChapter ?? 0, plannedRevealChapter: args.plannedRevealChapter }) }
          }
          return { foreshadow: await stores.foreshadow.reveal(args.id ?? '', args.chapterNo ?? 0) }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 灵感 ──
    ctx.tools.register(defineTool({
      name: 'novel_idea',
      description: '灵感库：action=add 记录灵感；action=list 检索（query 关键词/标签）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', required: true, description: 'add | list' },
        content: { type: 'string', description: '灵感内容（add）' },
        tags: { type: 'string', description: '逗号分隔标签（add）' },
        query: { type: 'string', description: '检索关键词（list）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; action: 'add' | 'list'; content?: string; tags?: string; query?: string }
        return asJson(await asResult(async () => {
          const ideas = storesOf(args.projectId).ideas
          if (args.action === 'add') {
            return { idea: await ideas.add(args.content ?? '', (args.tags ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)) }
          }
          return { ideas: await ideas.search(args.query) }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 术语 ──
    ctx.tools.register(defineTool({
      name: 'novel_glossary',
      description: '术语表：action=list 列表；action=add 添加（唯一）；action=extract 从文本提取候选术语。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', required: true, description: 'list | add | extract' },
        term: { type: 'string', description: '术语（add）' },
        definition: { type: 'string', description: '释义（add）' },
        category: { type: 'string', description: '分类（add）' },
        text: { type: 'string', description: '提取源文本（extract）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; action: 'list' | 'add' | 'extract'; term?: string; definition?: string; category?: string; text?: string }
        return asJson(await asResult(async () => {
          const glossary = storesOf(args.projectId).glossary
          if (args.action === 'list') return { terms: await glossary.all() }
          if (args.action === 'add') return { term: await glossary.add(args.term ?? '', args.definition ?? '', args.category) }
          return { candidates: GlossaryStore.extractCandidates(args.text ?? '') }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 账本查询 ──
    ctx.tools.register(defineTool({
      name: 'novel_ledger',
      description: '查询事实账本（实体-字段-值，随章节自动落账）：entity 过滤某实体全部记录（如林远），省略=全书账本 + 冲突概要。触发：查账本/现在境界/修为/状态/实力。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        entity: { type: 'string', description: '实体名过滤（如：林远；省略=全部）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; entity?: string }
        return asJson(await asResult(async () => {
          const ledger = storesOf(args.projectId).ledger
          const entries = args.entity ? await ledger.byEntity(String(args.entity)) : await ledger.all()
          return {
            entity: args.entity,
            count: entries.length,
            entries: entries.slice(-200), // 只回显最近 200 条，避免超大响应
            conflicts: detectLedgerConflicts(entries),
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 市场调研（§3.5-4）：选题阶段引导 web_search + 结果落盘 reports/market.md ──
    ctx.tools.register(defineTool({
      name: 'novel_market_research',
      description: '市场调研辅助（选题阶段）：mode=prompt 按题材/方向返回 web_search 查询建议并初始化 reports/market.md；' +
        'model 用自身 web_search 检索后，以 mode=report 把调研结果落盘 reports/market.md，供 novel_commit(topic) 引用。消耗网络搜索，需确认后再执行。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        mode: { type: 'string', description: 'prompt（默认，出查询建议+初始化）| report（落盘调研结果）' },
        genre: { type: 'string', description: '拟调研题材（如：玄幻/仙侠/都市/悬疑）' },
        topic: { type: 'string', description: '选题方向（一句话，如：群像式宗门经营）' },
        report: { type: 'string', description: 'report 模式：模型检索后汇总的调研内容（榜单热词/读者偏好/同类卖点）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; mode?: string; genre?: string; topic?: string; report?: string }
        return asJson(await asResult(async () => {
          const dir = join(novel.projectDir(args.projectId), 'reports')
          if (args.mode === 'report') {
            if (!String(args.report ?? '').trim()) throw { code: 'INVALID_FIELD_TYPE', message: 'report 内容不能为空' } as never
            await mkdir(dir, { recursive: true })
            const content = `# 市场调研\n\n${String(args.report).trim()}\n`
            await writeFile(join(dir, 'market.md'), content, 'utf8')
            return {
              saved: 'reports/market.md', chars: content.length,
              hint: '可在 novel_commit(topic) 选题报告中引用以上热门题材/读者偏好/同类卖点要点。',
            }
          }
          const focus = [args.genre, args.topic].filter(Boolean).join(' / ') || '（待定题材）'
          const queries = [
            `${focus} 网络小说 热门题材 榜单 读者偏好`,
            `${focus} 网文 爆款 套路 爽点`,
            `${focus} 同类型 代表作 卖点 竞争 差异化`,
            `${focus} 起点/番茄 平台 热门 分类`,
          ]
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, 'market.md'), `# 市场调研\n\n（待调研）\n\n题材焦点：${focus}\n`, 'utf8')
          return {
            focus,
            todo: '请用你的 web_search 工具依次检索建议关键词，把「高频题材 / 读者偏好 / 同类作品卖点 / 潜在差异化」汇总成一段，再以 novel_market_research(mode=report, report=...) 落盘，最后结合到选题报告。',
            suggestedQueries: queries,
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 一致性巡检 ──
    ctx.tools.register(defineTool({
      name: 'novel_consistency_audit',
      description: '一致性巡检：账本覆盖冲突 + 时间线倒挂/缺失 + 伏笔超期 + 世界书沉淀建议（每 N 章建议跑一次）。',      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const projectId = (rawArgs as { projectId: string }).projectId
        return asJson(await asResult(async () => {
          const stores = storesOf(projectId)
          const book = await novel.load(projectId)
          const entries = await stores.ledger.all()
          const events = await stores.timeline.all()
          const foreshadows = await stores.foreshadow.all()
          return {
            auditedThroughChapter: book.stats.chapterCount,
            conflicts: detectLedgerConflicts(entries),
            timelineIssues: detectTimelineAnomalies(events),
            overdueForeshadows: ForeshadowStore.overdue(foreshadows, book.stats.chapterCount),
            sedimentSuggestions: suggestSediment(entries),
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 时间线 ──
    ctx.tools.register(defineTool({
      name: 'novel_timeline',
      description: '时间线：action=record 登记书内事件（bookTime 如「第三日」）；action=list 列表；action=check 检测倒挂。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', required: true, description: 'record | list | check' },
        chapterNo: { type: 'number', description: '章节号（record）' },
        bookTime: { type: 'string', description: '书内时间（record，如「第三日」）' },
        event: { type: 'string', description: '事件摘要（record）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; action: 'record' | 'list' | 'check'; chapterNo?: number; bookTime?: string; event?: string }
        return asJson(await asResult(async () => {
          const timeline = storesOf(args.projectId).timeline
          if (args.action === 'record') {
            const sortKey = normalizeBookTime(args.bookTime ?? '')
            await timeline.record({ chapterNo: args.chapterNo ?? 0, bookTime: args.bookTime ?? '', event: args.event ?? '', ...(sortKey !== null ? { sortKey } : { sortKey: null }) })
            return { ok: true }
          }
          const events = await timeline.all()
          if (args.action === 'check') return { events, issues: detectTimelineAnomalies(events) }
          return { events }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 修订 ──
    ctx.tools.register(defineTool({
      name: 'novel_revise',
      description: '修订章节：mode=proofread 校对（轻改）/ rhythm 节奏调整（重写）/ style 文风统一。产出 diff 统计，不覆盖原稿（版本 +1）。需要模型。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '章节号' },
        mode: { type: 'string', required: true, description: 'proofread | rhythm | style' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; mode: 'proofread' | 'rhythm' | 'style' }
        return asJson(await asResult(async () => {
          const chapter = await novel.chapterWithText(args.projectId, args.chapterNo)
          if (!chapter) return { ok: false, error: { code: 'ENTRY_NOT_FOUND', message: '章节不存在' } }
          if (!llm) return { ok: false, error: { code: 'INVALID_STATE', message: '模型未就绪' } }
          const promptId = args.mode === 'proofread' ? 'polish-proofread' : args.mode === 'rhythm' ? 'polish-rhythm' : 'polish-depolish'
          const { loadPromptLibrary, renderPromptTemplate } = await import('../core/prompts/index.ts')
          const library = await loadPromptLibrary(PROMPTS_DIR)
          const template = library.find((t) => t.id === promptId)
          if (!template) return { ok: false, error: { code: 'ENTRY_NOT_FOUND', message: `提示词缺失: ${promptId}` } }
          const revised = await llm.complete('你是网文编辑。', renderPromptTemplate(template, { text: chapter.content }), 6000)
          if (!revised.trim()) return { ok: false, error: { code: 'INVALID_STATE', message: '模型未返回修订结果，未写入（原稿保留）' } }
          const result = buildRevisionResult(args.mode, args.chapterNo, chapter.content, revised, new Date().toISOString())
          // 新版本写回（不覆盖语义：frontmatter version +1）
          await novel.saveChapter(args.projectId, args.chapterNo, chapter.chapter.title, revised, chapter.chapter.brief)
          return { result }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    // ── 导出 ──
    ctx.tools.register(defineTool({
      name: 'novel_export',
      description: '导出成稿：format=txt/markdown/platform，写文件到项目目录 exports/<title>.<ext>，返回路径。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        format: { type: 'string', required: true, description: 'txt | markdown | platform' },
        splitVolumes: { type: 'boolean', description: '平台格式按卷分隔（默认 false）' },
        authorNotes: { type: 'string', description: '每章后作者的话（可选）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; format: 'txt' | 'markdown' | 'platform'; splitVolumes?: boolean; authorNotes?: string }
        return asJson(await asResult(async () => {
          const book = await novel.load(args.projectId)
          const chapters = await novel.allChapters(args.projectId)
          const text = exportBook(chapters, {
            format: args.format,
            title: book.title,
            author: book.config.author,
            splitVolumes: args.splitVolumes === true,
            authorNotes: args.authorNotes,
          })
          const dir = join(novel.projectDir(args.projectId), 'exports')
          await mkdir(dir, { recursive: true })
          const ext = args.format === 'markdown' ? 'md' : 'txt'
          const file = join(dir, `${book.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`)
          await writeFile(file, text, 'utf8')
          return { file, chars: text.length, chapters: chapters.length }
        }))
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
