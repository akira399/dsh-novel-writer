/**
 * dsh-novel-writer — 四族校验引擎（P2-C）。
 *
 * 规则族（DEVELOPMENT-PLAN §3.4）：
 *  - 结构族：章节字数区间 / 标题规范 / 编号连续
 *  - 一致性族：账本实体状态冲突（数据源由 P2-D 一致性引擎提供，接口先就位）
 *  - 内容族：禁用词 / AI 味密度 / 视角漂移 / 对话占比越界
 *  - 剧情族：章末钩子 / 细纲关键词覆盖
 * 引擎：规则注册表 + validateChapter 执行器（纯函数，报告结构化）。
 */
import type { Book } from '../novel/types.ts'
import { checkWordTarget, countChapter } from '../stats/wordcount.ts'
import { scanAiTaste, BUILTIN_AI_TASTE_WORDS } from '../polish/index.ts'
import { hasChapterHook } from '../diagnose/rules.ts'
import { detectLedgerConflicts } from '../consistency/detect.ts'

export interface ValidationIssue {
  rule: string
  family: 'structure' | 'consistency' | 'content' | 'plot'
  level: 'error' | 'warning'
  /** 定位对象（章节/字段/实体）。 */
  target: string
  message: string
}

export interface ValidationReport {
  passed: boolean
  issues: ValidationIssue[]
  ranAt: string
}

export interface ValidationContext {
  book: Book
  chapterNo: number
  title: string
  text: string
  /** 细纲（可选，剧情族对照）。 */
  brief?: string
  /** 项目级禁用词/AI 味词覆盖。 */
  forbiddenWords?: string[]
  aiTasteWords?: readonly { word: string; category: 'connector' | 'action' | 'psychology' | 'adjective' | 'tone'; strategy: 'replace' | 'delete' | 'rewrite'; replacement?: string }[]
  /** 一致性族输入（P2-D 账本快照；缺省跳过一致性规则）。 */
  ledger?: unknown
}

export interface ValidationRule {
  id: string
  family: ValidationIssue['family']
  level: 'error' | 'warning'
  run(ctx: ValidationContext): ValidationIssue[]
}

// ─────────────────────────── 内置规则 ───────────────────────────

function structureWordcount(ctx: ValidationContext): ValidationIssue[] {
  const target = ctx.book.config.wordTargets
  const stats = checkWordTarget(countChapter(ctx.text, ctx.chapterNo), target.perChapterMin, target.perChapterMax)
  if (stats.meetsTarget) return []
  return [{
    rule: 'structure.wordcount', family: 'structure',
    level: stats.totalChars < target.perChapterMin ? 'error' : 'warning',
    target: `ch${ctx.chapterNo}`,
    message: `本章 ${stats.totalChars} 字，目标区间 ${target.perChapterMin}-${target.perChapterMax}`,
  }]
}

function structureTitle(ctx: ValidationContext): ValidationIssue[] {
  const title = ctx.title.trim()
  if (!title) return [{ rule: 'structure.title', family: 'structure', level: 'error', target: `ch${ctx.chapterNo}`, message: '章节标题为空' }]
  if (/[#*`<>]/.test(title)) {
    return [{ rule: 'structure.title', family: 'structure', level: 'warning', target: `ch${ctx.chapterNo}`, message: '标题含 markdown/HTML 格式符，请使用纯文本标题' }]
  }
  return []
}

function contentForbidden(ctx: ValidationContext): ValidationIssue[] {
  const words = ctx.forbiddenWords ?? []
  if (words.length === 0) return []
  const hits = words.filter((word) => word && ctx.text.includes(word))
  return hits.map((word) => ({
    rule: 'content.forbidden', family: 'content' as const, level: 'warning' as const,
    target: `ch${ctx.chapterNo}`, message: `命中禁用词：${word}`,
  }))
}

function contentAiTaste(ctx: ValidationContext): ValidationIssue[] {
  const report = scanAiTaste(ctx.text, ctx.aiTasteWords ?? BUILTIN_AI_TASTE_WORDS)
  if (report.hits === 0) return []
  const message = `AI 味密度评分 ${report.score}/100（命中 ${report.hits} 处：${Object.entries(report.byCategory).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join('、')}）`
  return [{
    rule: 'content.aiTaste', family: 'content',
    level: report.score >= 60 ? 'error' : 'warning',
    target: `ch${ctx.chapterNo}`, message,
  }]
}

function contentPov(ctx: ValidationContext): ValidationIssue[] {
  // 视角漂移粗检：第一人称「我」与第三人称「他」同现高频
  // 注意：「我们」不算第一人称单数（排除「我」后随「们」）
  const me = (ctx.text.match(/我(?!们)/g) ?? []).length
  const him = (ctx.text.match(/他/g) ?? []).length
  const pov = ctx.book.config.style.pov
  if (pov === 'first' && him > me && him > 5) {
    return [{ rule: 'content.pov', family: 'content', level: 'warning', target: `ch${ctx.chapterNo}`, message: `设定第一人称但「他」出现 ${him} 次（「我」${me} 次），疑似视角漂移` }]
  }
  if (pov === 'third' && me > him && me > 5) {
    return [{ rule: 'content.pov', family: 'content', level: 'warning', target: `ch${ctx.chapterNo}`, message: `设定第三人称但「我」出现 ${me} 次，疑似人称漂移` }]
  }
  return []
}

function contentDialogue(ctx: ValidationContext): ValidationIssue[] {
  const stats = countChapter(ctx.text, ctx.chapterNo)
  if (stats.totalChars < 300) return []
  if (stats.dialogueRatio > 0.7) {
    return [{ rule: 'content.dialogue', family: 'content', level: 'warning', target: `ch${ctx.chapterNo}`, message: `对话占比 ${Math.round(stats.dialogueRatio * 100)}% 过高（建议 ≤70%）` }]
  }
  return []
}

function plotHook(ctx: ValidationContext): ValidationIssue[] {
  if (ctx.text.trim().length < 100) return []
  if (!hasChapterHook(ctx.text)) {
    return [{ rule: 'plot.hook', family: 'plot', level: 'error', target: `ch${ctx.chapterNo}`, message: '章末无钩子（对话/悬念/冲突/强标点），请补一个具体悬念' }]
  }
  return []
}

function plotBriefCoverage(ctx: ValidationContext): ValidationIssue[] {
  const brief = ctx.brief?.trim()
  if (!brief || ctx.text.trim().length < 200) return []
  // 细纲短语：按标点切分，取 2-6 字核心短语（≤6 个）
  const phrases = brief.split(/[，。！？、；：\s]+/).filter((p) => p.length >= 2).slice(0, 6)
  if (phrases.length === 0) return []
  // 覆盖判定：短语整体出现，或 ≥2 个不同 2 字窗口命中（换称宽容但不误报无关文本）
  const covered = (phrase: string): boolean => {
    if (ctx.text.includes(phrase)) return true
    let windows = 0
    for (let i = 0; i < phrase.length - 1; i += 1) {
      if (ctx.text.includes(phrase.slice(i, i + 2))) windows += 1
      if (windows >= 2) return true
    }
    return false
  }
  const missed = phrases.filter((phrase) => !covered(phrase))
  if (missed.length > phrases.length / 2) {
    return [{
      rule: 'plot.briefCoverage', family: 'plot', level: 'warning',
      target: `ch${ctx.chapterNo}`,
      message: `细纲要素覆盖不足：${missed.join('、')} 未在正文出现，本章可能偏离细纲`,
    }]
  }
  return []
}

/** 一致性族规则：账本覆盖冲突（P2-D 接线；ledger 为 LedgerEntry[] 时生效）。 */
function consistencyLedger(ctx: ValidationContext): ValidationIssue[] {
  if (!Array.isArray(ctx.ledger)) return []
  const conflicts = detectLedgerConflicts(ctx.ledger)
  return conflicts
    .filter((conflict) => conflict.severity === 'warning')
    .map((conflict) => ({
      rule: 'consistency.ledger', family: 'consistency' as const, level: 'error' as const,
      target: `ch${ctx.chapterNo}`,
      message: `账本覆盖冲突：${conflict.entity}.${conflict.field} 多次取值（${conflict.history.map((h) => h.value).join(' → ')}）`,
    }))
}

// ─────────────────────────── 执行器 ───────────────────────────

export const BUILTIN_RULES: ValidationRule[] = [
  { id: 'structure.wordcount', family: 'structure', level: 'error', run: structureWordcount },
  { id: 'structure.title', family: 'structure', level: 'error', run: structureTitle },
  { id: 'content.forbidden', family: 'content', level: 'warning', run: contentForbidden },
  { id: 'content.aiTaste', family: 'content', level: 'warning', run: contentAiTaste },
  { id: 'content.pov', family: 'content', level: 'warning', run: contentPov },
  { id: 'content.dialogue', family: 'content', level: 'warning', run: contentDialogue },
  { id: 'plot.hook', family: 'plot', level: 'error', run: plotHook },
  { id: 'plot.briefCoverage', family: 'plot', level: 'warning', run: plotBriefCoverage },
  { id: 'consistency.ledger', family: 'consistency', level: 'error', run: consistencyLedger },
]

/** 执行校验（error 级问题清零才算通过；规则异常转为 internal error 可见化）。 */
export function validateChapter(rules: readonly ValidationRule[], ctx: ValidationContext): ValidationReport {
  const issues: ValidationIssue[] = []
  for (const rule of rules) {
    try {
      issues.push(...rule.run(ctx))
    } catch (error) {
      issues.push({
        rule: `internal.${rule.id}`, family: 'structure', level: 'error',
        target: `ch${ctx.chapterNo}`,
        message: `校验规则 ${rule.id} 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  const errors = issues.filter((issue) => issue.level === 'error')
  return { passed: errors.length === 0, issues, ranAt: new Date().toISOString() }
}
