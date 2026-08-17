import { describe, expect, it } from 'vitest'
import { buildWritePrompt } from '../src/core/write-prompt.ts'
import type { Book } from '../src/core/novel/index.ts'
import type { ContextPacket } from '../src/core/context/index.ts'

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

function makePacket(): ContextPacket {
  return {
    bookId: 'bk_1',
    chapterNo: 1,
    projectBrief: '《青云问道》玄幻',
    style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] },
    currentBrief: '林远夜练剑遇赵无极',
    volumeOutline: '第一卷：外门风云',
    prevChapters: [],
    prevSummaries: [],
    loreInjection: {
      scope: 'lorebook', prepend: [], append: [], atDepth: [], tokenEstimate: 0, truncated: [],
      renderedPrepend: '', renderedAppend: '<worldbook>\n<entry name="林远">\n炼气七层\n</entry>\n</worldbook>',
      builtAt: 't',
    },
    constraints: ['本章目标字数 2000-4000', '章末必须留有钩子'],
    tokenEstimate: 0,
    truncatedInfo: [],
  }
}

describe('write-prompt — assembly', () => {
  it('assembles a complete writing instruction', () => {
    const prompt = buildWritePrompt(makeBook(), makePacket())
    expect(prompt).toContain('《青云问道》')
    expect(prompt).toContain('第 1 章')
    expect(prompt).toContain('林远夜练剑遇赵无极')
    expect(prompt).toContain('外门风云')
    expect(prompt).toContain('林远')
    expect(prompt).toContain('2000-4000')
    expect(prompt).toContain('直接输出本章正文')
  })

  it('omits empty sections', () => {
    const packet = makePacket()
    packet.volumeOutline = ''
    packet.loreInjection.renderedAppend = ''
    const prompt = buildWritePrompt(makeBook(), packet)
    expect(prompt).not.toContain('本卷细纲')
    expect(prompt).not.toContain('【设定】')
  })
})
