/**
 * dsh-novel-writer — 共享设置契约（host 半区）。
 *
 * 0.2.0 起 DSH 的 settings 服务不再提供 `settingsNamespace()` / `scope.register()`：
 * 插件配置由 Loader 直接注入 `apply(ctx, config)`，`dsh-settings` 只在 profile 里
 * 为每个 entry 暴露一个表单（`ns = entry.options.id`）。因此本模块只保留
 * 「Config schema + 共享常量 + 纯归一化」，不再依赖 settings 服务的读写 API。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from 'schemastery'

/** 稳定插件名（与 cordis.patch.yml 的 `name` 一致）。 */
export const PLUGIN_NAME = '@dsh-external/dsh-novel-writer'

/**
 * profile entry id，同时是 `dsh-settings` 暴露给客户端的设置命名空间
 * （`settings.describe()` 的 `ns = entry.options.id`）。
 * cordis.patch.yml 插入的 row id 必须与此一致，客户端半区据此定位配置表单。
 */
export const PLUGIN_ENTRY_ID = 'dsh-novel-writer'

/** 本插件发布的技能名。 */
export const SKILL_NAME = 'novel-writing-workflow'

/** 本插件发布的 agent 预设 id。 */
export const PRESET_ID = 'novel-writer'

/**
 * 插件配置 schema（唯一权威定义）。
 *
 * 字段带默认值：用户在 profile 里只需写想覆盖的字段。
 * `dsh-settings` 依据本 schema 为 profile entry 生成设置页面。
 */
export const Config = z.object({
  /** 插件总开关（consent 门禁；默认开）。 */
  enabled: z.boolean().default(true),
  /** 数据根目录（默认 `$DSH_HOME/dsh-novel-writer`）。 */
  dataDir: z.string().default(''),
  /**
   * 隐藏侧边栏「大肥鱼的小说工坊」入口（摸鱼模式）。
   * 客户端以 localStorage 为权威（见 ui-hidden.ts），此处仅作跨设备同步。
   */
  uiHidden: z.boolean().default(false),
})

/**
 * schema 解析后的插件配置（字段齐全）。
 * schemastery 以 `export =` 导出，没有 `z.infer`，因此取 schema 实例的类型参数。
 */
export type ResolvedConfig = InstanceType<typeof Config>

/**
 * `apply(ctx, config)` 实际收到的配置：Loader 只注入用户在 profile 里显式写入的
 * 字段，未写的由 schema 的 `.default()` 补齐，但调用方仍需容忍 `{}`。
 */
export type Config = Partial<ResolvedConfig>

/** 插件是否启用（缺省视为启用）。 */
export function isEnabled(config: Config | undefined): boolean {
  return config?.enabled !== false
}

/** 解析数据根目录：显式配置优先，否则 `$DSH_HOME/dsh-novel-writer`。 */
export function resolveDataDir(config: Config | undefined): string {
  const configured = config?.dataDir?.trim()
  if (configured) return configured
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, PLUGIN_ENTRY_ID)
}
