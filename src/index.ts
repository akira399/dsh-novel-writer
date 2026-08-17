/**
 * @dsh-external/dsh-novel-writer — host half entry (装配层).
 *
 * 职责边界（遵循 OPERITFORGE-MIGRATION-PLAN.md v3 §2 架构）：
 *  - 本文件只做「装配」：读配置、组合子模块、注册工具/路由/技能；
 *  - 业务纯逻辑一律落在 src/core/**（可单测、无 cordis 依赖）；
 *  - 模块按 P0→P3 逐个落地，每个模块完成后独立单测与复盘。
 *
 * 已装配（P1-F3）：
 *  - 模块 2-5：lorebook store/service/matcher + stats/wordcount
 *  - P1-A~E：workflow 状态机 / novel 存储 / 变量引擎 / 注入组装器 / 上下文包
 *  - P1-F1：NovelService（项目/流程/章节/统计/组装组合服务）
 *  - P1-F3：完整工具集（lorebook 13 + novel 8 + wordcount 1 = 22 个）
 *  - 模块 7：settings 门禁（enabled/lorebookDir 热生效）
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import z from 'schemastery'
import { LoreService, LoreStore } from './core/lorebook/index.ts'
import { NovelService, NovelStore } from './core/novel/index.ts'
import { VariableStoreFile, variablesFilePath } from './core/variables/index.ts'
import { captureRoute, createLlmClient } from './core/llm/index.ts'
import type LlmService from '@deepseek-ai/dsh-llm'
import { NovelAssembly, type NovelServices } from './assembly.ts'
import { registerWorkflowSkill } from './tools/skill.ts'
import { registerNovelRoutes } from './routes.ts'
import { syncAgentPreset } from './presets.ts'

/** 稳定插件名（与 cordis.patch.yml 的 name 一致）。 */
export const name = '@dsh-external/dsh-novel-writer'

/** 宿主服务注入：工具注册需要 tools 服务；settings 门禁需要 settings 服务。 */
export const inject = ['tools', 'settings']

export interface Config {
  /** 插件总开关（consent 门禁；默认开，GUI 可停用）。 */
  enabled: boolean
  /** 数据根目录（默认 ~/.dsh/dsh-novel-writer）。 */
  dataDir: string
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default(''),
})

function resolveDataDir(config: Config): string {
  if (config.dataDir.trim()) return config.dataDir.trim()
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'dsh-novel-writer')
}

export function apply(ctx: Context, config: Config): void {
  // LLM 路由捕获（辅助调用：去味/诊断/修订/文风）
  const route = captureRoute(ctx)
  const assembly = new NovelAssembly(ctx, {
    createServices: (dir): NovelServices => {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        mkdirSync(join(dir, 'projects'), { recursive: true, mode: 0o700 })
      } catch (error) {
        ctx.logger?.warn?.('[' + name + '] 无法创建数据目录: ' + String(error))
      }
      const loreStore = new LoreStore(join(dir, 'lorebook'))
      const novelStore = new NovelStore(join(dir, 'projects'))
      const variables = new VariableStoreFile(variablesFilePath(join(dir, 'projects')))
      const lore = new LoreService(loreStore)
      const novel = new NovelService({ store: novelStore, loreStore, variables })
      const llm = ctx.get('llm') as LlmService | undefined
      return {
        lore,
        novel,
        llm: llm ? createLlmClient(llm, route) : null,
        bookDirOf: (bookId) => novelStore.getBookDir(bookId),
      }
    },
  })

  // 技能注册（enabled 时随门禁联动；disposer 并入 teardown）
  let skillDisposer: (() => void) | null = null

  // GUI 数据路由（固定注册；未启用时 handler 返回 503）
  registerNovelRoutes(ctx, assembly)

  // settings 门禁：注册命名空间（config 为 base 层），随 scope 变化热生效。
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(settingsNamespace('dsh-novel-writer'), Config, { base: config })
    const sync = (): void => {
      const resolved = scope.get() ?? config
      const enabled = resolved.enabled !== false
      assembly.sync(enabled, resolveDataDir(resolved))
      // 技能随 enabled 联动（仿 dsh-plugin-publisher sync 模式）
      if (enabled && !skillDisposer) skillDisposer = registerWorkflowSkill(ctx)
      else if (!enabled && skillDisposer) {
        skillDisposer()
        skillDisposer = null
      }
      // agent 预设同步（enabled 时执行一次；目标 = harness home）
      if (enabled) {
        const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
        void syncAgentPreset(ctx, dshHome).then((result) => {
          if (result) ctx.logger?.info?.('[' + name + '] 预设已同步: ' + result.target)
        })
      }
    }
    sync()
    scope.watch(sync)
    // settings 服务卸载（provider 重载）时注销工具与技能
    sctx.effect(() => () => {
      assembly.teardown()
      skillDisposer?.()
      skillDisposer = null
    })
  })

  ctx.logger?.info?.('[' + name + '] host half active (P1: workflow+novel+variables+context+prompts+skill)')
}
