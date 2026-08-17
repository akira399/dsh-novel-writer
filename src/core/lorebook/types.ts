/**
 * dsh-novel-writer — lorebook 域参数/结果类型（模块 3 配套）。
 * 服务层入参采用「可选字段对象」：缺省即用默认值（create）或保持不变（update）。
 */
import type { InjectPosition, InjectTarget, LoreEntry, LoreGroup } from '../types.ts'

/** 条目创建参数（夏瑾 createWorldBookEntry 字段集）。 */
export interface CreateEntryParams {
  name: string
  content: string
  keywords?: string | readonly string[]
  is_regex?: boolean
  case_sensitive?: boolean
  always_active?: boolean
  enabled?: boolean
  priority?: number
  scan_depth?: number
  inject_target?: InjectTarget
  inject_position?: InjectPosition
  insertion_depth?: number
  book_id?: string
  volume_id?: string
  tags?: string[]
  note?: string
}

/** 条目更新参数：字段缺省 = 保持不变；显式 null = 重置为空。 */
export interface UpdateEntryParams {
  name?: string | null
  content?: string | null
  keywords?: string | readonly string[] | null
  is_regex?: boolean
  case_sensitive?: boolean
  always_active?: boolean
  enabled?: boolean
  priority?: number
  scan_depth?: number
  inject_target?: InjectTarget
  inject_position?: InjectPosition
  insertion_depth?: number
  book_id?: string | null
  volume_id?: string | null
  tags?: string[] | null
  note?: string | null
}

/** 导入入参（content 与 path 二选一；path 能力由调用方注入 reader 实现）。 */
export interface ImportParams {
  content?: string
  path?: string
  book_id?: string
}

/** 导入结果（含兼容性警告，对齐夏瑾 importWorldBookEntries 返回）。 */
export interface ImportResult {
  source_type: 'operit_entries' | 'sillytavern_worldbook' | 'character_book'
  imported_count: number
  warning_count: number
  warnings: string[]
  entries: LoreEntry[]
}

/** 分组创建参数。 */
export interface CreateGroupParams {
  name: string
  entry_ids?: string[]
  book_ids?: string[]
  enabled?: boolean
}

/** 分组更新参数。 */
export interface UpdateGroupParams {
  id: string
  name?: string
  entry_ids?: string[]
  add_entry_ids?: string[]
  remove_entry_ids?: string[]
  book_ids?: string[]
  enabled?: boolean
}

/** 分组操作结果（move/delete 时返回受影响条目）。 */
export interface GroupOpResult {
  group?: LoreGroup
  removedGroups?: LoreGroup[]
  removedEntries?: LoreEntry[]
  movedEntryIds?: string[]
}
