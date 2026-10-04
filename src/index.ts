/**
 * @dsh-external/dsh-novel-writer — host half entry (装配层).
 *
 * 职责边界（遵循 OPERITFORGE-MIGRATION-PLAN.md v3 §2 架构）：
 *  - 本文件只做「装配」：读配置、组合子模块、注册工具/路由/技能；
 *  - 业务纯逻辑一律落在 src/core/**（可单测、无 cordis 依赖）；
 *  - 模块按 P0→P3 逐个落地，每个模块完成后独立单测与复盘。
 *
 * DSH 0.2.0-rc.2 适配：
 *  - `dsh-settings` 移除了 `settingsNamespace()` 与 `settings.register()`；
 *    配置改由 Loader 直接注入 `apply(ctx, config)`（fiber 在 config 变更时
 *    重新执行 apply）。因此这里直接消费注入的 config，不再自建 scope 门禁。
 *  - 设置页面由 `dsh-settings` 依据 entry 的 Config schema 生成
 *    （`ns = entry.options.id` = PLUGIN_ENTRY_ID），客户端半区据此定位表单。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { LoreService, LoreStore } from './core/lorebook/index.ts'
import { NovelService, NovelStore } from './core/novel/index.ts'
import { VariableStoreFile, variablesFilePath } from './core/variables/index.ts'
import { captureRoute, createLlmClient } from './core/llm/index.ts'
import type LlmService from '@deepseek-ai/dsh-llm'
import { NovelAssembly, type NovelServices } from './assembly.ts'
import { registerWorkflowSkill } from './tools/skill.ts'
import { registerNovelRoutes } from './routes.ts'
import { syncAgentPreset } from './presets.ts'
import {
  Config,
  isEnabled,
  PLUGIN_NAME,
  resolveDataDir,
  type Config as NovelWriterConfig,
} from './settings.ts'

export { Config, PLUGIN_ENTRY_ID, PLUGIN_NAME, resolveDataDir } from './settings.ts'

/** 稳定插件名（与 cordis.patch.yml 的 name 一致）。 */
export const name = PLUGIN_NAME

/**
 * 宿主服务注入。
 *  - `tools`：工具注册；
 *  - `settings`：设置页面策略；
 *  - `skills`：技能注册（0.2.0 起必须声明——不声明时 cordis 不保证该服务在插件
 *    fiber 上可见，`ctx.skills` 会缺失，技能注册静默失败）。
 */
export const inject = ['tools', 'settings', 'skills']

export function apply(ctx: Context, config: NovelWriterConfig = {}): void {
  // 配置驱动：enabled=false 时不注册任何工具/技能（目录传 null 即注销）。
  const enabled = isEnabled(config)
  const dataDir = resolveDataDir(config)

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

  // GUI 数据路由（固定注册；未启用时 handler 返回 503）
  registerNovelRoutes(ctx, assembly)

  // 装配 + 技能随 enabled 联动；返回 teardown 供 fiber 卸载时注销。
  {
    let skillDisposer: (() => void) | null = null
    assembly.sync(enabled ? dataDir : null)
    if (enabled) skillDisposer = registerWorkflowSkill(ctx)
    ctx.effect(() => () => {
      assembly.teardown()
      skillDisposer?.()
      skillDisposer = null
    }, name + ': teardown')
  }

  // 设置页面策略：本插件的页面由 schema 自动生成（dsh-settings 默认 auto=true，
  // 显式声明以保证语义稳定）。客户端半区另在 Plugins 设置区提供自有页签。
  ctx.inject(['settings'], (sctx) => {
    sctx.effect(() => sctx.settings.configure({ auto: true }), name + ': settings page policy')
  })

  // agent 预设同步（enabled 时执行一次；目标 = harness home）
  if (enabled) {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    void syncAgentPreset(ctx, dshHome).then((result) => {
      if (result) ctx.logger?.info?.('[' + name + '] 预设已同步: ' + result.target)
    })
  }

  ctx.logger?.info?.('[' + name + '] host half active (DSH 0.2.0-rc.2, enabled=' + String(enabled) + ')')
}
