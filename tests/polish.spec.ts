import { describe, expect, it } from 'vitest'
import {
  BUILTIN_AI_TASTE_WORDS,
  hitsByCategory,
  mergeDictionaries,
  scanAiTaste,
} from '../src/core/polish/index.ts'
import type { AiTasteWord } from '../src/core/polish/index.ts'

describe('polish — builtin dictionary', () => {
  it('contains 200+ words across 5 categories', () => {
    expect(BUILTIN_AI_TASTE_WORDS.length).toBeGreaterThanOrEqual(200)
    const categories = new Set(BUILTIN_AI_TASTE_WORDS.map((w) => w.category))
    expect(categories).toEqual(new Set(['connector', 'action', 'psychology', 'adjective', 'tone']))
  })

  it('has no duplicate words', () => {
    const words = BUILTIN_AI_TASTE_WORDS.map((w) => w.word)
    expect(new Set(words).size).toBe(words.length)
  })

  it('mergeDictionaries lets project overrides win and adds new words', () => {
    const override: AiTasteWord = { word: '缓缓', category: 'tone', strategy: 'delete' }
    const merged = mergeDictionaries([override])
    const slow = merged.find((w) => w.word === '缓缓')
    expect(slow?.category).toBe('tone')
    // 同词覆盖不增数
    expect(merged.length).toBe(BUILTIN_AI_TASTE_WORDS.length)
    // 新词追加
    const extended = mergeDictionaries([{ word: '测试新词', category: 'tone', strategy: 'delete' }])
    expect(extended.length).toBe(BUILTIN_AI_TASTE_WORDS.length + 1)
  })
})

describe('polish — scanner', () => {
  it('detects common AI-taste expressions with sentence context', () => {
    const text = '他缓缓抬起头，心中涌起一股暖流。'
    const report = scanAiTaste(text)
    expect(report.hits).toBeGreaterThanOrEqual(3)
    expect(report.byCategory.action).toBeGreaterThanOrEqual(1)
    expect(report.byCategory.psychology).toBeGreaterThanOrEqual(1)
    expect(report.details[0]?.sentence).toContain('他缓缓抬起头')
  })

  it('scores density by hits per thousand CJK chars', () => {
    const dense = scanAiTaste('缓缓地，他微微一笑，心中一动。'.repeat(50))
    expect(dense.score).toBeGreaterThan(0)
    expect(dense.score).toBeLessThanOrEqual(100)
    const clean = scanAiTaste('他拔出剑，剑锋映着月光，直指对手咽喉。')
    expect(clean.score).toBe(0)
    expect(clean.hits).toBe(0)
  })

  it('prefers longer words when both match (微微一笑 over 微微)', () => {
    const report = scanAiTaste('她微微一笑。')
    const hit = report.details.find((d) => d.word === '微微一笑')
    expect(hit).toBeDefined()
  })

  it('reports category distribution and supports filtering', () => {
    const text = '总而言之，他心底一沉，缓缓摇了摇头。'
    const report = scanAiTaste(text)
    expect(report.byCategory.connector).toBeGreaterThanOrEqual(1)
    expect(hitsByCategory(report, 'connector').length).toBe(report.byCategory.connector)
  })

  it('handles empty and short text', () => {
    const empty = scanAiTaste('')
    expect(empty.hits).toBe(0)
    expect(empty.score).toBe(0)
    const single = scanAiTaste('好')
    expect(single.cjkChars).toBe(1)
  })

  it('carries replacement suggestions when available', () => {
    const report = scanAiTaste('他缓缓说道')
    const hit = report.details.find((d) => d.word === '缓缓')
    expect(hit?.replacement).toBeDefined()
  })
})
