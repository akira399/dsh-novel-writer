/**
 * dsh-novel-writer — 核心类型契约层（模块 1）。
 *
 * 职责：定义跨模块共享的数据模型与错误约定。**只含类型与常量，无 IO、无 cordis 依赖**。
 * 域模块（lorebook/workflow/stats/...）在此契约之上自行扩展私有类型。
 * 类型演进：所有持久化结构带 schemaVersion / 可选字段（undefined 而非 null），
 * 便于 store 层迁移链（见模块 2）向后兼容。
 */

// ─────────────────────────── 通用错误约定 ───────────────────────────

/** 业务错误码（模块间约定：`{ code, message, details? }` 形状贯穿工具返回值）。 */
export type ErrorCode =
  | 'INVALID_FIELD_TYPE'
  | 'INVALID_ENTRY_ID'
  | 'ENTRY_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'INVALID_WORLD_BOOK_JSON'
  | 'UNSUPPORTED_WORLD_BOOK_FORMAT'
  | 'INVALID_JSON'
  | 'IMPORT_PATH_REQUIRED'
  | 'IMPORT_FILE_EMPTY'
  | 'NO_IMPORTABLE_ENTRIES'
  | 'IO_FAILURE'
  | 'INVALID_STATE'
  | 'NOT_IMPLEMENTED'

/** 跨模块统一业务错误结构（对应夏瑾 worldBookError 的规范化）。 */
export interface PluginError {
  code: ErrorCode
  message: string
  details?: unknown
}

/** 结果包装：成功 `{ ok: true, value }` / 失败 `{ ok: false, error }`，工具层直接序列化。 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: PluginError }

// ─────────────────────────── 世界书（lorebook）模型 ───────────────────────────

/** 注入目标（移植夏瑾 normalizeInjectTarget）。 */
export type InjectTarget = 'system' | 'user' | 'assistant'

/** 注入位置（移植夏瑾 normalizeInjectPosition；at_depth 仅在 assistant/user 目标时有效）。 */
export type InjectPosition = 'prepend' | 'append' | 'at_depth'

/**
 * 世界书条目（移植夏瑾 worldbook entries.json 字段全集 + v3 扩展）。
 * schemaVersion 由存储层维护（见 module 2），此处为当前版本形状。
 */
export interface LoreEntry {
  /** 稳定唯一 id（`wb_<ts36>_<rand>`，见 util.newId）。 */
  id: string
  name: string
  /** 注入内容（支持变量宏，见 variables 模块，P1）。 */
  content: string
  /** 触发关键词（逗号分隔输入已规范化）。 */
  keywords: string[]
  /** 关键词按正则解释。 */
  is_regex: boolean
  case_sensitive: boolean
  /** 常驻激活（无视关键词，按注入位置常驻注入）。 */
  always_active: boolean
  enabled: boolean
  /** 优先级（大者先；默认 50）。 */
  priority: number
  /** 关键词扫描深度（回溯最近 N 个扫描对象；0 = 仅当前输入）。 */
  scan_depth: number
  inject_target: InjectTarget
  inject_position: InjectPosition
  /** at_depth 时距末尾的回溯条数。 */
  insertion_depth: number
  /** v3：绑定小说项目（替代夏瑾 character_card_id；空 = 全局）。 */
  book_id: string
  /** v3：绑定卷（可选；book_id 之上进一步收窄）。 */
  volume_id?: string
  /** v3：自由标签（分类/检索用）。 */
  tags: string[]
  /** 备注（不注入，仅管理用途）。 */
  note?: string
  /** 版本号（每次 update +1，回滚依据）。 */
  version: number
  created_at: string
  updated_at: string
}

/** 世界书分组（移植夏瑾 groups.json；disabled 分组内的条目不注入）。 */
export interface LoreGroup {
  id: string
  name: string
  entry_ids: string[]
  /** v3：分组级项目绑定（替代夏瑾 character_card_ids）。 */
  book_ids: string[]
  enabled: boolean
  created_at: string
  updated_at: string
}

/** 世界书全局设置（移植夏瑾 settings.json + v3）。 */
export interface LoreSettings {
  /** 用户名称替换宏 `{{user}}` 的取值。 */
  user_replacement?: string
  /** v3：单轮注入 token 预算（injectionBudget 全局配置的落盘快照，可被项目覆盖）。 */
  injection_budget?: number
  [key: string]: unknown
}

/**
 * 注入计划（v3 新增）：一次 prompt 组装的完整命中与裁剪结果，
 * 供上下文组装器消费、GUI 预览、审计记录。
 */
export interface InjectionPlan {
  scope: 'lorebook' | 'prompt_front' | 'prompt_back'
  /** 按注入位置分组的命中条目（已按 priority 排序）。 */
  prepend: LoreEntry[]
  append: LoreEntry[]
  atDepth: Array<{ entry: LoreEntry; depth: number }>
  /** 估算 token（按 content 字符数 / 2 估算，中文近似）。 */
  tokenEstimate: number
  /** 超出预算被裁剪的条目（含原因）。 */
  truncated: Array<{ entry: LoreEntry; reason: 'budget' | 'disabled-group' | 'book-mismatch' }>
  /** 组装后的注入文本（prepend/append 各自拼接，供直接使用）。 */
  renderedPrepend: string
  renderedAppend: string
  builtAt: string
}

// ─────────────────────────── 章节统计（v3） ───────────────────────────

/** 章节字数统计（stats 模块产出，见模块 5）。 */
export interface ChapterStats {
  chapterNo: number
  /** 总字符数（含标点与空白）。 */
  totalChars: number
  /** 中文字符数（Unicode CJK 区段；统计口径见 stats/wordcount.ts）。 */
  cjkChars: number
  paragraphs: number
  /** 对话占比 0-1（引号内文本占比估算）。 */
  dialogueRatio: number
  /** 平均句长（按中英文句号/问号/感叹号切分）。 */
  avgSentenceLen: number
  /** 是否满足项目 wordTargets（stats 模块判定）。 */
  meetsTarget: boolean
}

// ─────────────────────────── 提示词库（v3，P2 落地） ───────────────────────────

/** 内置提示词模板（prompts 模块；P2 实现加载/覆盖/导出）。 */
export interface PromptTemplate {
  id: string
  /** 分类：creation | style | depolish | polish | diagnose | guide | lorebook */
  category: string
  name: string
  description: string
  /** 模板正文（`{{var}}` 占位符，渲染时替换）。 */
  template: string
  /** 模板声明的占位符变量。 */
  variables: string[]
  /** 来源：builtin（随包）| user（项目覆盖/自定义）。 */
  source: 'builtin' | 'user'
  version: number
}

// ─────────────────────────── 持久化容器 ───────────────────────────

/** 存储文件的统一版本化外壳（store 层使用）。 */
export interface VersionedFile<T> {
  schemaVersion: number
  data: T
}
