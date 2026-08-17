import { describe, expect, it } from 'vitest'
import { buildRevisionResult, diffStats, editDistance } from '../src/core/revision/index.ts'
import { exportBook, formatChapter, platformChapter } from '../src/core/export/index.ts'
import type { Chapter } from '../src/core/novel/index.ts'

function chapter(no: number, title: string): Chapter {
  return { no, title, status: 'draft', version: 1, words: 0, createdAt: 't', updatedAt: 't' }
}

describe('revision — diff stats', () => {
  it('computes edit distance and change ratio', () => {
    const stats = diffStats('他缓缓抬起头。', '他抬起头。')
    expect(stats.wordDelta).toBe(-2)
    expect(stats.changeRatio).toBeGreaterThan(0)
    expect(stats.changeRatio).toBeLessThan(1)
  })

  it('zero distance for identical text', () => {
    const stats = diffStats('相同文本', '相同文本')
    expect(stats.wordDelta).toBe(0)
    expect(stats.changeRatio).toBe(0)
  })

  it('handles very long text via block distance (no blowup)', () => {
    const longA = '字'.repeat(5000)
    const longB = '字'.repeat(4990) + '别'
    const distance = editDistance(longA, longB)
    expect(distance).toBeGreaterThan(0)
  })

  it('builds a revision result', () => {
    const result = buildRevisionResult('proofread', 3, '原文。', '改后。', 't')
    expect(result.mode).toBe('proofread')
    expect(result.chapterNo).toBe(3)
    expect(result.changed).toBe(true)
    expect(result.revisedAt).toBe('t')
  })
})

describe('export — formats', () => {
  it('formats a chapter per format', () => {
    expect(formatChapter(chapter(1, '少年出山'), '正文', 'txt')).toBe('少年出山\n\n正文')
    expect(formatChapter(chapter(1, '少年出山'), '正文', 'markdown')).toBe('## 第 1 章 少年出山\n\n正文')
    expect(formatChapter(chapter(1, '少年出山'), '正文', 'platform')).toBe('少年出山\n\n正文')
  })

  it('exports a full book with title and volume separators', () => {
    const items = [
      { chapter: chapter(1, '第一章 第一卷 少年出山'), content: '正文一' },
      { chapter: chapter(2, '第二章 第一卷 初露锋芒'), content: '正文二' },
      { chapter: chapter(3, '第三章 第二卷 风起'), content: '正文三' },
    ]
    const book = exportBook(items, { format: 'txt', title: '青云问道', author: '某作者', splitVolumes: true })
    expect(book).toContain('青云问道')
    expect(book).toContain('作者：某作者')
    expect(book).toContain('===== 第一卷 =====')
    expect(book).toContain('===== 第二卷 =====')
    // 卷头只出现一次
    expect(book.split('===== 第一卷 =====').length).toBe(2)
  })

  it('platform format strips markdown symbols', () => {
    expect(platformChapter(chapter(1, '第一章'), '**正文**')).toBe('第一章\n**正文**')
  })
})
