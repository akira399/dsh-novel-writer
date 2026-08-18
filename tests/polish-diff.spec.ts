import { describe, expect, it } from 'vitest'
import {
  applyPolishSuggestions,
  countDiffChanges,
  diffChars,
  diffSentences,
  splitPolishSuggestions,
  splitSentences,
} from '../src/core/polish/index.ts'

describe('polish/diff — splitSentences', () => {
  it('splits by sentence enders (enders as own tokens)', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句', '。', '第二句', '！', '第三句', '？'])
  })

  it('keeps newlines as separators', () => {
    expect(splitSentences('第一行\n\n第二行')).toEqual(['第一行', '\n\n', '第二行'])
  })

  it('handles empty and ascii punctuation', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('Hi! Bye?')).toEqual(['Hi', '!', ' Bye', '?'])
  })
})

describe('polish/diff — diffSentences', () => {
  it('identical text yields all same chunks and joins back intact', () => {
    const chunks = diffSentences('原文第一句。\n原文第二句。', '原文第一句。\n原文第二句。')
    expect(chunks.every((c) => c.type === 'same')).toBe(true)
    expect(chunks.map((c) => c.text).join('')).toBe('原文第一句。\n原文第二句。')
  })

  it('a changed sentence becomes del + add (标点单独 token 不受影响)', () => {
    const chunks = diffSentences('第一句。第二句。第三句。', '第一句。第二句已被润色。第三句。')
    const dels = chunks.filter((c) => c.type === 'del').map((c) => c.text)
    const adds = chunks.filter((c) => c.type === 'add').map((c) => c.text)
    expect(dels).toEqual(['第二句'])
    expect(adds).toEqual(['第二句已被润色'])
    // 句末标点作为 same 保留（未受影响）
    expect(chunks.filter((c) => c.type === 'same').map((c) => c.text)).toContain('。')
  })

  it('insertion is an add chunk', () => {
    const chunks = diffSentences('第一句。', '第一句。新插入的句子。')
    expect(chunks.filter((c) => c.type === 'add').map((c) => c.text)).toEqual(['新插入的句子', '。'])
    expect(chunks.filter((c) => c.type === 'same').length).toBeGreaterThan(0)
  })

  it('deletion is a del chunk', () => {
    const chunks = diffSentences('第一句。要删的句子。第三句。', '第一句。第三句。')
    expect(chunks.filter((c) => c.type === 'del').map((c) => c.text)).toEqual(['要删的句子', '。'])
  })

  it('replacement pair renders as del-then-add (旧→新 顺序)', () => {
    const chunks = diffSentences('甲。\n\n乙。', '甲。\n\n丙。')
    const types = chunks.filter((c) => c.type !== 'same').map((c) => `${c.type}:${c.text}`)
    expect(types).toEqual(['del:乙', 'add:丙'])
    // 拼接 = 原文 + 替换后内容（乙丙相邻即"乙被替换为丙"）
    expect(chunks.map((c) => c.text).join('')).toBe('甲。\n\n乙丙。')
  })

  it('preserves full content across the diff (两侧可无损还原)', () => {
    const original = '他深吸一口气。\n\n林远望向远处的山门。\n"走吧。"他轻声说。'
    const polished = '他缓缓吸了一口气，平复翻涌的心绪。\n\n林远抬眼望向远处巍峨的山门。\n"走吧。"他低声道。'
    const chunks = diffSentences(original, polished)
    // same+del = 原文；same+add = 润色文（标准 diff 不变式）
    expect(chunks.filter((c) => c.type !== 'add').map((c) => c.text).join('')).toBe(original)
    expect(chunks.filter((c) => c.type !== 'del').map((c) => c.text).join('')).toBe(polished)
    expect(chunks.some((c) => c.type === 'del')).toBe(true)
    expect(chunks.some((c) => c.type === 'add')).toBe(true)
    expect(chunks.some((c) => c.type === 'same')).toBe(true)
  })

  it('huge text degrades to whole-block comparison (no DP blowup)', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `句子${i}。`).join('')
    const chunks = diffSentences(big, big + '追加一句。')
    expect(chunks.length).toBeLessThanOrEqual(3)
    expect(chunks.some((c) => c.type === 'add')).toBe(true)
  })

  it('countDiffChanges counts adds and dels', () => {
    const chunks = diffSentences('一。二。三。', '一。贰。三。四。')
    const counts = countDiffChanges(chunks)
    expect(counts).toEqual({ adds: 3, dels: 1 })
  })
})

describe('polish/diff — 字级 diff（diffChars）', () => {
  it('identical text → all same, joins back', () => {
    const chunks = diffChars('他说得很好。', '他说得很好。')
    expect(chunks.every((c) => c.type === 'same')).toBe(true)
    expect(chunks.map((c) => c.text).join('')).toBe('他说得很好。')
  })

  it('two-char change is pinpointed, not sentence-wide', () => {
    const chunks = diffChars('他说得很好。', '他说得真好。')
    const dels = chunks.filter((c) => c.type === 'del').map((c) => c.text).join('')
    const adds = chunks.filter((c) => c.type === 'add').map((c) => c.text).join('')
    expect(dels).toBe('很') // 只标出被改的那个字
    expect(adds).toBe('真')
  })

  it('replacement pair renders del before add (同序)', () => {
    const chunks = diffChars('甲。', '乙。')
    const types = chunks.filter((c) => c.type !== 'same').map((c) => `${c.type}:${c.text}`)
    expect(types).toEqual(['del:甲', 'add:乙'])
  })

  it('huge text degrades to whole-block (no DP blowup)', () => {
    const big = '字'.repeat(6000)
    const chunks = diffChars(big, big + '尾')
    expect(chunks.length).toBeLessThanOrEqual(2)
    expect(chunks.some((c) => c.type === 'add')).toBe(true)
  })
})

describe('polish/diff — 逐条建议拆分与重组', () => {
  it('splits replacement segments into individual suggestions with positions', () => {
    // "第二句。" 被替换：diff 应产生一条建议，位置指向原文该句
    const suggestions = splitPolishSuggestions('第一句。第二句。第三句。', '第一句。第二句已被改写。第三句。')
    expect(suggestions.length).toBe(1)
    const s = suggestions[0]!
    expect(s.id).toBe('s1')
    expect(s.original.length).toBeGreaterThan(0)
    expect(s.polished).toContain('已被改写')
    expect(s.start).toBe('第一句。'.length)
    expect(s.end).toBeGreaterThan(s.start)
  })

  it('applies only accepted suggestions back (unaccepted kept as original)', () => {
    const original = '甲。乙。丙。'
    const polished = '甲。乙改。丙改。'
    const s = splitPolishSuggestions(original, polished)
    // 逐条采纳：只接受第一条
    const accepted = s.map((x, i) => ({ ...x, accepted: i === 0 }))
    const result = applyPolishSuggestions(original, accepted)
    expect(result).toContain('乙改')
    expect(result).toContain('丙。') // 第二条未采纳 → 原文
    // 全采纳 → 等于润色文
    const all = s.map((x) => ({ ...x, accepted: true }))
    expect(applyPolishSuggestions(original, all)).toBe(polished)
  })

  it('round-trips: no suggestions when identical', () => {
    const s = splitPolishSuggestions('一样。', '一样。')
    expect(s).toEqual([])
  })

  it('handles pure insertion suggestion (no consume in original)', () => {
    const original = '开头。'
    const s = splitPolishSuggestions('开头。', '新开头。')
    const insertion = s.find((x) => x.original === '')
    if (insertion) {
      insertion.accepted = true
      expect(applyPolishSuggestions(original, s)).toBe('新开头。')
    } else {
      // 若插入被并入其他建议，则全采纳应还原为润色文
      const all = s.map((x) => ({ ...x, accepted: true }))
      expect(applyPolishSuggestions(original, all)).toBe('新开头。')
    }
  })
})
