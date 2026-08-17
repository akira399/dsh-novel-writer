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
