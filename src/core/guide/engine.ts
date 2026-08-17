/**
 * dsh-novel-writer — 创作向导与工坊助手（P1-H）。
 *
 * 创作向导：新建项目的五步引导状态机（纯函数，状态可持久化到 book.json）；
 * 工坊助手：自然语言 → 结构化动作的意图解析（规则通道，P2 加模型通道）。
 * 参考 AI 酒馆理念：非技术用户用对话/引导完成创作操作。
 */
import type { PluginError, Result } from '../types.ts'

// ─────────────────────────── 创作向导 ───────────────────────────

export const WIZARD_STEPS = ['genre', 'title', 'setting', 'outline', 'start'] as const
export type WizardStepId = typeof WIZARD_STEPS[number]
export type WizardStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped'

export interface WizardState {
  step: WizardStepId
  status: Record<WizardStepId, WizardStepStatus>
  /** 每步产物（title=书名、setting=设定文本、outline=大纲文本、genre=类型）。 */
  artifacts: Partial<Record<WizardStepId, string>>
  /** 全部核心步骤完成（可开写）。 */
  readyToWrite: boolean
  updatedAt: string
}

export function createWizard(now: string): WizardState {
  return {
    step: 'genre',
    status: { genre: 'in_progress', title: 'pending', setting: 'pending', outline: 'pending', start: 'pending' },
    artifacts: {},
    readyToWrite: false,
    updatedAt: now,
  }
}

function nextStepOf(step: WizardStepId): WizardStepId | null {
  const index = WIZARD_STEPS.indexOf(step)
  return index >= 0 && index < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[index + 1]! : null
}

/** 推进到下一个未完成步骤（当前步须已 done/skipped）。 */
export function wizardNext(state: WizardState, now: string): Result<{ state: WizardState; step: WizardStepId | null }> {
  const current = state.status[state.step]
  if (current !== 'done' && current !== 'skipped') {
    return { ok: false, error: { code: 'INVALID_STATE', message: `当前步骤 ${state.step} 尚未完成（${current}）` } as PluginError }
  }
  let next = nextStepOf(state.step)
  while (next !== null && state.status[next] === 'done') {
    next = nextStepOf(next)
  }
  if (next === null) {
    const ready = state.status.genre === 'done' && state.status.title === 'done'
    return { ok: true, value: { state: { ...state, readyToWrite: ready, updatedAt: now }, step: null } }
  }
  const nextState: WizardState = {
    ...state,
    step: next,
    status: { ...state.status, [next]: 'in_progress' },
    updatedAt: now,
  }
  return { ok: true, value: { state: nextState, step: next } }
}

/** 提交当前步骤产物（标记 done）。 */
export function wizardCommit(state: WizardState, step: WizardStepId, artifact: string, now: string): Result<WizardState> {
  if (state.status[step] !== 'in_progress') {
    return { ok: false, error: { code: 'INVALID_STATE', message: `步骤 ${step} 不在进行中` } as PluginError }
  }
  if (!artifact.trim()) return { ok: false, error: { code: 'INVALID_FIELD_TYPE', message: '步骤产物不能为空' } as PluginError }
  const nextState: WizardState = {
    ...state,
    status: { ...state.status, [step]: 'done' },
    artifacts: { ...state.artifacts, [step]: artifact.trim() },
    updatedAt: now,
  }
  // start 步骤完成 = 向导完成
  if (step === 'start') {
    nextState.readyToWrite = true
    nextState.status.start = 'done'
  }
  return { ok: true, value: nextState }
}

/** 跳过当前步骤（标记 skipped，产物留空）。 */
export function wizardSkip(state: WizardState, step: WizardStepId, now: string): Result<WizardState> {
  if (state.status[step] !== 'in_progress') {
    return { ok: false, error: { code: 'INVALID_STATE', message: `步骤 ${step} 不在进行中` } as PluginError }
  }
  return { ok: true, value: { ...state, status: { ...state.status, [step]: 'skipped' }, updatedAt: now } }
}

// ─────────────────────────── 意图解析（工坊助手） ───────────────────────────

export interface IntentAction {
  /** 意图名（稳定 id）。 */
  intent: string
  /** 目标工具动作。 */
  action: string
  params: Record<string, unknown>
  /** 置信度 0-1（低置信需要用户确认）。 */
  confidence: number
  /** 是否必须用户确认后才执行（涉及写操作/消耗额度时 true）。 */
  confirmRequired: boolean
}

interface IntentRule {
  pattern: RegExp
  intent: string
  action: string
  params?: Record<string, unknown>
  confidence: number
  /** 写操作（创建/修改/删除/消耗模型额度）需要确认。 */
  mutating?: boolean
}

/** 规则通道（P1 版；P2 增加模型通道兜底）。 */
const INTENT_RULES: IntentRule[] = [
  { pattern: /(写下一章|继续写|接着写|写第\s*\d+\s*章)/, intent: 'write_chapter', action: 'novel_write_chapter', confidence: 0.95, mutating: true },
  { pattern: /(去\s*AI\s*味|去味|改得自然|口语化|像人写)/, intent: 'depolish', action: 'novel_depolish', confidence: 0.9, mutating: true },
  { pattern: /(润色|校对|改错字|修病句|错别字)/, intent: 'polish', action: 'novel_revise', confidence: 0.9, mutating: true },
  { pattern: /(检查|诊断|哪里不好|问题|黄金三章|开头怎么样|节奏)/, intent: 'diagnose', action: 'novel_diagnose', confidence: 0.85 },
  { pattern: /(现在.{0,6}(境界|修为|状态|实力)|查(一下)?账本|一致性)/, intent: 'ledger', action: 'novel_ledger', confidence: 0.85 },
  { pattern: /(记(一下|个)?灵感|灵感)/, intent: 'idea', action: 'novel_idea', confidence: 0.8, mutating: true },
  { pattern: /(创建项目|新书|开新书|新建小说)/, intent: 'create_project', action: 'novel_create_project', confidence: 0.9, mutating: true },
  { pattern: /(设定|世界观)/, intent: 'phase_setting', action: 'novel_phase', params: { phase: 'setting' }, confidence: 0.85 },
  { pattern: /(人设|角色卡|人物设定)/, intent: 'phase_character', action: 'novel_phase', params: { phase: 'character' }, confidence: 0.85 },
  { pattern: /(全书大纲|大纲)/, intent: 'phase_outline', action: 'novel_phase', params: { phase: 'outline' }, confidence: 0.85 },
  { pattern: /(分卷)/, intent: 'phase_volume', action: 'novel_phase', params: { phase: 'volume' }, confidence: 0.85 },
  { pattern: /(细纲|章纲)/, intent: 'phase_chapter', action: 'novel_phase', params: { phase: 'chapter' }, confidence: 0.85 },
  { pattern: /(导出|完本|完结|发布)/, intent: 'export', action: 'novel_export', confidence: 0.8 },
  { pattern: /(统计|多少字|字数)/, intent: 'wordcount', action: 'novel_wordcount', confidence: 0.85 },
  { pattern: /(市场|行情|热门题材|榜单|调研|读者偏好)/, intent: 'market', action: 'novel_market_research', confidence: 0.85, mutating: true },
  { pattern: /(克隆|复制项目|套用模板|参照.{0,8}写.{0,6}新的|模板.*新书|照着.{0,6}写一本)/, intent: 'clone', action: 'novel_clone_project', confidence: 0.8, mutating: true },
]

/** 规则通道意图解析：按规则表优先级返回首个命中（未命中返回 null，由模型通道/自由对话兜底）。 */
export function parseIntent(text: string): IntentAction | null {
  const normalized = String(text ?? '').trim()
  if (!normalized) return null
  for (const rule of INTENT_RULES) {
    rule.pattern.lastIndex = 0
    if (!rule.pattern.test(normalized)) continue
    return {
      intent: rule.intent,
      action: rule.action,
      params: rule.params ?? {},
      confidence: rule.confidence,
      confirmRequired: rule.mutating === true,
    }
  }
  return null
}
