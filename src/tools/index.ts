/**
 * dsh-novel-writer — agent 工具聚合注册（P2-G 全量）。
 * 宿主装配时调用；返回聚合 disposer（settings 门禁注销用）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { NovelServices } from '../assembly.ts'
import { registerLorebookTools } from './lorebook.ts'
import { registerStatsTools } from './stats.ts'
import { registerNovelDomainTools } from './novel.ts'
import { registerPromptsTool } from './skill.ts'
import { registerGuideTools } from './guide.ts'
import { registerQualityTools } from './quality.ts'
import { registerExtrasTools } from './extras.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')

/** 注册全部工具，返回幂等聚合 disposer（重复调用安全）。 */
export function registerNovelTools(ctx: Context, deps: NovelServices): () => void {
  const disposers: Array<() => void> = []
  disposers.push(...registerLorebookTools(ctx, { lore: deps.lore }))
  disposers.push(...registerStatsTools(ctx))
  disposers.push(...registerNovelDomainTools(ctx, { novel: deps.novel }))
  disposers.push(...registerGuideTools(ctx, { novel: deps.novel }))
  disposers.push(registerPromptsTool(ctx))
  disposers.push(...registerQualityTools(ctx, { novel: deps.novel, llm: deps.llm, promptsDir: PROMPTS_DIR }))
  disposers.push(...registerExtrasTools(ctx, deps))
  let released = false
  return () => {
    if (released) return
    released = true
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 注销失败不阻断其余工具注销（记录由调用方 logger 处理）
      }
    }
  }
}
