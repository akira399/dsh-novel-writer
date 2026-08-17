import { describe, expect, it } from 'vitest'
import { checkWordTarget, countChapter } from '../src/core/stats/index.ts'

describe('countChapter — counts', () => {
  it('counts total and CJK chars in mixed text', () => {
    const stats = countChapter('你好，world！\n第二行。', 1)
    expect(stats.totalChars).toBe(14)
    // 你好 + 第二行 = 5 CJK（逗号/感叹号/换行/world 非 CJK）
    expect(stats.cjkChars).toBe(5)
    expect(stats.paragraphs).toBe(2)
  })

  it('estimates dialogue ratio from paired quotes', () => {
    const noDialogue = countChapter('他转身离开。', 1)
    expect(noDialogue.dialogueRatio).toBe(0)
    // “你来了。” = 5 字符内 2 个引号 → 覆盖率 2/2/5=0.4（引号字符/2 再除总长）
    const withDialogue = countChapter('“你来了。”', 1)
    expect(withDialogue.dialogueRatio).toBeGreaterThan(0)
    expect(withDialogue.dialogueRatio).toBeLessThanOrEqual(1)
  })

  it('pairs ASCII double quotes by parity (regression: "只开不闭" bug)', () => {
    // 修复前：ASCII " 永远走开引号分支 → 引号后全部计为对话 → 占比拉满
    const ascii = countChapter('他说"快走"然后离开。', 1)
    expect(ascii.dialogueRatio).toBeGreaterThan(0)
    expect(ascii.dialogueRatio).toBeLessThan(0.5)
    // 无配对时按奇偶估算，不会把全文当对话
    const mixed = countChapter('"前半"他顿了顿"后半"。', 1)
    expect(mixed.dialogueRatio).toBeLessThan(0.8)
  })

  it('computes average sentence length on punctuation boundaries', () => {
    const stats = countChapter('甲。乙丙。丁戊己。', 1)
    // 3 句，长度 1/2/3，均值 2
    expect(stats.avgSentenceLen).toBe(2)
    const single = countChapter('没有标点的一整句', 1)
    expect(single.avgSentenceLen).toBe(8)
  })

  it('handles empty and whitespace-only text', () => {
    const empty = countChapter('', 1)
    expect(empty.totalChars).toBe(0)
    expect(empty.paragraphs).toBe(0)
    expect(empty.dialogueRatio).toBe(0)
    expect(empty.avgSentenceLen).toBe(0)
    const blank = countChapter('  \n  ', 1)
    expect(blank.paragraphs).toBe(0)
  })

  it('keeps chapterNo through', () => {
    expect(countChapter('x', 42).chapterNo).toBe(42)
  })
})

describe('checkWordTarget — target compliance', () => {
  it('marks meetsTarget within [min, max] on the totalChars gauge', () => {
    const stats = countChapter('一二三四五', 1) // totalChars 5
    expect(checkWordTarget(stats, 5, 10).meetsTarget).toBe(true)
    expect(checkWordTarget(stats, 6, 10).meetsTarget).toBe(false)
    expect(checkWordTarget(stats, 1, 4).meetsTarget).toBe(false)
  })

  it('can switch to the CJK gauge', () => {
    const stats = countChapter('abcde一二', 1) // total 7, cjk 2
    expect(checkWordTarget(stats, 7, 7, false).meetsTarget).toBe(true)
    expect(checkWordTarget(stats, 2, 2, true).meetsTarget).toBe(true)
    expect(checkWordTarget(stats, 7, 7, true).meetsTarget).toBe(false)
  })

  it('boundaries are inclusive', () => {
    const stats = countChapter('abc', 1)
    expect(checkWordTarget(stats, 3, 3).meetsTarget).toBe(true)
  })
})
