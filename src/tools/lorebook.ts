/**
 * dsh-novel-writer — lorebook agent 工具注册（模块 6）。
 *
 * 工具集（P0 范围 8 个）：list/get/create/update/delete/toggle/import/export。
 * 契约：execute 返回 `{ ok, value } | { ok: false, error }`（asResult 包装），
 * 错误码见 core/types ErrorCode；模型可从返回值直接读取结果或错误。
 * 说明：分组/移动/角色卡代理等其余工具随 P1 项目模块一并注册（避免超前）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult, type LoreService } from '../core/lorebook/index.ts'
import type { CreateEntryParams, ImportParams, UpdateEntryParams } from '../core/lorebook/types.ts'
import { jsonOutput } from './json.ts'

export interface LoreToolDeps {
  lore: LoreService
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

// ── 条目工具 ──

export function lorebookListEntriesTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_list_entries',
    description: '列出世界书全部条目摘要（按优先级降序）。触发：世界书/世界观/lorebook/设定条目。',
    parameters: {},
    output: jsonOutput(),
    execute: async () => asJson(await asResult(() => lore.listEntries())),
    isConcurrencySafe: () => true,
  })
}

export function lorebookGetEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_get_entry',
    description: '获取单个世界书条目完整详情（含关键词/注入位置/绑定项目）。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 ID（lorebook_list_entries 返回）' },
    },
    output: jsonOutput(),
    execute: async (args) => asJson(await asResult(() => lore.getEntry(String((args as { id: string }).id)))),
    isConcurrencySafe: () => true,
  })
}

export function lorebookCreateEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_create_entry',
    description: '创建世界书条目：关键词命中或常驻时注入上下文，用于固化设定（人物/地点/规则/术语）。' +
      '注入位置 prepend/append/at_depth；inject_target system/user/assistant（assistant 强制 at_depth）；' +
      'book_id 绑定小说项目（空=全局）。',
    parameters: {
      name: { type: 'string', required: true, description: '条目名称' },
      content: { type: 'string', required: true, description: '注入内容（支持 {{getvar::}} 等变量宏）' },
      keywords: { type: 'string', description: '触发关键词，逗号分隔；留空=仅常驻' },
      is_regex: { type: 'boolean', description: '关键词是否按正则解释（默认 false）' },
      case_sensitive: { type: 'boolean', description: '关键词匹配是否大小写敏感（默认 false）' },
      always_active: { type: 'boolean', description: '是否常驻注入（无视关键词，默认 false）' },
      enabled: { type: 'boolean', description: '是否启用（默认 true）' },
      priority: { type: 'number', description: '优先级 0-1000，大者先（默认 50）' },
      scan_depth: { type: 'number', description: '关键词扫描深度（回溯扫描对象数，默认 0=仅当前）' },
      inject_target: { type: 'string', description: '注入目标 system|user|assistant（默认 system）' },
      inject_position: { type: 'string', description: '注入位置 prepend|append|at_depth（默认 append）' },
      book_id: { type: 'string', description: '绑定小说项目 ID（默认空=全局）' },
      tags: { type: 'string', description: '逗号分隔标签' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>
      const params: CreateEntryParams = {
        name: String(args.name ?? ''),
        content: String(args.content ?? ''),
        keywords: typeof args.keywords === 'string' ? args.keywords : undefined,
        is_regex: args.is_regex === true,
        case_sensitive: args.case_sensitive === true,
        always_active: args.always_active === true,
        enabled: args.enabled !== false,
        priority: typeof args.priority === 'number' ? args.priority : undefined,
        scan_depth: typeof args.scan_depth === 'number' ? args.scan_depth : undefined,
        inject_target: typeof args.inject_target === 'string' ? args.inject_target as CreateEntryParams['inject_target'] : undefined,
        inject_position: typeof args.inject_position === 'string' ? args.inject_position as CreateEntryParams['inject_position'] : undefined,
        book_id: typeof args.book_id === 'string' ? args.book_id : undefined,
        tags: typeof args.tags === 'string' ? args.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
      }
      return asJson(await asResult(() => lore.createEntry(params)))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookUpdateEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_update_entry',
    description: '更新世界书条目（部分更新：只改传入字段；keywords/tags 传空字符串=清空）。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 ID' },
      name: { type: 'string', description: '新名称' },
      content: { type: 'string', description: '新注入内容' },
      keywords: { type: 'string', description: '新关键词，逗号分隔；空字符串=清空' },
      is_regex: { type: 'boolean', description: '是否按正则解释' },
      case_sensitive: { type: 'boolean', description: '是否大小写敏感' },
      always_active: { type: 'boolean', description: '是否常驻' },
      enabled: { type: 'boolean', description: '是否启用' },
      priority: { type: 'number', description: '优先级 0-1000' },
      scan_depth: { type: 'number', description: '扫描深度' },
      inject_target: { type: 'string', description: '注入目标 system|user|assistant' },
      inject_position: { type: 'string', description: '注入位置 prepend|append|at_depth' },
      book_id: { type: 'string', description: '绑定项目 ID；空字符串=解除绑定' },
      tags: { type: 'string', description: '逗号分隔标签；空字符串=清空' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>
      const params: UpdateEntryParams = {
        ...(args.name !== undefined ? { name: args.name as string } : {}),
        ...(args.content !== undefined ? { content: args.content as string } : {}),
        ...(args.keywords !== undefined ? { keywords: args.keywords as string } : {}),
        ...(args.is_regex !== undefined ? { is_regex: args.is_regex === true } : {}),
        ...(args.case_sensitive !== undefined ? { case_sensitive: args.case_sensitive === true } : {}),
        ...(args.always_active !== undefined ? { always_active: args.always_active === true } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled !== false } : {}),
        ...(args.priority !== undefined ? { priority: args.priority as number } : {}),
        ...(args.scan_depth !== undefined ? { scan_depth: args.scan_depth as number } : {}),
        ...(args.inject_target !== undefined ? { inject_target: args.inject_target as UpdateEntryParams['inject_target'] } : {}),
        ...(args.inject_position !== undefined ? { inject_position: args.inject_position as UpdateEntryParams['inject_position'] } : {}),
        ...(args.book_id !== undefined ? { book_id: args.book_id as string } : {}),
        ...(args.tags !== undefined ? { tags: (args.tags as string).split(/[,，]/).map((s) => s.trim()).filter(Boolean) } : {}),
      }
      return asJson(await asResult(() => lore.updateEntry(String(args.id ?? ''), params)))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookDeleteEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_delete_entry',
    description: '删除世界书条目（同时从所有分组移除引用）。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 ID' },
    },
    output: jsonOutput(),
    execute: async (args) => asJson(await asResult(() => lore.deleteEntry(String((args as { id: string }).id)))),
    isConcurrencySafe: () => true,
  })
}

export function lorebookToggleEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_toggle_entry',
    description: '切换世界书条目的启用/停用状态。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 ID' },
    },
    output: jsonOutput(),
    execute: async (args) => asJson(await asResult(() => lore.toggleEntry(String((args as { id: string }).id)))),
    isConcurrencySafe: () => true,
  })
}

// ── 导入/导出 ──

export function lorebookImportEntriesTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_import_entries',
    description: '导入世界书条目：支持 Operit 条目数组、SillyTavern lorebook、角色卡内嵌 character_book（content 与 path 二选一）。返回导入数量与兼容性警告。',
    parameters: {
      content: { type: 'string', description: '原始 JSON 文本（与 path 二选一）' },
      path: { type: 'string', description: 'JSON 文件路径（与 content 二选一）' },
      book_id: { type: 'string', description: '导入后统一绑定到指定项目 ID（可选）' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>
      const params: ImportParams = {
        ...(typeof args.content === 'string' ? { content: args.content } : {}),
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        ...(typeof args.book_id === 'string' ? { book_id: args.book_id } : {}),
      }
      return asJson(await asResult(() => lore.importEntries(params)))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookExportEntriesTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_export_entries',
    description: '导出全部世界书条目。format=operit 输出夏瑾兼容精简数组；format=full 输出完整字段；' +
      'format=sillytavern 输出 SillyTavern 原生 lorebook（可直接在酒馆 Import 导入）。用于备份或迁移到其他工具。',
    parameters: {
      format: { type: 'string', description: 'operit（默认，精简兼容）| full（完整字段）| sillytavern（酒馆原生）' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const format = ['full', 'sillytavern'].includes((rawArgs as { format?: string }).format ?? '')
        ? (rawArgs as { format: string }).format
        : 'operit'
      return asJson(await asResult(async () => {
        const entries = await lore.listEntries()
        let payload: unknown
        let wrapper: 'array' | 'entries' = 'array'
        if (format === 'full') {
          payload = entries
        } else if (format === 'sillytavern') {
          // SillyTavern 原生 world info / lorebook：{ entries: [ {...} ] }
          wrapper = 'entries'
          payload = entries.map((entry, index) => ({
            uid: index + 1,
            key: entry.name,
            keys: entry.keywords.length > 0 ? entry.keywords : [entry.name],
            secondary_keys: [],
            comment: entry.note ?? entry.name,
            content: entry.content,
            constant: entry.always_active,
            selective: false,
            insert_order: 100 - Math.min(100, Math.max(0, entry.priority)),
            enabled: entry.enabled,
            position: entry.inject_position === 'prepend' ? 0 : 1,
            disable: false,
          }))
        } else {
          payload = entries.map((entry) => ({
            name: entry.name,
            content: entry.content,
            keywords: entry.keywords,
            is_regex: entry.is_regex,
            case_sensitive: entry.case_sensitive,
            always_active: entry.always_active,
            enabled: entry.enabled,
            priority: entry.priority,
            scan_depth: entry.scan_depth,
            inject_target: entry.inject_target,
            inject_position: entry.inject_position,
            insertion_depth: entry.insertion_depth,
          }))
        }
        return { format, count: entries.length, ...(wrapper === 'entries' ? { entries: payload } : { entries: payload }) }
      }))
    },
    isConcurrencySafe: () => true,
  })
}

// ── 分组工具（P1-F3 补全） ──

export function lorebookListGroupsTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_list_groups',
    description: '列出全部世界书分组（含条目/项目绑定）。',
    parameters: {},
    output: jsonOutput(),
    execute: async () => asJson(await asResult(() => lore.listGroups())),
    isConcurrencySafe: () => true,
  })
}

export function lorebookCreateGroupTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_create_group',
    description: '创建世界书分组（entry_ids 逗号分隔）。',
    parameters: {
      name: { type: 'string', required: true, description: '分组名称' },
      entry_ids: { type: 'string', description: '逗号分隔的条目 ID' },
      book_ids: { type: 'string', description: '逗号分隔的绑定项目 ID（分组级绑定）' },
      enabled: { type: 'boolean', description: '是否启用（默认 true）' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>
      const split = (value: unknown): string[] | undefined =>
        typeof value === 'string' ? value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined
      return asJson(await asResult(() => lore.createGroup({
        name: String(args.name ?? ''),
        ...(split(args.entry_ids) ? { entry_ids: split(args.entry_ids)! } : {}),
        ...(split(args.book_ids) ? { book_ids: split(args.book_ids)! } : {}),
        ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
      })))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookUpdateGroupTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_update_group',
    description: '更新世界书分组（entry_ids 整体替换；add_entry_ids/remove_entry_ids 增量）。',
    parameters: {
      id: { type: 'string', required: true, description: '分组 ID' },
      name: { type: 'string', description: '新名称' },
      entry_ids: { type: 'string', description: '整体替换的条目 ID 列表（逗号分隔）' },
      add_entry_ids: { type: 'string', description: '追加条目（逗号分隔）' },
      remove_entry_ids: { type: 'string', description: '移除条目（逗号分隔）' },
      enabled: { type: 'boolean', description: '是否启用' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>
      const split = (value: unknown): string[] | undefined =>
        typeof value === 'string' ? value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined
      const params: Record<string, unknown> = { id: String(args.id ?? '') }
      if (args.name !== undefined) params.name = args.name
      if (split(args.entry_ids)) params.entry_ids = split(args.entry_ids)
      if (split(args.add_entry_ids)) params.add_entry_ids = split(args.add_entry_ids)
      if (split(args.remove_entry_ids)) params.remove_entry_ids = split(args.remove_entry_ids)
      if (args.enabled !== undefined) params.enabled = args.enabled
      return asJson(await asResult(() => lore.updateGroup(params as never)))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookDeleteGroupTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_delete_group',
    description: '删除世界书分组；delete_entries=true 时同时删除组内条目。',
    parameters: {
      id: { type: 'string', required: true, description: '分组 ID' },
      delete_entries: { type: 'boolean', description: '是否同时删除组内条目（默认 false）' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as { id: string; delete_entries?: boolean }
      return asJson(await asResult(() => lore.deleteGroup(args.id, args.delete_entries === true)))
    },
    isConcurrencySafe: () => true,
  })
}

export function lorebookMoveEntryTool(lore: LoreService) {
  return defineTool({
    name: 'lorebook_move_entry',
    description: '移动条目到目标分组；target_group_id 省略=从所有分组摘除。',
    parameters: {
      entry_id: { type: 'string', required: true, description: '条目 ID' },
      target_group_id: { type: 'string', description: '目标分组 ID' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as { entry_id: string; target_group_id?: string }
      return asJson(await asResult(() => lore.moveEntryToGroup(args.entry_id, args.target_group_id)))
    },
    isConcurrencySafe: () => true,
  })
}

// ── 聚合注册 ──

/** 注册全部 lorebook 工具，返回 disposer 数组（聚合注销用）。 */
export function registerLorebookTools(ctx: Context, deps: LoreToolDeps): Array<() => void> {
  const { lore } = deps
  return [
    ctx.tools.register(lorebookListEntriesTool(lore)),
    ctx.tools.register(lorebookGetEntryTool(lore)),
    ctx.tools.register(lorebookCreateEntryTool(lore)),
    ctx.tools.register(lorebookUpdateEntryTool(lore)),
    ctx.tools.register(lorebookDeleteEntryTool(lore)),
    ctx.tools.register(lorebookToggleEntryTool(lore)),
    ctx.tools.register(lorebookImportEntriesTool(lore)),
    ctx.tools.register(lorebookExportEntriesTool(lore)),
    ctx.tools.register(lorebookListGroupsTool(lore)),
    ctx.tools.register(lorebookCreateGroupTool(lore)),
    ctx.tools.register(lorebookUpdateGroupTool(lore)),
    ctx.tools.register(lorebookDeleteGroupTool(lore)),
    ctx.tools.register(lorebookMoveEntryTool(lore)),
  ]
}
