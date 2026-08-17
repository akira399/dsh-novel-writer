import { describe, expect, it } from 'vitest'
import {
  clampInt,
  estimateTokens,
  newId,
  normalizeKeywords,
  normalizeNumber,
  nowIso,
} from '../src/core/index.ts'
import type { LoreEntry, PluginError, Result } from '../src/core/index.ts'

describe('core util — newId', () => {
  it('generates ids with the expected prefix and shape', () => {
    const id = newId('wb')
    expect(id).toMatch(/^wb_[a-z0-9]+_[a-z0-9]{6}$/)
  })

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId('wb')))
    expect(ids.size).toBe(100)
  })

  it('keeps different prefixes distinct', () => {
    expect(newId('wb').startsWith('wb_')).toBe(true)
    expect(newId('wg').startsWith('wg_')).toBe(true)
  })
})

describe('core util — normalizeKeywords', () => {
  it('splits on Chinese and ASCII commas, trims, drops empties', () => {
    expect(normalizeKeywords(' 林远 ，筑基, 丹师,,  ')).toEqual(['林远', '筑基', '丹师'])
  })

  it('accepts string arrays and dedups nothing (preserves order)', () => {
    expect(normalizeKeywords(['a', ' b ', '', 'a'])).toEqual(['a', 'b', 'a'])
  })

  it('handles null/undefined/empty', () => {
    expect(normalizeKeywords(undefined)).toEqual([])
    expect(normalizeKeywords(null)).toEqual([])
    expect(normalizeKeywords('')).toEqual([])
  })
})

describe('core util — normalizeNumber / clampInt', () => {
  it('falls back on invalid input', () => {
    expect(normalizeNumber('abc', 50)).toBe(50)
    expect(normalizeNumber(undefined, 50)).toBe(50)
    expect(normalizeNumber(NaN, 50)).toBe(50)
    expect(normalizeNumber('42', 50)).toBe(42)
  })

  it('clamps to integer bounds', () => {
    expect(clampInt(10, 0, 5)).toBe(5)
    expect(clampInt(-1, 0, 5)).toBe(0)
    expect(clampInt(3.7, 0, 5)).toBe(3)
    expect(clampInt(NaN, 0, 5)).toBe(0)
  })
})

describe('core util — estimateTokens / nowIso', () => {
  it('counts CJK as 1 token per char and others as 4 chars per token', () => {
    // 4 CJK(1/字) + 4 ASCII(ceil(4/4)=1) = 5
    expect(estimateTokens('abcd你好世界')).toBe(5)
    // 全部 ASCII：8 字符 = 2 token
    expect(estimateTokens('abcdefgh')).toBe(2)
    // 全部 CJK：每字 1 token
    expect(estimateTokens('你好世界')).toBe(4)
    // 空串
    expect(estimateTokens('')).toBe(0)
  })

  it('produces sortable ISO timestamps', () => {
    const a = nowIso()
    const b = nowIso()
    expect(a.localeCompare(b)).toBeLessThanOrEqual(0)
    expect(Number.isNaN(Date.parse(a))).toBe(false)
  })
})

describe('core types — contract shapes', () => {
  it('LoreEntry fixture satisfies the contract', () => {
    const entry: LoreEntry = {
      id: newId('wb'),
      name: '筑基',
      content: '林远，筑基三层。',
      keywords: ['林远'],
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
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    expect(entry.id).toMatch(/^wb_/)
    expect(entry.priority).toBe(50)
  })

  it('Result union discriminates on ok', () => {
    const ok: Result<string> = { ok: true, value: 'x' }
    const err: Result<string> = { ok: false, error: { code: 'ENTRY_NOT_FOUND', message: 'nope' } as PluginError }
    expect(ok.ok).toBe(true)
    expect(err.ok).toBe(false)
    if (err.ok === false) expect(err.error.code).toBe('ENTRY_NOT_FOUND')
  })
})
