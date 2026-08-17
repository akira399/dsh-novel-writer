/**
 * dsh-novel-writer — 章节字数统计与达标校验（模块 5）。
 *
 * 职责：对章节正文做纯函数统计（无 IO、无 cordis 依赖），供：
 *  - novel_write_chapter / novel_commit 提交时自动落盘（P1 接线）；
 *  - GUI 章节列表徽标与统计面板（P2 接线）；
 *  - novel_wordcount 工具（模块 6 注册）。
 * 统计口径（对齐主流网文平台习惯）：
 *  - 主口径 totalChars = 全部字符（含标点与空白）；
 *  - 辅助口径 cjkChars = Unicode CJK 区段字符数；
 *  - 达标判定默认用 totalChars（可切换口径）。
 */
import type { ChapterStats } from '../types.ts'

/** CJK 统一表意文字区段（含扩展 A/B 常用区）。 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 中英文句末标点（切分句子的边界）。 */
const SENTENCE_END_RE = /[。！？!?；;]/g

/** 对话引号字符（中文成对引号；ASCII " 按奇偶切换）。 */
const OPEN_QUOTES = new Set(['“', '「', '『'])
const CLOSE_QUOTES = new Set(['”', '」', '』'])

export function countChapter(text: string, chapterNo: number): ChapterStats {
  const totalChars = text.length
  let cjkChars = 0
  let paragraphs = 0
  let inQuote = false
  let quoteChars = 0
  for (const char of text) {
    if (CJK_RE.test(char)) cjkChars += 1
    if (char === '"') {
      // ASCII 双引号不区分开/闭：奇偶切换（"他说"快走"然后" 正确计对话）
      inQuote = !inQuote
      continue
    }
    if (OPEN_QUOTES.has(char)) {
      inQuote = true
      continue
    }
    if (CLOSE_QUOTES.has(char)) {
      inQuote = false
      continue
    }
    if (inQuote) quoteChars += 1
  }
  // 段落：非空行
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) paragraphs += 1
  }
  // 对话占比：成对引号内的字符数 / 总字符
  const dialogueRatio = totalChars > 0 ? Math.min(1, quoteChars / totalChars) : 0
  // 平均句长：按句末标点切分后非空句子的平均字符数
  const sentences = text.split(SENTENCE_END_RE).map((s) => s.trim()).filter((s) => s.length > 0)
  const avgSentenceLen = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
    : 0
  return {
    chapterNo,
    totalChars,
    cjkChars,
    paragraphs,
    dialogueRatio: round3(dialogueRatio),
    avgSentenceLen: round1(avgSentenceLen),
    meetsTarget: false, // 由 checkWordTarget 填充（本函数不知道目标）
  }
}

/** 达标判定（主口径 totalChars；返回实际判定结果）。 */
export function checkWordTarget(stats: ChapterStats, min: number, max: number, useCjk = false): ChapterStats {
  const count = useCjk ? stats.cjkChars : stats.totalChars
  return { ...stats, meetsTarget: count >= min && count <= max }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
