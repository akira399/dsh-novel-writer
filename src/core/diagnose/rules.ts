/**
 * dsh-novel-writer — 黄金三章规则层诊断（P2-B）。
 *
 * 纯函数、离线可跑（模型层失败时兜底，保证评分必出）：
 *  - 字数达标（wordTargets 闭区间）
 *  - 对话占比（0.05-0.7 之外警告）
 *  - 章末钩子（结尾 80 字内：对话/悬念词/冲突动作/强烈标点）
 *  - 开场钩子（第一章前 150 字内事件感）
 *  - 设定灌输（连续无对话长段）
 *  - 冲突引入（前 3 章冲突词密度）
 * 维度评分 0-100（每维 0-100，总分 = 各维均分）。
 */
import type { Golden3Report, GoldenChapterIssue, GoldenDimension } from './types.ts'
import { countChapter } from '../stats/wordcount.ts'

export interface DiagnosticChapter {
  no: number
  title: string
  text: string
}

export interface DiagnoseOptions {
  wordTargets: { perChapterMin: number; perChapterMax: number }
}

/** 悬念/冲突信号词（章末钩子与冲突引入检测用）。 */
const HOOK_WORDS = ['突然', '竟然', '怎么可能', '难道', '究竟', '只见', '却见', '猛然', '赫然', '不妙', '危险', '完了']
const CONFLICT_WORDS = ['杀', '怒', '敌', '危险', '逃', '追', '仇', '挑战', '打', '死', '血', '战', '恨']
const STRONG_PUNCT = /[！？!?]/

/** 对话占比：成对引号内的字符数 / 总字符（ASCII " 按奇偶切换；中文引号明确开闭）。 */
function dialogueRatioOf(text: string): number {
  let inQuote = false
  let dialogueChars = 0
  for (const char of text) {
    if (char === '"') {
      inQuote = !inQuote
      continue
    }
    if (char === '“' || char === '「' || char === '『') {
      inQuote = true
      continue
    }
    if (char === '”' || char === '」' || char === '』') {
      inQuote = false
      continue
    }
    if (inQuote) dialogueChars += 1
  }
  return text.length > 0 ? Math.min(1, dialogueChars / text.length) : 0
}

function tail(text: string, length: number): string {
  return text.trimEnd().slice(-length)
}

function isDialogue(text: string): boolean {
  return /["“「『]/.test(text)
}

/** 章末钩子判定（P2-C 校验引擎复用）。 */
export function hasChapterHook(text: string): boolean {
  const tailText = tail(text, 80)
  return isDialogue(tailText)
    || HOOK_WORDS.some((word) => tailText.includes(word))
    || CONFLICT_WORDS.some((word) => tailText.includes(word))
    || STRONG_PUNCT.test(tailText)
}

/** 判定单章并收集问题。 */
function diagnoseChapter(chapter: DiagnosticChapter, options: DiagnoseOptions): { issues: GoldenChapterIssue[]; dimensionHits: Record<GoldenDimension, number> } {
  const issues: GoldenChapterIssue[] = []
  const dimensionHits: Record<GoldenDimension, number> = {
    开场钩子: 100, 主角亮相: 100, 冲突引入: 100, 爽点密度: 100, 章末悬念: 100, 设定灌输: 100,
  }
  const text = chapter.text
  const stats = countChapter(text, chapter.no)

  // 1. 字数达标
  if (stats.totalChars < options.wordTargets.perChapterMin) {
    issues.push({
      severity: 'warning', rule: 'rule-wordcount', chapter: chapter.no,
      evidence: `本章 ${stats.totalChars} 字（目标 ${options.wordTargets.perChapterMin}-${options.wordTargets.perChapterMax}）`,
      advice: `本章字数不足，需扩写至 ${options.wordTargets.perChapterMin} 字以上（补冲突/细节/对话，勿注水）`,
    })
    dimensionHits['爽点密度'] -= 15
  } else if (stats.totalChars > options.wordTargets.perChapterMax) {
    issues.push({
      severity: 'warning', rule: 'rule-wordcount', chapter: chapter.no,
      evidence: `本章 ${stats.totalChars} 字，超过上限 ${options.wordTargets.perChapterMax}`,
      advice: '本章超长，检查是否有拖沓段落，建议拆分或压缩',
    })
  }

  // 2. 对话占比
  const ratio = dialogueRatioOf(text)
  if (ratio < 0.05 && stats.totalChars > 200) {
    issues.push({
      severity: 'warning', rule: 'rule-dialogue', chapter: chapter.no,
      evidence: `对话占比约 ${Math.round(ratio * 100)}%（建议 ≥5%）`,
      advice: '本章对话过少，节奏易沉闷；至少安排一次有目的的对话推进情节',
    })
    dimensionHits['爽点密度'] -= 10
  } else if (ratio > 0.7) {
    issues.push({
      severity: 'warning', rule: 'rule-dialogue', chapter: chapter.no,
      evidence: `对话占比约 ${Math.round(ratio * 100)}%（建议 ≤70%）`,
      advice: '对话占比过高，注意动作与描写穿插',
    })
  }

  // 3. 章末钩子（结尾 80 字）
  const hasHook = hasChapterHook(text)
  if (!hasHook && text.trim().length > 100) {
    issues.push({
      severity: 'error', rule: 'rule-hook', chapter: chapter.no,
      evidence: `章末：${tail(text, 40)}`,
      advice: '章末必须有具体钩子：悬念（威胁逼近/真相一角/人物反常）或冲突升级，禁止平淡收尾',
    })
    dimensionHits['章末悬念'] -= 40
  }

  // 4. 开场钩子（仅第一章；chapterStart>1 时跳过该维度）
  if (chapter.no === 1) {
    const opening = text.slice(0, 150)
    const hasOpeningHook = STRONG_PUNCT.test(opening)
      || CONFLICT_WORDS.some((word) => opening.includes(word))
      || isDialogue(opening)
    if (!hasOpeningHook && opening.trim().length > 30) {
      issues.push({
        severity: 'error', rule: 'rule-opening', chapter: chapter.no,
        evidence: `开头：${opening.slice(0, 60)}`,
        advice: '黄金三章要求 3 行内进入事件：用动作/冲突/反常开局，先写事件再补背景',
      })
      dimensionHits['开场钩子'] -= 40
    }
  }

  // 5. 设定灌输（连续无对话长段）
  let silentRun = 0
  let silentRunStart = 0
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (isDialogue(trimmed)) {
      silentRun = 0
      continue
    }
    if (trimmed.length > 120) {
      silentRun += 1
      if (silentRun === 1) silentRunStart = lineIndex
    } else {
      silentRun = 0
    }
    if (silentRun >= 3) {
      issues.push({
        severity: 'warning', rule: 'rule-infodump', chapter: chapter.no,
        evidence: `连续 ${silentRun} 段无对话的长段落（起始行 ${silentRunStart + 1}）`,
        advice: '设定应通过事件/对话呈现（show, don\'t tell），把说明拆散并绑定角色动作',
      })
      dimensionHits['设定灌输'] -= 25
      break
    }
  }

  // 6. 冲突词密度（前 3 章合计由调用方聚合；此处按章计）
  const conflictCount = CONFLICT_WORDS.reduce((sum, word) => sum + (text.split(word).length - 1), 0)
  if (conflictCount < 2 && stats.totalChars > 500) {
    issues.push({
      severity: 'warning', rule: 'rule-conflict', chapter: chapter.no,
      evidence: `本章冲突信号词仅 ${conflictCount} 处`,
      advice: '每章至少一个冲突事件（利益/立场/力量对抗），纯日常推进会让读者流失',
    })
    dimensionHits['冲突引入'] -= 15
  }

  return { issues, dimensionHits }
}

/** 诊断前 N 章（默认 3），规则层评分必出。 */
export function diagnoseFirstChapters(chapters: readonly DiagnosticChapter[], options: DiagnoseOptions, count = 3): Golden3Report {
  const targets = chapters.slice(0, count)
  const issues: GoldenChapterIssue[] = []
  const dimensionSum: Record<GoldenDimension, number> = { 开场钩子: 0, 主角亮相: 0, 冲突引入: 0, 爽点密度: 0, 章末悬念: 0, 设定灌输: 0 }
  const dimensionCount: Record<GoldenDimension, number> = { 开场钩子: 0, 主角亮相: 0, 冲突引入: 0, 爽点密度: 0, 章末悬念: 0, 设定灌输: 0 }

  for (const [index, chapter] of targets.entries()) {
    void index
    const { issues: chapterIssues, dimensionHits } = diagnoseChapter(chapter, options)
    issues.push(...chapterIssues)
    for (const dimension of Object.keys(dimensionHits) as GoldenDimension[]) {
      dimensionSum[dimension] += dimensionHits[dimension]
      dimensionCount[dimension] += 1
    }
  }

  const dimensions: Partial<Record<GoldenDimension, number>> = {}
  let total = 0
  for (const dimension of Object.keys(dimensionSum) as GoldenDimension[]) {
    const value = dimensionCount[dimension] > 0 ? Math.max(0, Math.round(dimensionSum[dimension] / dimensionCount[dimension])) : 0
    dimensions[dimension] = value
    total += value
  }
  const score = Math.max(0, Math.min(100, Math.round(total / Object.keys(dimensions).length)))

  return {
    chapters: targets.map((c) => c.no),
    score,
    dimensions,
    issues,
    ranAt: new Date().toISOString(),
  }
}
