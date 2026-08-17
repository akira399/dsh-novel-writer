/**
 * dsh-novel-writer — 写章指令组装（P3 修复）。
 * 纯函数：上下文包 → 模型写作指令。host 直写与 client 会话驱动共用。
 */
import type { Book } from './novel/types.ts'
import type { ContextPacket } from './context/types.ts'

export function buildWritePrompt(book: Book, packet: ContextPacket): string {
  const title = book.title.replace(/^《|》$/g, '')
  const parts = [
    `请为小说《${title}》撰写第 ${packet.chapterNo} 章。`,
    `【全书设定】\n${packet.projectBrief}`,
    packet.volumeOutline ? `【本卷细纲】\n${packet.volumeOutline}` : '',
    `【本章细纲】\n${packet.currentBrief || '（自由发挥）'}`,
    packet.prevChapters.length > 0 ? `【前文】\n${packet.prevChapters.map((c) => `第${c.no}章 ${c.title}：${c.text.slice(0, 600)}`).join('\n')}` : '',
    packet.prevSummaries.length > 0 ? `【更早章节摘要】\n${packet.prevSummaries.map((c) => `第${c.no}章：${c.text.slice(0, 200)}`).join('\n')}` : '',
    packet.variableSnapshot && Object.keys(packet.variableSnapshot).length > 0 ? `【当前事实快照】\n${JSON.stringify(packet.variableSnapshot)}` : '',
    packet.loreInjection.renderedPrepend ? `【设定】\n${packet.loreInjection.renderedPrepend}` : '',
    packet.loreInjection.renderedAppend ? `【设定】\n${packet.loreInjection.renderedAppend}` : '',
    packet.loreInjection.atDepth.length > 0 ? `【关键设定】\n${packet.loreInjection.atDepth.map((item) => item.entry.content).join('\n')}` : '',
    `【硬约束】\n${packet.constraints.map((c) => `- ${c}`).join('\n')}`,
    '请直接输出本章正文（约 2000-4000 字），不要解释。',
  ]
  return parts.filter(Boolean).join('\n\n')
}
