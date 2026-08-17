/**
 * dsh-novel-writer — AI 味扫描器（P2-A）。
 * 纯函数：词库匹配 → 命中明细 + 密度评分（每千字命中数加权）。
 * 命中按「句子上下文」组织（截断 60 字），供 GUI 高亮与改写建议。
 */
import type { AiTasteCategory, AiTasteHit, AiTasteReport, AiTasteWord } from './types.ts'
import { BUILTIN_AI_TASTE_WORDS } from './dict.ts'

/** 词库合并：内置 + 项目覆盖（同词后者胜）。 */
export function mergeDictionaries(overrides: readonly AiTasteWord[] = []): AiTasteWord[] {
  const byWord = new Map<string, AiTasteWord>()
  for (const word of [...BUILTIN_AI_TASTE_WORDS, ...overrides]) {
    byWord.set(word.word, word)
  }
  return [...byWord.values()]
}

/** 匹配长度降序排序（长词优先，避免「微微」先命中「微微一笑」）。 */
function sortByLengthDesc(words: AiTasteWord[]): AiTasteWord[] {
  return [...words].sort((a, b) => b.word.length - a.word.length)
}

/** 把正文切成句子（按中英文句末标点），附带句子内绝对偏移。 */
function splitSentences(text: string): Array<{ sentence: string; start: number }> {
  const sentences: Array<{ sentence: string; start: number }> = []
  let start = 0
  let buffer = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    buffer += char
    if (char === '。' || char === '！' || char === '？' || char === '!' || char === '?' || char === '\n') {
      const trimmed = buffer.trim()
      if (trimmed) sentences.push({ sentence: trimmed, start })
      buffer = ''
      start = index + 1
    }
  }
  const tail = buffer.trim()
  if (tail) sentences.push({ sentence: tail, start })
  return sentences
}

/** 扫描文本中的 AI 味命中。 */
export function scanAiTaste(text: string, dictionary: readonly AiTasteWord[] = BUILTIN_AI_TASTE_WORDS): AiTasteReport {
  const merged = sortByLengthDesc(mergeDictionaries(dictionary === BUILTIN_AI_TASTE_WORDS ? [] : dictionary))
  const details: AiTasteHit[] = []
  const byCategory: Record<AiTasteCategory, number> = { connector: 0, action: 0, psychology: 0, adjective: 0, tone: 0 }
  let cjkChars = 0
  for (const char of text) {
    if (/[\u4e00-\u9fff]/.test(char)) cjkChars += 1
  }

  for (const { sentence, start } of splitSentences(text)) {
    for (const word of merged) {
      let from = 0
      for (;;) {
        const index = sentence.indexOf(word.word, from)
        if (index === -1) break
        // 跳过词中词（如「心中」命中的同时「心中一动」也应命中——不跳过，都算）
        details.push({
          word: word.word,
          category: word.category,
          strategy: word.strategy,
          ...(word.replacement !== undefined ? { replacement: word.replacement } : {}),
          sentence: sentence.slice(0, 60),
          index: start + index,
        })
        byCategory[word.category] += 1
        from = index + word.word.length
      }
    }
  }

  // 密度评分：每千字命中数 ×10，上限 100
  const perThousand = cjkChars > 0 ? (details.length / cjkChars) * 1000 : 0
  const score = Math.min(100, Math.round(perThousand * 10))

  return {
    score,
    hits: details.length,
    cjkChars,
    byCategory,
    details,
    scannedAt: new Date().toISOString(),
  }
}

/** 便捷：按类别过滤报告（GUI 分类视图用）。 */
export function hitsByCategory(report: AiTasteReport, category: AiTasteCategory): AiTasteHit[] {
  return report.details.filter((hit) => hit.category === category)
}
