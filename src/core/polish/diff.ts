/**
 * dsh-novel-writer — 润色差异对比（P3 一键润色模块）。
 *
 * 句子级 LCS diff：把原文与润色文按"句末标点 + 换行"切分为 token 序列，
 * 求最长公共子序列后回溯生成 chunk 流（same / del / add），供 GUI 标亮显示
 * "被修改的内容"。纯函数、零 IO、零依赖，可全量单测。
 *
 * 说明：token 级比较（精确相等）意味着润色中任何改动（哪怕一个标点）都会把
 * 整句标为 del+add——这正是"标亮修改处"的预期语义（句子是网文最小的
 * 可读粒度，句内再细分会打散可读性）。
 */

export type DiffChunk = { type: 'same' | 'del' | 'add'; text: string }

/** 句子切分：保留句末标点与换行为独立 token（LCS 可对齐结构）。 */
export function splitSentences(text: string): string[] {
  return String(text ?? '')
    .split(/(\n+|[\u3002\uff01\uff1f!?;；]+)/)
    .filter((part) => part.length > 0)
}

/**
 * 句子级 diff。超大文本（任一侧 token > 2000）退化为整块对比，
 * 保证大章节润色时页面不卡死（O(n·m) DP 保护）。
 */
export function diffSentences(original: string, polished: string): DiffChunk[] {
  const a = splitSentences(original)
  const b = splitSentences(polished)
  if (a.length > 2000 || b.length > 2000) {
    const chunks: DiffChunk[] = []
    if (a.length > 0) chunks.push({ type: 'del', text: original })
    if (b.length > 0) chunks.push({ type: 'add', text: polished })
    return chunks
  }

  // LCS DP（自底向上）
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  // 回溯：优先对齐 same；否则按 dp 择优（平局取 del，保证替换对渲染为 旧→新 顺序）
  const chunks: DiffChunk[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      chunks.push({ type: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (j < m && (i >= n || dp[i]![j + 1]! > dp[i + 1]![j]!)) {
      chunks.push({ type: 'add', text: b[j]! })
      j += 1
    } else {
      chunks.push({ type: 'del', text: a[i]! })
      i += 1
    }
  }
  return chunks
}

/** 变更统计（GUI 显示"共 N 处修改"）。 */
export function countDiffChanges(chunks: DiffChunk[]): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const chunk of chunks) {
    if (chunk.type === 'add') adds += 1
    else if (chunk.type === 'del') dels += 1
  }
  return { adds, dels }
}

/**
 * 字符级 diff：把两个文本逐字符 LCS，标出「具体改了哪几个字」。
 * 用于润色单条建议里"找不同"——而不是整句标红。超大文本（任一侧 > 5000）
 * 退化为整块对比（防 O(n·m) 爆炸）。
 */
export function diffChars(original: string, polished: string): DiffChunk[] {
  const a = Array.from(String(original ?? ''))
  const b = Array.from(String(polished ?? ''))
  if (a.length > 5000 || b.length > 5000) {
    const chunks: DiffChunk[] = []
    if (a.length > 0) chunks.push({ type: 'del', text: original })
    if (b.length > 0) chunks.push({ type: 'add', text: polished })
    return chunks
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  // 单格回溯（平局取 del，保证替换显示为 旧→新 顺序）
  const raw: Array<{ type: 'same' | 'del' | 'add'; text: string }> = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      raw.push({ type: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (j < m && (i >= n || dp[i]![j + 1]! > dp[i + 1]![j]!)) {
      raw.push({ type: 'add', text: b[j]! })
      j += 1
    } else {
      raw.push({ type: 'del', text: a[i]! })
      i += 1
    }
  }
  // 合并相邻同类块
  const chunks: DiffChunk[] = []
  for (const item of raw) {
    const last = chunks[chunks.length - 1]
    if (last && last.type === item.type) last.text += item.text
    else chunks.push({ type: item.type, text: item.text })
  }
  return chunks
}

/** 一条可独立采纳/拒绝的润色改动建议。 */
export interface PolishSuggestion {
  id: string
  /** 原句片段（被改动的原文）。 */
  original: string
  /** 润色后片段（采纳后替换进正文）。 */
  polished: string
  /** 在 original 全文中的起止下标（重组用）。 */
  start: number
  end: number
  /** 是否采纳（默认未采纳——用户逐条决定）。 */
  accepted: boolean
}

/**
 * 把「原文 vs 润色文」拆成多条建议：用句子级 diff 把每个 替换/插入/删除
 * 区段抽成一条（含在原文字中的位置）。同句多个改动会各自成条或合并成一条
 * 建议（句子级粒度，便于"这句要不要"）。
 */
export function splitPolishSuggestions(original: string, polished: string): PolishSuggestion[] {
  const chunks = diffSentences(original, polished)
  const suggestions: PolishSuggestion[] = []
  let origOffset = 0
  let index = 0
  while (index < chunks.length) {
    const chunk = chunks[index]!
    if (chunk.type === 'same') {
      origOffset += chunk.text.length
      index += 1
      continue
    }
    // 收集一个非-same 区段：可能 del(+add) 连续，或纯 add，或纯 del
    let delText = ''
    let addText = ''
    const start = origOffset
    let origConsumed = 0
    while (index < chunks.length && chunks[index]!.type !== 'same') {
      const c = chunks[index]!
      if (c.type === 'del') { delText += c.text; origConsumed += c.text.length }
      else if (c.type === 'add') addText += c.text
      index += 1
    }
    // 跳过仍在原文本中的锚点对齐（add 不消耗 original）——这段在 original 中占 [start, start+origConsumed)
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      original: delText,
      polished: addText,
      start,
      end: start + origConsumed,
      accepted: false,
    })
    origOffset = start + origConsumed
  }
  return suggestions
}

/**
 * 按采纳状态把建议重组回正文：把 original 中每条已采纳建议的 [start,end)
 * 片段替换为其 polished 文本；未采纳的保持原文。按位置从后往前替换防下标错位。
 */
export function applyPolishSuggestions(original: string, suggestions: readonly PolishSuggestion[]): string {
  const accepted = suggestions
    .filter((s) => s.accepted && s.polished.length > 0)
    .slice()
    .sort((a, b) => b.start - a.start) // 从后往前替换
  let result = original
  for (const s of accepted) {
    const start = Math.max(0, s.start)
    const end = Math.min(result.length, s.end)
    // 替换区间 [start,end)；纯插入（end===start）也允许（在 start 处插入）
    result = result.slice(0, start) + s.polished + result.slice(end)
  }
  return result
}
