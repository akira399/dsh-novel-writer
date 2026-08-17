import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aggregateVolumeSummaries,
  detectLedgerConflicts,
  detectTimelineAnomalies,
  LedgerStore,
  normalizeBookTime,
  suggestSediment,
  TimelineStore,
} from '../src/core/consistency/index.ts'
import type { LedgerEntry, TimelineEvent } from '../src/core/consistency/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function freshLedger(): Promise<LedgerStore> {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-'))
  roots.push(dir)
  return new LedgerStore(join(dir, 'ledger.json'))
}

describe('consistency — ledger store', () => {
  it('applies chapter JSON patches into ledger entries', async () => {
    const ledger = await freshLedger()
    const text = '<JSONPatch>[{"op":"replace","path":"/stat_data/林远/境界","value":"筑基"},{"op":"replace","path":"/stat_data/林远/灵石","value":100}]</JSONPatch>'
    const added = await ledger.applyChapterPatch('bk_1', 5, text)
    expect(added).toBe(2)
    const entries = await ledger.all()
    expect(entries[0]).toMatchObject({ entity: '林远', field: '境界', value: '筑基', chapterNo: 5 })
    // 幂等：同章重放替换不重复
    await ledger.applyChapterPatch('bk_1', 5, text)
    expect((await ledger.all()).length).toBe(2)
  })

  it('ignores non-replace operations and stat_root-only paths', async () => {
    const ledger = await freshLedger()
    await ledger.applyChapterPatch('bk_1', 1, '<JSONPatch>[{"op":"remove","path":"/stat_data/林远/境界"},{"op":"replace","path":"/stat_data","value":"x"}]</JSONPatch>')
    expect(await ledger.all()).toEqual([])
  })

  it('clears stale entries when a chapter drops its patch (regression: 残留事实)', async () => {
    const ledger = await freshLedger()
    const withPatch = '<JSONPatch>[{"op":"replace","path":"/stat_data/林远/境界","value":"筑基"}]</JSONPatch>'
    await ledger.applyChapterPatch('bk_1', 3, withPatch)
    expect(await ledger.all()).toHaveLength(1)
    // 作者删除 <JSONPatch> 后重写该章 → 旧条目必须清除，不得残留污染冲突检测
    await ledger.applyChapterPatch('bk_1', 3, '正文无 patch。')
    expect(await ledger.all()).toEqual([])
  })

  it('records explicit entries and queries by entity', async () => {
    const ledger = await freshLedger()
    await ledger.record({ entity: '赵无极', field: '境界', value: '筑基初期', chapterNo: 3, confidence: 'high' }, 'tool')
    const byEntity = await ledger.byEntity('赵无极')
    expect(byEntity).toHaveLength(1)
    expect(byEntity[0]?.field).toBe('境界')
  })
})

describe('consistency — conflict detection', () => {
  it('flags value overwrites with history and severity', () => {
    const entries: LedgerEntry[] = [
      { entity: '林远', field: '境界', value: '炼气九层', chapterNo: 2, confidence: 'high' },
      { entity: '林远', field: '境界', value: '筑基', chapterNo: 5, confidence: 'high' },
      { entity: '林远', field: '境界', value: '炼气九层', chapterNo: 8, confidence: 'high' }, // 回退
    ]
    const conflicts = detectLedgerConflicts(entries)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.entity).toBe('林远')
    expect(conflicts[0]?.history.map((h) => h.value)).toEqual(['炼气九层', '筑基', '炼气九层'])
    expect(conflicts[0]?.severity).toBe('warning') // 数值型回退 → warning；此处非数值 → warning
  })

  it('marks monotonic numeric growth as info', () => {
    const entries: LedgerEntry[] = [
      { entity: '林远', field: '灵石', value: '10', chapterNo: 1, confidence: 'high' },
      { entity: '林远', field: '灵石', value: '100', chapterNo: 3, confidence: 'high' },
      { entity: '林远', field: '灵石', value: '500', chapterNo: 6, confidence: 'high' },
    ]
    const conflicts = detectLedgerConflicts(entries)
    expect(conflicts[0]?.severity).toBe('info')
  })

  it('ignores single-valued fields', () => {
    const entries: LedgerEntry[] = [
      { entity: '青云宗', field: '掌门', value: '云中君', chapterNo: 1, confidence: 'high' },
    ]
    expect(detectLedgerConflicts(entries)).toEqual([])
  })
})

describe('consistency — timeline', () => {
  it('normalizes common book-time formats', () => {
    expect(normalizeBookTime('第三日')).toBe('d000003')
    expect(normalizeBookTime('第 12 天')).toBe('d000012')
    expect(normalizeBookTime('第十二日')).toBe('d000012')
    expect(normalizeBookTime('灵历 1024 年秋')).toBeNull()
    expect(normalizeBookTime('1024年3月')).toBe('y10240301')
    expect(normalizeBookTime('第 5 年')).toBe('y50000')
  })

  it('detects time regression and missing time', () => {
    const events: TimelineEvent[] = [
      { chapterNo: 1, bookTime: '第一日', event: '入门', createdAt: 't' },
      { chapterNo: 2, bookTime: '第三日', event: '练功', createdAt: 't' },
      { chapterNo: 3, bookTime: '第二日', event: '回退', createdAt: 't' }, // 倒挂
      { chapterNo: 4, bookTime: '不久之后', event: '未知', createdAt: 't' }, // 无法解析
    ]
    const issues = detectTimelineAnomalies(events)
    expect(issues.some((i) => i.kind === 'time-regression')).toBe(true)
    expect(issues.some((i) => i.kind === 'missing-time')).toBe(true)
  })

  it('does not report regression when records are out of chapter order (regression: 乱序误报)', () => {
    const events: TimelineEvent[] = [
      { chapterNo: 5, bookTime: '第五日', event: '后记', createdAt: 't1' },
      { chapterNo: 2, bookTime: '第二日', event: '先记', createdAt: 't2' },
      { chapterNo: 3, bookTime: '第三日', event: '中间', createdAt: 't3' },
    ]
    const issues = detectTimelineAnomalies(events)
    expect(issues.filter((i) => i.kind === 'time-regression')).toHaveLength(0)
  })
})

describe('consistency — sediment suggestions', () => {
  it('suggests worldbook entries for ledger entities with fields', () => {
    const entries: LedgerEntry[] = [
      { entity: '林远', field: '境界', value: '筑基', chapterNo: 2, confidence: 'high' },
      { entity: '林远', field: '佩剑', value: '青莲剑', chapterNo: 2, confidence: 'high' },
      { entity: '赵无极', field: '境界', value: '筑基初期', chapterNo: 4, confidence: 'high' },
    ]
    const suggestions = suggestSediment(entries)
    expect(suggestions.length).toBe(2)
    expect(suggestions[0]?.suggestedEntry).toContain('【林远】')
    expect(suggestions[0]?.suggestedEntry).toContain('境界：筑基')
  })
})

describe('consistency — volume summary aggregation', () => {
  it('concatenates chapter summaries with a cap', () => {
    const summaries = [{ no: 1, text: '林远入门。' }, { no: 2, text: '林远筑基。' }]
    const aggregated = aggregateVolumeSummaries(summaries)
    expect(aggregated).toContain('第1章')
    expect(aggregated).toContain('林远筑基')
    const capped = aggregateVolumeSummaries([{ no: 1, text: '字'.repeat(800) }], 200)
    expect(capped.length).toBeLessThanOrEqual(201)
    expect(capped.endsWith('…')).toBe(true)
  })
})

describe('consistency — timeline store', () => {
  it('roundtrips timeline events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tl-'))
    roots.push(dir)
    const store = new TimelineStore(join(dir, 'timeline.json'))
    await store.record({ chapterNo: 1, bookTime: '第一日', event: '入门' })
    const all = await store.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.chapterNo).toBe(1)
  })
})
