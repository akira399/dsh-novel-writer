/**
 * dsh-novel-writer — 成稿导出（P2-E）。
 * 纯函数：txt / markdown / 平台排版（标题+正文+作者的话）。
 */
import type { Chapter } from '../novel/types.ts'

export type ExportFormat = 'txt' | 'markdown' | 'platform'

export interface ExportOptions {
  format: ExportFormat
  title: string
  author?: string
  /** 平台排版时卷分隔（volume markers in titles like "第一卷"）。 */
  splitVolumes?: boolean
  /** 平台排版：作者的话（每章尾部附言）。 */
  authorNotes?: string
}

export interface ExportedChapter {
  chapter: Chapter
  content: string
}

/** 单章格式化为目标格式。 */
export function formatChapter(chapter: Chapter, content: string, format: ExportFormat): string {
  const body = content.trimEnd()
  switch (format) {
    case 'txt':
      return `${chapter.title}\n\n${body}`
    case 'markdown':
      return `## 第 ${chapter.no} 章 ${chapter.title}\n\n${body}`
    case 'platform':
      return `${chapter.title}\n\n${body}`
  }
}

/** 全书导出（章节按序拼接）。 */
export function exportBook(chapters: Array<{ chapter: Chapter; content: string }>, options: ExportOptions): string {
  const parts: string[] = []
  const titleLine = options.format === 'markdown'
    ? `# ${options.title}${options.author ? `\n\n> 作者：${options.author}` : ''}`
    : `${options.title}${options.author ? `\n作者：${options.author}` : ''}`
  parts.push(titleLine)
  parts.push('')
  let lastVolume = ''
  for (const item of chapters) {
    // 卷分隔（平台排版）：章节标题含「第 X 卷」时插入卷头
    if (options.splitVolumes) {
      const volumeMatch = /第\s*([^章]{1,8}?)\s*卷/.exec(item.chapter.title)
      const volume = volumeMatch?.[1]
      if (volume && volume !== lastVolume) {
        parts.push('')
        parts.push(`===== 第${volume}卷 =====`)
        parts.push('')
        lastVolume = volume
      }
    }
    parts.push(formatChapter(item.chapter, item.content, options.format))
    if (options.authorNotes) {
      parts.push('')
      parts.push(options.authorNotes)
    }
    parts.push('')
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** 平台投稿格式（起点/番茄风格：标题+正文，无 markdown 符号）。 */
export function platformChapter(chapter: Chapter, content: string): string {
  return `${chapter.title}\n${content.trimEnd()}`
}
