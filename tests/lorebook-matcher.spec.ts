import { describe, expect, it } from 'vitest'
import { LoreMatcher } from '../src/core/lorebook/index.ts'
import type { LoreEntry } from '../src/core/index.ts'

function entry(id: string, overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id,
    name: id,
    content: 'c',
    keywords: [],
    is_regex: false,
    case_sensitive: false,
    always_active: false,
    enabled: true,
    priority: 50,
    scan_depth: 0,
    inject_target: 'system',
    inject_position: 'append',
    insertion_depth: 0,
    book_id: '',
    tags: [],
    version: 1,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  }
}

describe('LoreMatcher — keyword matching', () => {
  it('hits on any keyword (case-insensitive by default)', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['林远', '筑基'] })])
    const hits = matcher.match('今天林远突破')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.entry.id).toBe('e1')
    expect(hits[0]?.hitKeyword).toBe('林远')
    expect(matcher.match('今天筑基成功')[0]?.hitKeyword).toBe('筑基')
    expect(matcher.match('今天LINYUAN')).toHaveLength(0)
  })

  it('respects case sensitivity', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['Sword'], case_sensitive: true })])
    expect(matcher.match('a Sword of')).toHaveLength(1)
    expect(matcher.match('a sword of')).toHaveLength(0)
  })

  it('does not match entries without keywords', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: [] })])
    expect(matcher.match('anything')).toHaveLength(0)
  })

  it('ignores disabled entries', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['k'], enabled: false })])
    expect(matcher.match('k')).toHaveLength(0)
  })

  it('matches multiple entries and dedups within one scan', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([
      entry('e1', { keywords: ['林远'] }),
      entry('e2', { keywords: ['林远', '筑基'] }),
    ])
    const hits = matcher.match('林远筑基')
    expect(hits.map((h) => h.entry.id).sort()).toEqual(['e1', 'e2'])
  })
})

describe('LoreMatcher — regex entries', () => {
  it('matches with precompiled regex keywords', () => {
    const matcher = new LoreMatcher()
    // ^林远.{0,4}$：匹配 2~6 字符
    matcher.rebuild([entry('e1', { keywords: ['^林远.{0,4}$'], is_regex: true })])
    expect(matcher.match('林远来了')).toHaveLength(1)
    expect(matcher.match('林远来了吗')).toHaveLength(1) // 5 字符，在范围内
    expect(matcher.match('林远一二三四五')).toHaveLength(0) // 7 字符，超出
    expect(matcher.match('别的')).toHaveLength(0)
  })

  it('treats every keyword as regex (not only the first)', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['^A$', '^B$'], is_regex: true })])
    expect(matcher.match('A')).toHaveLength(1)
    expect(matcher.match('B')).toHaveLength(1)
    expect(matcher.match('AB')).toHaveLength(0)
  })

  it('tolerates malformed regex by skipping the entry', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('bad', { keywords: ['(unclosed'], is_regex: true }), entry('ok', { keywords: ['k'] })])
    expect(matcher.match('k')).toHaveLength(1)
    expect(matcher.match('(unclosed')).toHaveLength(0)
  })
})

describe('LoreMatcher — incremental updates', () => {
  it('upsert adds new keywords and remove drops them', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['old'] })])
    expect(matcher.match('old')).toHaveLength(1)
    matcher.upsert(entry('e1', { keywords: ['new'] }))
    expect(matcher.match('old')).toHaveLength(0)
    expect(matcher.match('new')).toHaveLength(1)
    matcher.remove('e1')
    expect(matcher.match('new')).toHaveLength(0)
  })

  it('upsert invalidates the regex cache on change', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['^x$'], is_regex: true })])
    expect(matcher.match('x')).toHaveLength(1)
    matcher.upsert(entry('e1', { keywords: ['^y$'], is_regex: true }))
    expect(matcher.match('x')).toHaveLength(0)
    expect(matcher.match('y')).toHaveLength(1)
  })
})

describe('LoreMatcher — entryIds filter', () => {
  it('only matches entries within the allowed set', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([entry('e1', { keywords: ['k'] }), entry('e2', { keywords: ['k'] })])
    const hits = matcher.match('k', { entryIds: new Set(['e2']) })
    expect(hits.map((h) => h.entry.id)).toEqual(['e2'])
  })
})

describe('LoreMatcher — stats', () => {
  it('reports index scale', () => {
    const matcher = new LoreMatcher()
    matcher.rebuild([
      entry('e1', { keywords: ['a', 'b'] }),
      entry('e2', { keywords: ['a'], is_regex: true }),
      entry('e3', { keywords: [] }),
    ])
    const stats = matcher.stats()
    expect(stats.keywordTokens).toBe(2) // a, b
    expect(stats.regexEntries).toBe(1)
    expect(stats.totalEntries).toBe(3)
  })
})
