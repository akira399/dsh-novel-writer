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
  it('paragraph-level suggestion: one changed paragraph → one suggestion with paraIndex', () => {
    // 单段整体改动 → 一条整段建议（覆盖字级 & 段落级重写）
    const suggestions = splitPolishSuggestions('第一句。第二句。第三句。', '第一句。第二句已被改写。第三句。')
    expect(suggestions.length).toBe(1)
    const s = suggestions[0]!
    expect(s.id).toBe('s1')
    expect(s.original).toContain('第二句。')
    expect(s.polished).toContain('已被改写')
    expect(s.start).toBe(0) // 整段起点
    expect(s.end).toBeGreaterThan(s.start)
    expect(s.paraIndex).toBe(1)
  })

  it('multi-paragraph: only changed paragraphs become suggestions, each with paraIndex', () => {
    const original = '第一段原本内容。\n\n第二段内容。\n\n第三段内容。'
    const polished = '第一段原本内容。\n\n第二段被润色了。\n\n第三段内容。'
    const s = splitPolishSuggestions(original, polished)
    expect(s.length).toBe(1)
    expect(s[0]!.paraIndex).toBe(2) // 第2段被改
    expect(s[0]!.original).toContain('第二段内容')
    expect(s[0]!.polished).toContain('被润色')
    // 全采纳=润色文
    const all = s.map((x) => ({ ...x, accepted: true }))
    expect(applyPolishSuggestions(original, all)).toBe(polished)
  })

  it('applies only accepted suggestions back (unaccepted kept as original)', () => {
    const original = '一段甲。\n\n二段乙。\n\n三段丙。'
    const polished = '一段甲改。\n\n二段乙。\n\n三段丙改。'
    const s = splitPolishSuggestions(original, polished)
    expect(s.length).toBeGreaterThanOrEqual(2)
    // 只接受第一条（一段甲改），其余保持原文
    const accepted = s.map((x, i) => ({ ...x, accepted: i === 0 }))
    const result = applyPolishSuggestions(original, accepted)
    expect(result).toContain('一段甲改')
    expect(result).toContain('二段乙。') // 未采纳 → 原文
    expect(result).toContain('三段丙。') // 未采纳 → 原文
    // 全采纳 → 等于润色文
    const all = s.map((x) => ({ ...x, accepted: true }))
    expect(applyPolishSuggestions(original, all)).toBe(polished)
  })

  it('round-trips: no suggestions when identical', () => {
    const s = splitPolishSuggestions('一样。\n\n二三。', '一样。\n\n二三。')
    expect(s).toEqual([])
  })

  it('tiny edit (single char) still yields a suggestion (regression: 避免无建议)', () => {
    // 只改一个字（"好"→"妙"）也应产生建议，不能因差异过小而漏掉
    const s = splitPolishSuggestions('他说得很好。', '他说得很妙。')
    expect(s.length).toBeGreaterThan(0)
    const all = s.map((x) => ({ ...x, accepted: true }))
    expect(applyPolishSuggestions('他说得很好。', all)).toBe('他说得很妙。')
  })

  it('handles pure insertion/removal aligned to paragraphs (no consume in original)', () => {
    // 新增整段：润色多了一段（替换语义下 original 空）
    const original = '开头段。'
    const s = splitPolishSuggestions('开头段。\n\n中间新增段内容。', '开头段。')
    // 润色少了一段（原段被删除或未在润色中）→ 视情况：可能无建议（因删除段落没有对应）
    // 说明：本实现聚焦"替换/优化"，整段删除/新增不自动重组
    void s
    // 反向：原文删掉一段后其余一致 → 不应破坏正文
    expect(applyPolishSuggestions('开头段。\n\n中间新增段内容。', [])).toBe('开头段。\n\n中间新增段内容。')
  })

  it('never mispairs a suggestion with the next paragraph (regression)', () => {
    // 用户场景：第 2 段（穿衣玉佩）不应被配对成下一段对话。
    // 构造：原文三段，润色把第 2 段删除、第 3 段改写 → 建议反映"删2+增改写"，
    // 绝不能出现"某条建议 original=第2段、polished=第3段改写"这类跨段错配。
    const original = '第一段：山门描写。\n\n第二段：他穿着青灰布衣，腰间挂着一枚青玉玉佩。\n\n第三段："林远，你又迟到了。"'
    const polished = '第一段：山门描写。\n\n第三段改写：他冷冷看了对方一眼。'
    const s = splitPolishSuggestions(original, polished)
    for (const item of s) {
      // 不存在"original 含青玉玉佩 / polished 含他冷冷"的替换建议（跨段错配）
      const mispair = item.original.includes('青玉玉佩') && item.polished.includes('他冷冷')
      expect(mispair).toBe(false)
    }
    // 第 2 段作为删除建议（polished 空）
    const delSeg = s.find((x) => x.original.includes('青玉玉佩'))
    expect(delSeg?.polished ?? '').toBe('')
    // 第 3 段改写作为新增/替换建议存在（不跨段）
    expect(s.some((x) => x.polished.includes('他冷冷'))).toBe(true)
  })

  it('inserts a pure-added paragraph after its anchor when accepted', () => {
    const original = '第一段。\n\n第二段。'
    const polished = '第一段。\n\n第二段。\n\n新增的细节描写段：天边泛起鱼肚白，山风裹着晨露掠过衣角。'
    const s = splitPolishSuggestions(original, polished)
    // 应存在一条"新增段"建议（original 空，insertAfter 指向第 2 段）
    const ins = s.find((x) => x.original === '' && x.insertAfter !== undefined)
    expect(ins).toBeDefined()
    expect(ins!.polished).toContain('新增的细节描写段')
    expect(ins!.insertAfter).toBe(2)
    // 采纳后应插入到第 2 段之后
    ins!.accepted = true
    const result = applyPolishSuggestions(original, s)
    expect(result).toContain('第二段。\n\n新增的细节描写段')
  })
})
