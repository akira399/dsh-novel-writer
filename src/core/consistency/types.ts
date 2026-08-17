/**
 * dsh-novel-writer — 一致性引擎类型（P2-D）。
 */

/** 账本条（实体-字段-值，附章节与置信度）。 */
export interface LedgerEntry {
  /** 实体名（人物/物品/地点/势力/规则…）。 */
  entity: string
  field: string
  value: string
  chapterNo: number
  confidence: 'high' | 'medium' | 'low'
  /** 变更原因（patch 来源）。 */
  source?: string
}

/** 时间线事件（书内时间）。 */
export interface TimelineEvent {
  chapterNo: number
  /** 书内时间描述（如「第三日」「灵历 1024 年秋」）。 */
  bookTime: string
  /** 事件摘要。 */
  event: string
  /** 归一化排序键（可由 bookTime 解析，解析失败为 null）。 */
  sortKey?: string | null
  createdAt: string
}

/** 一致性巡检报告。 */
export interface ConsistencyAuditReport {
  auditedThroughChapter: number
  /** 账本覆盖冲突（同字段多值）。 */
  conflicts: Array<{
    kind: 'ledger-overwrite'
    entity: string
    field: string
    /** 按章节排列的取值序列（含章节号）。 */
    history: Array<{ chapterNo: number; value: string }>
    severity: 'warning' | 'info'
  }>
  /** 时间线异常（倒挂/缺失）。 */
  timelineIssues: Array<{
    kind: 'time-regression' | 'missing-time'
    chapterNo: number
    message: string
    severity: 'warning' | 'info'
  }>
  /** 世界书沉淀建议。 */
  sedimentSuggestions: Array<{
    entity: string
    field: string
    value: string
    chapterNo: number
    suggestedEntry: string
  }>
  ranAt: string
}

/** 卷摘要聚合输入。 */
export interface ChapterSummaryRef {
  no: number
  text: string
}
