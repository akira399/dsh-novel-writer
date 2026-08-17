import { describe, expect, it } from 'vitest'
import { buildInjectionPlan } from '../src/core/lorebook/index.ts'
import type { LoreEntry, LoreGroup } from '../src/core/index.ts'

function entry(id: string, overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id, name: id, content: `内容-${id}`, keywords: [], is_regex: false, case_sensitive: false,
    always_active: false, enabled: true, priority: 50, scan_depth: 0,
    inject_target: 'system', inject_position: 'append', insertion_depth: 0,
    book_id: '', tags: [], version: 1, created_at: 't', updated_at: 't', ...overrides,
  }
}

function group(id: string, overrides: Partial<LoreGroup> = {}): LoreGroup {
  return { id, name: id, entry_ids: [], book_ids: [], enabled: true, created_at: 't', updated_at: 't', ...overrides }
}

const base = { scope: 'lorebook' as const, scanText: '林远来到青云宗', budget: 100000 }

describe('injector — filtering', () => {
  it('excludes disabled entries and entries in disabled groups', () => {
    const entries = [entry('e1', { always_active: true }), entry('e2', { always_active: true, enabled: false })]
    const groups = [group('g1', { entry_ids: ['e3'], enabled: false }), group('g2', { entry_ids: ['e4'] })]
    const e3 = entry('e3', { always_active: true })
    const e4 = entry('e4', { always_active: true })
    const plan = buildInjectionPlan([...entries, e3, e4], groups, base)
    expect(plan.prepend.concat(plan.append).map((e) => e.id).sort()).toEqual(['e1', 'e4'])
    expect(plan.truncated.filter((t) => t.reason === 'disabled-group')).toHaveLength(1)
  })

  it('applies book binding at entry and group level', () => {
    const entries = [
      entry('global', { always_active: true }),
      entry('bound', { always_active: true, book_id: 'bk_a' }),
      entry('other', { always_active: true, book_id: 'bk_b' }),
    ]
    const groups = [group('g', { entry_ids: ['grouped'], book_ids: ['bk_a'] })]
    const grouped = entry('grouped', { always_active: true })
    const plan = buildInjectionPlan([...entries, grouped], groups, { ...base, bookId: 'bk_a' })
    const ids = plan.prepend.concat(plan.append).map((e) => e.id).sort()
    expect(ids).toEqual(['bound', 'global', 'grouped'])
    expect(plan.truncated.filter((t) => t.reason === 'book-mismatch').map((t) => t.entry.id)).toEqual(['other'])
  })
})

describe('injector — routing', () => {
  it('routes always-active by position', () => {
    const plan = buildInjectionPlan([
      entry('front', { always_active: true, inject_position: 'prepend' }),
      entry('back', { always_active: true, inject_position: 'append' }),
    ], [], base)
    expect(plan.prepend.map((e) => e.id)).toEqual(['front'])
    expect(plan.append.map((e) => e.id)).toEqual(['back'])
  })

  it('routes keyword hits by target/position and forces at_depth for assistant', () => {
    const plan = buildInjectionPlan([
      entry('sys', { keywords: ['林远'], inject_position: 'prepend' }),
      entry('user', { keywords: ['青云宗'], inject_target: 'user' }),
      entry('asst', { keywords: ['来到'], inject_target: 'assistant' }),
    ], [], base)
    expect(plan.prepend.map((e) => e.id)).toEqual(['sys'])
    expect(plan.append.map((e) => e.id)).toEqual(['user'])
    expect(plan.atDepth.map((d) => d.entry.id)).toEqual(['asst'])
  })

  it('does not include keyword entries with no hit', () => {
    const plan = buildInjectionPlan([entry('nohit', { keywords: ['不存在'] })], [], base)
    expect(plan.prepend).toEqual([])
    expect(plan.append).toEqual([])
  })

  it('respects scan_depth over history texts', () => {
    const deep = entry('deep', { keywords: ['旧事'], scan_depth: 2 })
    // 最近 2 条历史含「旧事」→ 命中
    const plan = buildInjectionPlan([deep], [], {
      ...base,
      scanText: '无关',
      historyTexts: ['一', '二', '三旧事'],
    })
    expect(plan.append.map((e) => e.id)).toEqual(['deep'])
    // 最近 2 条历史不含「旧事」→ 不命中
    const plan2 = buildInjectionPlan([deep], [], {
      ...base,
      scanText: '无关',
      historyTexts: ['一旧事', '二', '三'],
    })
    expect(plan2.append.map((e) => e.id)).toEqual([])
  })

  it('sorts by priority descending', () => {
    const plan = buildInjectionPlan([
      entry('low', { always_active: true, priority: 10 }),
      entry('high', { always_active: true, priority: 90 }),
    ], [], base)
    expect(plan.append.map((e) => e.id)).toEqual(['high', 'low'])
  })
})

describe('injector — budget', () => {
  it('truncates entries beyond the budget with reason', () => {
    const plan = buildInjectionPlan([
      entry('big1', { always_active: true, content: '字'.repeat(200), priority: 100 }),
      entry('big2', { always_active: true, content: '字'.repeat(200), priority: 90 }),
    ], [], { ...base, budget: 300 })
    expect(plan.append.map((e) => e.id)).toEqual(['big1'])
    expect(plan.truncated.filter((t) => t.reason === 'budget').map((t) => t.entry.id)).toEqual(['big2'])
  })

  it('budget 0 disables truncation', () => {
    const plan = buildInjectionPlan([
      entry('a', { always_active: true, content: '字'.repeat(500) }),
      entry('b', { always_active: true, content: '字'.repeat(500) }),
    ], [], { ...base, budget: 0 })
    expect(plan.append).toHaveLength(2)
    expect(plan.truncated).toHaveLength(0)
  })
})

describe('injector — rendering', () => {
  it('builds the worldbook XML wrapper', () => {
    const plan = buildInjectionPlan([entry('e1', { always_active: true, content: '正文' })], [], base)
    expect(plan.renderedAppend).toBe('<worldbook>\n<entry name="e1">\n正文\n</entry>\n</worldbook>')
    expect(plan.renderedPrepend).toBe('')
  })

  it('renders variable and name macros', () => {
    const plan = buildInjectionPlan([
      entry('e1', { always_active: true, content: '{{char}}修为{{getvar::stat_data.境界}}' }),
    ], [], {
      ...base,
      charName: '林远',
      userName: '我',
      variableContext: {
        localVariables: { stat_data: { 境界: '筑基' } },
        bookVariables: {},
        globalVariables: {},
      },
    })
    expect(plan.renderedAppend).toContain('林远修为筑基')
  })

  it('escapes attribute quotes in entry names', () => {
    const plan = buildInjectionPlan([entry('e1', { always_active: true, name: 'a"b' })], [], base)
    expect(plan.renderedAppend).toContain('name="a&quot;b"')
  })

  it('token estimate is positive for non-empty plans', () => {
    const plan = buildInjectionPlan([entry('e1', { always_active: true, content: '字'.repeat(20) })], [], base)
    expect(plan.tokenEstimate).toBeGreaterThan(0)
  })
})
