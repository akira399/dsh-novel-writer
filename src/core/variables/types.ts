/**
 * dsh-novel-writer — 变量引擎类型（P1-C）。
 *
 * 移植夏瑾 worldbook_variables.js 的数据模型并做 DSH 场景适配：
 *  - character_variables → 书级变量（键 = bookId，跨会话持久）；
 *  - chats → 书级局部变量（键 = bookId，写章过程中的临时状态）；
 *  - 「消息扫描」→「章节文本扫描」（processed_chapter_numbers 替代消息时间戳）。
 */
import type { VersionedFile } from '../types.ts'

/** 变量存储（variables.json，VersionedFile 外壳）。 */
export interface VariableStoreData {
  /** 全局变量（跨书）。 */
  global_variables: Record<string, unknown>
  /** 书级持久变量（bookId → 变量表）。 */
  book_variables: Record<string, Record<string, unknown>>
  /** 书级局部变量与扫描游标（bookId → 状态）。 */
  books: Record<string, BookVariableState>
}

export interface BookVariableState {
  local_variables: Record<string, unknown>
  /** 已处理的章节号（增量扫描游标）。 */
  processed_chapter_numbers: number[]
  /** 最近扫描到的章节号。 */
  last_scanned_chapter: number
}

export type VariableStore = VersionedFile<VariableStoreData>

export function emptyVariableStore(): VariableStoreData {
  return { global_variables: {}, book_variables: {}, books: {} }
}

/** 渲染上下文（宏求值的作用域快照）。 */
export interface VariableContext {
  localVariables: Record<string, unknown>
  bookVariables: Record<string, unknown>
  globalVariables: Record<string, unknown>
}

/** JSON Patch 操作（RFC 6902 子集 + delta 扩展，对齐夏瑾）。 */
export interface PatchOperation {
  op: 'replace' | 'insert' | 'remove' | 'delta' | 'move'
  path: string
  value?: unknown
  from?: string
  to?: string
}
