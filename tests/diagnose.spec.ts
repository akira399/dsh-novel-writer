import { describe, expect, it } from 'vitest'
import { diagnoseFirstChapters } from '../src/core/diagnose/index.ts'
import type { DiagnosticChapter } from '../src/core/diagnose/index.ts'

const TARGETS = { perChapterMin: 2000, perChapterMax: 4000 }

function chapter(no: number, text: string): DiagnosticChapter {
  return { no, title: `第${no}章`, text }
}

/** 生成达标样章（2200+ 字、对话占比达标、有冲突、章末钩子）。 */
function goodChapter(no: number): DiagnosticChapter {
  const paragraphs: string[] = []
  for (let i = 0; i < 45; i += 1) {
    paragraphs.push(`林远握紧剑柄，怒视对手，喝道：“来战！今日便分个高下，我林远绝不后退半步，若我胜，你当众认错！”`)
  }
  return chapter(no, paragraphs.join('\n') + '\n突然，一道黑影掠过——赵无极竟在这里！')
}

describe('diagnose — rule layer', () => {
  it('passes good chapters with a high score', () => {
    const report = diagnoseFirstChapters([goodChapter(1), goodChapter(2), goodChapter(3)], { wordTargets: TARGETS })
    expect(report.score).toBeGreaterThanOrEqual(70)
    expect(report.issues.length).toBeLessThanOrEqual(2)
    expect(report.chapters).toEqual([1, 2, 3])
  })

  it('flags missing chapter-end hooks as error', () => {
    const text = '字'.repeat(150) + '他回到了住处，洗漱后躺下，明天还要早起练功。'
    const report = diagnoseFirstChapters([chapter(1, text)], { wordTargets: TARGETS })
    const hook = report.issues.find((i) => i.rule === 'rule-hook')
    expect(hook?.severity).toBe('error')
    expect(report.dimensions['章末悬念']).toBeLessThan(100)
  })

  it('flags weak openings in chapter one', () => {
    const text = '青云宗位于东荒，创派三千年，门下弟子三千……（背景介绍）' + '字'.repeat(2000)
    const report = diagnoseFirstChapters([chapter(1, text)], { wordTargets: TARGETS })
    expect(report.issues.some((i) => i.rule === 'rule-opening')).toBe(true)
    expect(report.dimensions['开场钩子']).toBeLessThan(100)
  })

  it('flags infodump runs of long non-dialogue paragraphs', () => {
    const longLine = '这段设定说明非常长，讲述了灵气的本质与修行体系的渊源，内容详实而枯燥。'
    const text = Array.from({ length: 5 }, () => longLine.repeat(6)).join('\n') + '字'.repeat(1500)
    const report = diagnoseFirstChapters([chapter(1, text)], { wordTargets: TARGETS })
    expect(report.issues.some((i) => i.rule === 'rule-infodump')).toBe(true)
    expect(report.dimensions['设定灌输']).toBeLessThan(100)
  })

  it('flags low conflict density', () => {
    const text = Array.from({ length: 30 }, (_, i) => `他今天继续修炼，吸收灵气，巩固修为。第${i}段`).join('\n')
    const report = diagnoseFirstChapters([chapter(1, text)], { wordTargets: TARGETS })
    expect(report.issues.some((i) => i.rule === 'rule-conflict')).toBe(true)
  })

  it('flags short chapters below the word target', () => {
    const text = '林远拔剑。'
    const report = diagnoseFirstChapters([chapter(1, text)], { wordTargets: TARGETS })
    expect(report.issues.some((i) => i.rule === 'rule-wordcount')).toBe(true)
  })

  it('handles empty chapters gracefully', () => {
    const report = diagnoseFirstChapters([chapter(1, '')], { wordTargets: TARGETS })
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.issues.length).toBeGreaterThanOrEqual(0)
  })

  it('always produces a score (model-independent)', () => {
    const report = diagnoseFirstChapters([goodChapter(1)], { wordTargets: TARGETS }, 3)
    expect(typeof report.score).toBe('number')
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
    expect(report.ranAt).toBeDefined()
  })
})
