/**
 * dsh-novel-writer — 修订系统（P2-E）。
 * 修订模式：proofread（错别字/病句轻改）/ rhythm（节奏重写）/ style（文风统一）。
 * 纯逻辑：修订类型定义 + diff 统计（字符级差异估算）+ 版本管理约定。
 * 实际改写由 LLM 按内置提示词执行（P2-G 工具接线）。
 */

/** 修订模式。 */
export type RevisionMode = 'proofread' | 'rhythm' | 'style'

export interface RevisionOptions {
  mode: RevisionMode
  /** 修订范围：章节号（单章）或 'book'（全书，逐章）。 */
  target: number | 'book'
}

export interface RevisionResult {
  mode: RevisionMode
  chapterNo: number
  original: string
  revised: string
  /** 字数变化（+/-）。 */
  wordDelta: number
  /** 修改强度 0-1：改动字符占比。 */
  changeRatio: number
  /** 是否实质修改（>0）。 */
  changed: boolean
  revisedAt: string
}

/** 字符级 diff 统计（简单实现：LCS 长度的近似——用逐字符比较的编辑距离比例）。 */
export function diffStats(original: string, revised: string): { wordDelta: number; changeRatio: number } {
  const wordDelta = revised.length - original.length
  const maxLen = Math.max(original.length, revised.length)
  if (maxLen === 0) return { wordDelta: 0, changeRatio: 0 }
  // 粗略编辑距离（允许替换/插入/删除的动态规划，限制长度防爆）
  const distance = editDistance(original, revised, 2000)
  return { wordDelta, changeRatio: distance / maxLen }
}

/** 编辑距离（带长度上限，超限截断比较）。 */
export function editDistance(a: string, b: string, cap = 2000): number {
  if (a.length > cap || b.length > cap) {
    // 超长文本用字符级 Levenshtein 会爆内存——退化为逐块比较
    return blockDistance(a, b)
  }
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = new Array<number>(cols)
  for (let col = 0; col < cols; col += 1) previous[col] = col
  for (let row = 1; row < rows; row += 1) {
    const current = new Array<number>(cols)
    current[0] = row
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      current[col] = Math.min(
        current[col - 1]! + 1,     // 插入
        previous[col]! + 1,        // 删除
        previous[col - 1]! + cost, // 替换
      )
    }
    previous = current
  }
  return previous[cols - 1]!
}

/** 超长文本的块级近似距离（按 64 字符块比较）。 */
function blockDistance(a: string, b: string): number {
  const blockSize = 64
  const blocksA: string[] = []
  const blocksB: string[] = []
  for (let i = 0; i < a.length; i += blockSize) blocksA.push(a.slice(i, i + blockSize))
  for (let i = 0; i < b.length; i += blockSize) blocksB.push(b.slice(i, i + blockSize))
  let distance = 0
  const max = Math.max(blocksA.length, blocksB.length)
  for (let i = 0; i < max; i += 1) {
    const ba = blocksA[i] ?? ''
    const bb = blocksB[i] ?? ''
    distance += ba === bb ? 0 : Math.max(ba.length, bb.length)
  }
  return distance
}

/** 组装修订结果。 */
export function buildRevisionResult(mode: RevisionMode, chapterNo: number, original: string, revised: string, now: string): RevisionResult {
  const { wordDelta, changeRatio } = diffStats(original, revised)
  return {
    mode,
    chapterNo,
    original,
    revised,
    wordDelta,
    changeRatio,
    changed: revised !== original,
    revisedAt: now,
  }
}
