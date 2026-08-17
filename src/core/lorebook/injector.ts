/**
 * dsh-novel-writer — 注入组装器（P1-D）。
 *
 * 职责：把世界书条目组装为 InjectionPlan（方案 §3.1-M1 / v3 §3.3）：
 *  1. 过滤：disabled 条目、禁用分组内条目、book_id 不匹配条目；
 *  2. 分流：常驻（always_active）按位置进 prepend/append；
 *     关键词命中按 inject_target/inject_position 进 prepend/append/at_depth；
 *  3. 排序：priority 降序（at_depth 组内按 depth）；
 *  4. 预算：injectionBudget 贪心裁剪（truncated 记录原因）；
 *  5. 渲染：变量宏 + {{char}}/{{user}} 名称宏。
 * 纯逻辑无 IO；三种 scope（lorebook/prompt_front/prompt_back）复用同一引擎。
 * 对齐夏瑾 systemPromptHook/finalizeHook 的组装顺序语义。
 */
import type { InjectionPlan, LoreEntry, LoreGroup } from '../types.ts'
import { estimateTokens } from '../util.ts'
import type { VariableContext } from '../variables/types.ts'
import { renderNameMacros, renderVariables } from '../variables/engine.ts'

export interface InjectOptions {
  /** 注入域（lorebook | prompt_front | prompt_back），仅用于标注。 */
  scope: InjectionPlan['scope']
  /** 当前小说项目（空 = 全局条目）。 */
  bookId?: string
  /** 扫描文本（当前输入，如当前章细纲/指令）。 */
  scanText: string
  /** 扫描历史（scan_depth 回溯对象；如前 N 章全文）。 */
  historyTexts?: string[]
  /** 单轮注入 token 预算（0 = 不裁剪）。 */
  budget: number
  charName?: string
  userName?: string
  variableContext?: VariableContext
}

/** 命中但被裁剪/排除的条目记录。 */
export interface PlanExcluded {
  entry: LoreEntry
  reason: 'budget' | 'disabled-group' | 'book-mismatch' | 'no-keyword-hit'
}

function groupEntryMap(groups: readonly LoreGroup[]): Map<string, LoreGroup> {
  const map = new Map<string, LoreGroup>()
  for (const group of groups) {
    for (const entryId of group.entry_ids) map.set(entryId, group)
  }
  return map
}

function matchesBook(entry: LoreEntry, groupOf: LoreGroup | undefined, bookId: string | undefined): boolean {
  // 条目级绑定优先
  if (entry.book_id) return !!bookId && entry.book_id === bookId
  // 分组级绑定
  const groupBookIds = groupOf?.book_ids ?? []
  if (groupBookIds.length > 0) return !!bookId && groupBookIds.includes(bookId)
  // 全局
  return true
}

/** 关键词命中判定（复用 matcher 语义的轻量版；正则条目按全关键词解释）。 */
function keywordHits(entry: LoreEntry, text: string): string | undefined {
  if (!text || entry.keywords.length === 0) return undefined
  if (entry.is_regex) {
    for (const keyword of entry.keywords) {
      try {
        const regex = new RegExp(keyword, entry.case_sensitive ? 'g' : 'gi')
        if (regex.test(text)) return keyword
      } catch {
        // 非法正则跳过
      }
    }
    return undefined
  }
  for (const keyword of entry.keywords) {
    if (entry.case_sensitive) {
      if (text.includes(keyword)) return keyword
    } else if (text.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword
    }
  }
  return undefined
}

/** 组装注入文本（夏瑾 <worldbook> XML 包裹风格，结构化可解析）。 */
function buildInjection(entries: readonly LoreEntry[]): string {
  if (entries.length === 0) return ''
  const parts = ['<worldbook>']
  for (const entry of entries) {
    parts.push(`<entry name="${escapeAttr(entry.name)}">`)
    parts.push(entry.content)
    parts.push('</entry>')
  }
  parts.push('</worldbook>')
  return parts.join('\n')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 组装注入计划。语义（对齐夏瑾）：
 *  - 常驻：always_active 且 target=system 且非 at_depth → prepend/append；
 *  - 关键词：在 scanText + history（受 scan_depth 回溯）中命中 →
 *    assistant 强制 at_depth；user → user 槽；system → prepend/append。
 *  - at_depth 条目不进 XML 包裹文本（由调用方按 depth 插入历史，见 P1-E）。
 */
export function buildInjectionPlan(entries: readonly LoreEntry[], groups: readonly LoreGroup[], options: InjectOptions): InjectionPlan {
  const groupOf = groupEntryMap(groups)
  const scanHistory = options.historyTexts ?? []
  const budget = Math.max(0, options.budget)

  const enabledEntries = entries.filter((entry) => entry && entry.enabled !== false)

  // 分槽
  const prepend: LoreEntry[] = []
  const append: LoreEntry[] = []
  const atDepth: Array<{ entry: LoreEntry; depth: number }> = []
  const truncated: InjectionPlan['truncated'] = []

  // 常驻条目（不进关键词扫描；按 inject_position/target 全部分流，包括 assistant→at_depth）
  for (const entry of enabledEntries) {
    const group = groupOf.get(entry.id)
    if (group && group.enabled === false) {
      truncated.push({ entry, reason: 'disabled-group' })
      continue
    }
    if (!matchesBook(entry, group, options.bookId)) {
      truncated.push({ entry, reason: 'book-mismatch' })
      continue
    }
    if (!entry.always_active) continue
    if (entry.inject_target === 'assistant' || entry.inject_position === 'at_depth') {
      atDepth.push({ entry, depth: Math.max(0, entry.insertion_depth || 0) })
    } else if (entry.inject_target === 'user') {
      append.push(entry)
    } else {
      ;(entry.inject_position === 'prepend' ? prepend : append).push(entry)
    }
  }

  // 关键词条目
  const scanTexts = [options.scanText]
  const depth = scanHistory.length
  for (const entry of enabledEntries) {
    if (entry.always_active || entry.keywords.length === 0) continue
    const group = groupOf.get(entry.id)
    if (group && group.enabled === false) {
      truncated.push({ entry, reason: 'disabled-group' })
      continue
    }
    if (!matchesBook(entry, group, options.bookId)) {
      truncated.push({ entry, reason: 'book-mismatch' })
      continue
    }
    // scan_depth 回溯
    const scanDepth = Math.max(0, Math.min(entry.scan_depth || 0, depth))
    const texts = scanDepth > 0 ? [...scanTexts, ...scanHistory.slice(-scanDepth)] : scanTexts
    const hit = texts.some((text) => keywordHits(entry, text) !== undefined)
    if (!hit) continue
    if (entry.inject_target === 'assistant' || entry.inject_position === 'at_depth') {
      atDepth.push({ entry, depth: Math.max(0, entry.insertion_depth || 0) })
    } else if (entry.inject_target === 'user') {
      // user 槽位并入 append（上下文包中用户指令区由 P1-E 决定；此处保持顺序）
      append.push(entry)
    } else {
      ;(entry.inject_position === 'prepend' ? prepend : append).push(entry)
    }
  }

  // 排序：priority 降序；at_depth 按 depth 降序（深者先插入）
  const sortByPriority = (a: LoreEntry, b: LoreEntry): number => (b.priority || 50) - (a.priority || 50) || a.id.localeCompare(b.id)
  prepend.sort(sortByPriority)
  append.sort(sortByPriority)
  atDepth.sort((a, b) => b.depth - a.depth || sortByPriority(a.entry, b.entry))

  // 预算裁剪（贪心：先保高优先级；三个槽共享同一预算计数器，0 = 不裁剪）
  if (budget > 0) {
    let used = 0
    const keep = (list: LoreEntry[]): LoreEntry[] => {
      const kept: LoreEntry[] = []
      for (const entry of list) {
        const tokens = estimateTokens(entry.content)
        if (used + tokens > budget) {
          truncated.push({ entry, reason: 'budget' })
          continue
        }
        used += tokens
        kept.push(entry)
      }
      return kept
    }
    const keptPrepend = keep(prepend)
    const keptAppend = keep(append)
    prepend.length = 0
    append.length = 0
    prepend.push(...keptPrepend)
    append.push(...keptAppend)
    const keptDepth: typeof atDepth = []
    for (const item of atDepth) {
      const tokens = estimateTokens(item.entry.content)
      if (used + tokens > budget) {
        truncated.push({ entry: item.entry, reason: 'budget' })
        continue
      }
      used += tokens
      keptDepth.push(item)
    }
    atDepth.length = 0
    atDepth.push(...keptDepth)
  }

  // 渲染（变量宏 + 名称宏；at_depth 条目同样渲染）
  const render = (entry: LoreEntry): LoreEntry => {
    let content = options.variableContext ? renderVariables(entry.content, options.variableContext) : entry.content
    content = renderNameMacros(content, options.charName ?? '', options.userName ?? '')
    return { ...entry, content }
  }
  const renderedPrepend = prepend.map(render)
  const renderedAppend = append.map(render)
  const renderedAtDepth = atDepth.map((item) => ({ ...item, entry: render(item.entry) }))

  const tokenEstimate = estimateTokens(`${buildInjection(renderedPrepend)}\n${buildInjection(renderedAppend)}`)

  return {
    scope: options.scope,
    prepend: renderedPrepend,
    append: renderedAppend,
    atDepth: renderedAtDepth,
    tokenEstimate,
    truncated,
    renderedPrepend: buildInjection(renderedPrepend),
    renderedAppend: buildInjection(renderedAppend),
    builtAt: new Date().toISOString(),
  }
}
