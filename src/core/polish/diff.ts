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

/** 一条可独立采纳/拒绝的润色改动建议（段落级：一条 = 原文一个段落 → 润色后段落）。 */
export interface PolishSuggestion {
  id: string
  /** 原段落文本（被改动的原文段落；新增段为空）。 */
  original: string
  /** 润色后段落（采纳后替换进正文；删除段为空）。 */
  polished: string
  /** 该段落在 original 全文中的起止下标（重组用）。 */
  start: number
  end: number
  /** 原段落号（1-based，用于"点击建议定位到对应原文段落"）。 */
  paraIndex: number
  /** 纯新增段：插入到原段号 insertAfter 之后（0 = 全文开头前）。 */
  insertAfter?: number
  /** 是否采纳（默认未采纳——用户逐条决定）。 */
  accepted: boolean
}

/** 按空行/换行把文本切成非空段落，并记录每个段落在原文中的 [start,end)。 */
export function paragraphSpans(text: string): Array<{ text: string; start: number; end: number }> {
  const spans: Array<{ text: string; start: number; end: number }> = []
  const source = String(text ?? '')
  const re = /[^\n]+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const t = match[0]
    const start = match.index
    const end = start + t.length
    if (t.trim()) spans.push({ text: t, start, end })
  }
  return spans
}

/**
 * 把「原文 vs 润色文」拆成**段落级**建议（每条建议 = 一个被改动的原段 → 对应润色段）：
 * 用标准 LCS 回溯在"段落 token"上对齐（相同段=same），未对齐的连续区段内
 * **一对一配对**（只取 min(原段数, 润色段数)），多余者作为删除/新增段——
 * 保证每条建议的 original/polished **内容一定对应**，绝不跨段错配。
 */
export function splitPolishSuggestions(original: string, polished: string): PolishSuggestion[] {
  const p = paragraphSpans(original)
  const q = paragraphSpans(polished)
  const n = p.length
  const m = q.length
  const suggestions: PolishSuggestion[] = []

  // 段落 token 上的标准 LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = p[i]!.text === q[j]!.text ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const delRun: number[] = [] // 待配对的"原段"下标
  const addRun: number[] = [] // 待配对的"润色段"下标
  // 最近已"定稿"的原段下标（0-based，-1=尚未出现任何原段）——给新增段定插入锚点
  let lastFixed = -1
  const make = (pi: number, qi: number): void => {
    const sp = pi >= 0 && pi < n ? p[pi] : undefined
    const sq = qi >= 0 && qi < m ? q[qi] : undefined
    if (!sp && !sq) return
    const isInsert = !sp && !!sq
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      original: sp?.text ?? '',
      polished: sq?.text ?? '',
      start: sp?.start ?? (sq ? sq.start : 0),
      end: sp?.end ?? (sp ? sp.end : (sq ? sq.end : 0)),
      paraIndex: sp ? pi + 1 : qi + 1,
      // 纯新增段：插入到最近定稿的原段之后（0=全文开头前）
      ...(isInsert ? { insertAfter: lastFixed + 1 } : {}),
      accepted: false,
    })
  }
  // 结算一个改动区段：
  //  - 原段数==润色段数 → 逐段一一配对（替换）
  //  - 段数不一致（合并/拆分/增删）→ 不逐段错配，原区段整体删除 + 润色区段整体新增
  //    （宁可显示为"删旧增新"，也绝不把 A 段内容配给 B 段，避免误导用户）
  const flush = (): void => {
    if (delRun.length === addRun.length && delRun.length > 0) {
      for (let k = 0; k < delRun.length; k += 1) make(delRun[k]!, addRun[k]!)
    } else {
      for (const pi of delRun) make(pi, -1)
      for (const qi of addRun) make(-1, qi)
    }
    // 本改动区段消费过的原段，作为后续新增段的锚点
    for (const pi of delRun) lastFixed = Math.max(lastFixed, pi)
    delRun.length = 0
    addRun.length = 0
  }

  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && p[i]!.text === q[j]!.text) {
      flush()
      lastFixed = i
      i += 1
      j += 1
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      addRun.push(j)
      j += 1
    } else {
      delRun.push(i)
      i += 1
    }
  }
  flush()
  return suggestions
}

/**
 * 按采纳状态把建议重组回正文：
 *  1) 有原段的建议 → 将 original 中 [start,end) 替换为 polished（替换/删除段）；
 *  2) 纯新增段建议（original 空、含 insertAfter）→ 插入到第 insertAfter 段之后（0=开头前）。
 * 未采纳的保持原文。按位置从后往前应用防下标错位。
 */
export function applyPolishSuggestions(original: string, suggestions: readonly PolishSuggestion[]): string {
  // 替换/删除（基于原 span 位置）
  const replacements = suggestions
    .filter((s) => s.accepted && s.original.length > 0)
    .slice()
    .sort((a, b) => b.start - a.start)
  let result = original
  for (const s of replacements) {
    const start = Math.max(0, s.start)
    const end = Math.min(result.length, s.end)
    if (end < start) continue
    result = result.slice(0, start) + s.polished + result.slice(end)
  }
  // 新增段插入（锚点基于替换后的 result 重新取段界，防错位）
  const inserts = suggestions
    .filter((s) => s.accepted && s.original.length === 0 && s.polished.length > 0 && s.insertAfter !== undefined)
    .slice()
    .sort((a, b) => (b.insertAfter ?? 0) - (a.insertAfter ?? 0))
  if (inserts.length > 0) {
    const spans = paragraphSpans(result)
    for (const s of inserts) {
      const at = (s.insertAfter ?? 0) >= 1 && spans[(s.insertAfter ?? 1) - 1]
        ? spans[(s.insertAfter ?? 1) - 1]!.end
        : 0
      result = result.slice(0, at) + (at > 0 ? '\n\n' : '') + s.polished + result.slice(at)
    }
  }
  return result
}
