import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES, validateChapter } from '../src/core/validation/index.ts'
import type { ValidationContext } from '../src/core/validation/index.ts'
import type { Book } from '../src/core/novel/index.ts'

function makeBook(): Book {
  return {
    id: 'bk_1', title: '青云问道', genre: 'fantasy', status: 'drafting',
    config: {
      title: '青云问道', genre: 'fantasy',
      wordTargets: { perChapterMin: 2000, perChapterMax: 4000 },
      style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] },
      phaseGating: true,
    },
    phases: {} as never,
    currentPhase: 'writing',
    stats: { totalWords: 0, chapterCount: 0 },
    createdAt: 't', updatedAt: 't', schemaVersion: 1,
  }
}

function ctxOf(overrides: Partial<ValidationContext>): ValidationContext {
  return {
    book: makeBook(),
    chapterNo: 1,
    title: '第一章 少年出山',
    text: '',
    ...overrides,
  }
}

/** 达标正文：2200+ 字、对话充分、章末钩子。 */
function goodText(): string {
  const parts: string[] = []
  for (let i = 0; i < 45; i += 1) {
    parts.push('林远握紧剑柄，怒视对手，喝道：“来战！今日便分个高下，我林远绝不后退半步，若我胜，你当众认错！”')
  }
  return parts.join('\n') + '\n突然，一道黑影掠过——赵无极竟在这里！'
}

describe('validation — structure family', () => {
  it('passes a compliant chapter', () => {
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText() }))
    expect(report.passed).toBe(true)
  })

  it('flags short chapters as error and long ones as warning', () => {
    const short = validateChapter(BUILTIN_RULES, ctxOf({ text: '林远拔剑。' }))
    const issue = short.issues.find((i) => i.rule === 'structure.wordcount')
    expect(issue?.level).toBe('error')

    const long = validateChapter(BUILTIN_RULES, ctxOf({ text: '字'.repeat(5000) }))
    const longIssue = long.issues.find((i) => i.rule === 'structure.wordcount')
    expect(longIssue?.level).toBe('warning')
  })

  it('flags empty and format-laden titles', () => {
    const empty = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText(), title: '' }))
    expect(empty.issues.some((i) => i.rule === 'structure.title' && i.level === 'error')).toBe(true)
    const markdown = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText(), title: '# 第一章' }))
    expect(markdown.issues.some((i) => i.rule === 'structure.title' && i.level === 'warning')).toBe(true)
  })
})

describe('validation — content family', () => {
  it('flags forbidden words', () => {
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText() + '他使用了禁术。', forbiddenWords: ['禁术'] }))
    expect(report.issues.some((i) => i.rule === 'content.forbidden')).toBe(true)
  })

  it('flags AI taste density', () => {
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text: '他缓缓抬起头，心中涌起一股暖流，微微笑了笑。' }))
    expect(report.issues.some((i) => i.rule === 'content.aiTaste')).toBe(true)
  })

  it('flags pov drift', () => {
    // 第三人称设定 + 「我」高频（第一人称句大量出现）
    const first = validateChapter(BUILTIN_RULES, ctxOf({ text: '我独自走在路上。'.repeat(6) }))
    expect(first.issues.some((i) => i.rule === 'content.pov')).toBe(true)
  })

  it('flags excessive dialogue', () => {
    const text = Array.from({ length: 40 }, () => '“这句话真的很长很长很长很长很长很长很长很长很长。”').join('\n')
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text }))
    expect(report.issues.some((i) => i.rule === 'content.dialogue')).toBe(true)
  })
})

describe('validation — plot family', () => {
  it('flags missing hooks as error', () => {
    const text = '字'.repeat(200) + '他回到了住处，洗漱后躺下。'
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text }))
    expect(report.issues.some((i) => i.rule === 'plot.hook' && i.level === 'error')).toBe(true)
  })

  it('flags brief coverage gaps', () => {
    const text = goodText()
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text, brief: '林远与丹霞真人切磋炼丹，赵无极暗中下毒，丹炉炸裂' }))
    // 细纲关键词「炼丹/丹炉/毒」均未出现 → 覆盖不足
    expect(report.issues.some((i) => i.rule === 'plot.briefCoverage')).toBe(true)
  })

  it('passes brief coverage when key elements appear', () => {
    const text = goodText() + '他来到丹房，请丹霞真人指点炼丹，炉火正旺。'
    const report = validateChapter(BUILTIN_RULES, ctxOf({ text, brief: '林远到丹房向丹霞真人请教炼丹' }))
    expect(report.issues.some((i) => i.rule === 'plot.briefCoverage')).toBe(false)
  })
})

describe('validation — engine behavior', () => {
  it('is pure and stable across runs', () => {
    const a = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText() }))
    const b = validateChapter(BUILTIN_RULES, ctxOf({ text: goodText() }))
    expect(a.passed).toBe(b.passed)
    expect(a.issues.length).toBe(b.issues.length)
  })

  it('surfaces rule exceptions as internal error issues (not silent)', () => {
    const broken: typeof BUILTIN_RULES = [{ id: 'broken', family: 'plot', level: 'error', run: () => { throw new Error('boom') } }]
    const report = validateChapter(broken, ctxOf({ text: goodText() }))
    expect(report.passed).toBe(false)
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]?.rule).toBe('internal.broken')
    expect(report.issues[0]?.level).toBe('error')
  })
})
