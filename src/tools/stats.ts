/**
 * dsh-novel-writer — 章节字数统计工具（模块 6）。
 * novel_wordcount：对给定正文即时统计（P0 无项目模块，直接吃文本；
 * P1 项目模块落地后扩展 chapterNo/项目读取能力）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { checkWordTarget, countChapter } from '../core/stats/index.ts'
import { jsonOutput } from './json.ts'

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerStatsTools(ctx: Context): Array<() => void> {
  return [
    ctx.tools.register(defineTool({
    name: 'novel_wordcount',
    description: '统计章节正文：总字符数（含标点，网文平台口径）、中文字符数、段落数、对话占比、平均句长；' +
      '传入 min/max 时判定是否达标。触发：字数/统计/达标。',
    parameters: {
      text: { type: 'string', required: true, description: '章节正文文本' },
      chapterNo: { type: 'number', description: '章节号（默认 0，仅用于标注）' },
      min: { type: 'number', description: '目标字数下限（与 max 同时传才判定达标）' },
      max: { type: 'number', description: '目标字数上限（与 min 同时传才判定达标）' },
      useCjk: { type: 'boolean', description: '达标判定改用中文字符数口径（默认 false=总字符）' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as { text: string; chapterNo?: number; min?: number; max?: number; useCjk?: boolean }
      let stats = countChapter(String(args.text ?? ''), args.chapterNo ?? 0)
      if (typeof args.min === 'number' && typeof args.max === 'number') {
        stats = checkWordTarget(stats, args.min, args.max, args.useCjk === true)
      }
      return asJson({ ok: true, value: stats })
    },
    isConcurrencySafe: () => true,
  })),
  ]
}
