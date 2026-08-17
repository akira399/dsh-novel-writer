/**
 * dsh-novel-writer — 质量工具（P2-G）：去 AI 味 / 文风转换 / 黄金三章诊断 / 建议执行 / 章节校验。
 * LLM 不可用时自动降级（规则层/检测层结果 + degraded 标记）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult } from '../core/lorebook/service.ts'
import type { NovelService } from '../core/novel/service.ts'
import type { LlmClient } from '../core/llm/client.ts'
import { scanAiTaste, BUILTIN_AI_TASTE_WORDS } from '../core/polish/index.ts'
import { diagnoseFirstChapters } from '../core/diagnose/index.ts'
import { BUILTIN_RULES, validateChapter } from '../core/validation/index.ts'
import { LedgerStore, ledgerFilePath } from '../core/consistency/index.ts'
import { loadPromptLibrary, renderPromptTemplate } from '../core/prompts/index.ts'
import { jsonOutput } from './json.ts'

export interface QualityToolDeps {
  novel: NovelService
  llm: LlmClient | null
  promptsDir: string
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** 从内置库渲染模板（缺失模板返回 null）。 */
async function renderPrompt(promptsDir: string, id: string, vars: Record<string, string>): Promise<string | null> {
  const library = await loadPromptLibrary(promptsDir)
  const template = library.find((t) => t.id === id)
  return template ? renderPromptTemplate(template, vars) : null
}

/** 模型不可用降级包装。 */
function degraded<T>(value: T, reason: string): { ok: true; value: T & { degraded: boolean; degradedReason: string } } {
  return { ok: true, value: { ...value, degraded: true, degradedReason: reason } }
}

export function registerQualityTools(ctx: Context, deps: QualityToolDeps): Array<() => void> {
  const { novel, llm, promptsDir } = deps
  return [
    ctx.tools.register(defineTool({
      name: 'novel_depolish',
      description: 'AI 味检测与去除：不传 text 时返回检测报告（密度/类别/命中句）；传 text+mode=rewrite 时按内置提示词调用模型改写去味。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', description: '章节号（检测范围；省略=从文本参数检测）' },
        text: { type: 'string', description: '待检测/改写文本（省略时读章节）' },
        mode: { type: 'string', description: 'detect（默认，仅报告）| rewrite（模型改写）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo?: number; text?: string; mode?: string }
        return asJson(await asResult(async () => {
          const text = args.text ?? (args.chapterNo ? await novel.chapterText(args.projectId, args.chapterNo) : '')
          const report = scanAiTaste(text)
          if (args.mode !== 'rewrite') return { report }
          if (!llm) return degraded({ report }, '模型未就绪，仅返回检测报告')
          const prompt = await renderPrompt(promptsDir, 'polish-depolish', { text })
          if (!prompt) return degraded({ report }, '内置提示词缺失')
          const revised = await llm.complete('你是网文编辑，负责去除 AI 腔。', prompt, 4000)
          return { report, revised }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_style_convert',
      description: '按文风预设改写章节（style-xuanhuan 等内置模板），文风统一化。需要模型。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '章节号' },
        styleId: { type: 'string', description: '文风模板 id（默认 style-xuanhuan）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; styleId?: string }
        return asJson(await asResult(async () => {
          const text = await novel.chapterText(args.projectId, args.chapterNo)
          if (!llm) return degraded({ text }, '模型未就绪，未改写')
          const styleId = args.styleId ?? 'style-xuanhuan'
          const style = await renderPrompt(promptsDir, styleId, {})
          const base = await renderPrompt(promptsDir, 'writing-chapter-xuanhuan', { title: '', chapterNo: String(args.chapterNo), brief: '' })
          const system = `你是网文作者。\n${style ?? ''}\n${base ?? ''}`
          const revised = await llm.complete(system, `请按上述文风要求改写以下章节，保持情节不变：\n\n${text}`, 6000)
          return { revised }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_diagnose',
      description: '黄金三章/章节结构诊断：规则层必出分；模型就绪时叠加模型层深度诊断（按内置诊断提示词）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterStart: { type: 'number', required: true, description: '起始章节号' },
        count: { type: 'number', description: '诊断章节数（默认 3）' },
        withModel: { type: 'boolean', description: '是否叠加模型层（默认 true）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterStart: number; count?: number; withModel?: boolean }
        return asJson(await asResult(async () => {
          const book = await novel.load(args.projectId)
          const count = Math.max(1, Math.min(5, args.count ?? 3))
          const chapters = []
          for (let no = args.chapterStart; no < args.chapterStart + count; no += 1) {
            const chapter = await novel.chapterWithText(args.projectId, no)
            if (chapter) chapters.push({ no, title: chapter.chapter.title, text: chapter.content })
          }
          if (chapters.length === 0) return degraded({ score: 0, dimensions: {}, issues: [] }, '没有可诊断的章节')
          const rules = diagnoseFirstChapters(chapters, { wordTargets: book.config.wordTargets })
          if (!llm || args.withModel === false) return { rules }
          const prompt = await renderPrompt(promptsDir, 'diagnose-golden3', { chapters: chapters.map((c) => `【第${c.no}章 ${c.title}】\n${c.text.slice(0, 3000)}`).join('\n\n') })
          if (!prompt) return { rules }
          const raw = await llm.complete('你是网文主编，按指定 JSON 结构输出诊断。', prompt, 3000)
          let model
          try {
            const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(raw) ?? [null, raw]
            model = JSON.parse(match[1] ?? raw)
          } catch {
            model = { raw }
          }
          return { rules, model }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_apply_advice',
      description: '执行诊断建议：给定原文与建议，模型按建议改写该段（需要模型）。',
      parameters: {
        text: { type: 'string', required: true, description: '原文片段' },
        advice: { type: 'string', required: true, description: '诊断建议' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { text: string; advice: string }
        return asJson(await asResult(async () => {
          if (!llm) return degraded({}, '模型未就绪，无法改写')
          const revised = await llm.complete(
            '你是网文编辑。按建议改写给定片段，保持情节与角色不变。',
            `建议：${args.advice}\n\n原文：\n${args.text}\n\n只输出改写结果。`,
            2000,
          )
          return { revised }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_validate',
      description: '章节四族校验（结构/内容/剧情/一致性）：字数/标题/禁用词/AI 味/视角/对话占比/章末钩子/细纲覆盖。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '章节号' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number }
        return asJson(await asResult(async () => {
          const book = await novel.load(args.projectId)
          const chapter = await novel.chapterWithText(args.projectId, args.chapterNo)
          if (!chapter) return degraded({ passed: false, issues: [] }, '章节不存在')
          const report = validateChapter(BUILTIN_RULES, {
            book,
            chapterNo: args.chapterNo,
            title: chapter.chapter.title,
            text: chapter.content,
            brief: chapter.chapter.brief,
            forbiddenWords: book.config.style.forbiddenWords,
            ledger: await new LedgerStore(ledgerFilePath(novel.projectDir(args.projectId))).all(),
          })
          return { report, aiTaste: scanAiTaste(chapter.content, [...BUILTIN_AI_TASTE_WORDS, ...book.config.style.aiTasteWords.map((w) => ({ word: w, category: 'connector' as const, strategy: 'rewrite' as const }))]).score }
        }))
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
