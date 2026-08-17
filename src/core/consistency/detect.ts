/**
 * dsh-novel-writer — 一致性检测与巡检（P2-D 纯函数部分）。
 *  - detectLedgerConflicts：同实体字段多次取值（覆盖史）
 *  - detectTimelineAnomalies：书内时间倒挂/缺失
 *  - suggestSediment：账本首次出现实体 → 世界书建议条目
 */
import type { ConsistencyAuditReport, LedgerEntry, TimelineEvent } from './types.ts'

/** 账本覆盖史：同一 entity+field 的多值序列（按章节升序）。 */
export function detectLedgerConflicts(entries: readonly LedgerEntry[]): ConsistencyAuditReport['conflicts'] {
  const byKey = new Map<string, Array<{ chapterNo: number; value: string }>>()
  for (const entry of entries) {
    const key = `${entry.entity}\u0000${entry.field}`
    const history = byKey.get(key)
    if (history) history.push({ chapterNo: entry.chapterNo, value: entry.value })
    else byKey.set(key, [{ chapterNo: entry.chapterNo, value: entry.value }])
  }
  const conflicts: ConsistencyAuditReport['conflicts'] = []
  for (const [key, history] of byKey) {
    history.sort((a, b) => a.chapterNo - b.chapterNo)
    const distinct = new Set(history.map((h) => h.value))
    if (distinct.size <= 1) continue
    const [entity = '', field = ''] = key.split('\u0000')
    // 数值型：单调上升视为升级（info），出现回退/无序为 warning
    const numeric = history.every((h) => /^-?\d+(\.\d+)?$/.test(h.value))
    let severity: 'warning' | 'info' = 'warning'
    if (numeric) {
      const values = history.map((h) => Number(h.value))
      const monotonic = values.every((v, i) => i === 0 || v >= values[i - 1]!)
      severity = monotonic ? 'info' : 'warning'
    }
    conflicts.push({ kind: 'ledger-overwrite', entity, field, history, severity })
  }
  return conflicts.sort((a, b) => a.entity.localeCompare(b.entity))
}

/** 中文数字转阿拉伯（支持 零一二三…十、十X、X十、X十Y）。 */
export function chineseToNumber(text: string): number | null {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (!/^[零一二两三四五六七八九十]{1,3}$/.test(text)) return null
  if (text.includes('十')) {
    const [tensText = '', onesText = ''] = text.split('十')
    const tens = tensText === '' ? 1 : (digits[tensText] ?? 0)
    const ones = onesText === '' ? 0 : (digits[onesText] ?? 0)
    return tens * 10 + ones
  }
  return digits[text] ?? null
}

/** 书内时间归一化（「第 N 天/日」阿拉伯/中文数字、「YYYY-MM-DD」「第 N 年」；无法解析返回 null）。 */
export function normalizeBookTime(bookTime: string): string | null {
  const text = String(bookTime ?? '').trim()
  let match = /第\s*([0-9零一二两三四五六七八九十]+)\s*(天|日)/.exec(text)
  if (match) {
    const number = /^\d+$/.test(match[1]!) ? Number(match[1]) : chineseToNumber(match[1]!)
    if (number !== null) return `d${String(number).padStart(6, '0')}`
  }
  match = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})?/.exec(text)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = match[3] ? Number(match[3]) : 1
    return `y${year * 10000 + month * 100 + day}`
  }
  match = /第\s*(\d+)\s*年/.exec(text)
  if (match) return `y${Number(match[1]) * 10000}`
  return null
}

/** 时间线异常：倒挂（后章时间早于前章）与缺失（时间不可解析）。按章节号排序后比较（乱序记录不误报）。 */
export function detectTimelineAnomalies(events: readonly TimelineEvent[]): ConsistencyAuditReport['timelineIssues'] {
  const issues: ConsistencyAuditReport['timelineIssues'] = []
  // 按章节号（+ 记录时间）排序：避免模型乱序登记造成假倒挂
  const sorted = [...events].sort((a, b) => a.chapterNo - b.chapterNo || a.createdAt.localeCompare(b.createdAt))
  const withKeys = sorted.map((event) => ({ event, key: normalizeBookTime(event.bookTime) }))
  for (let index = 0; index < withKeys.length; index += 1) {
    const current = withKeys[index]!
    if (current.key === null) {
      issues.push({
        kind: 'missing-time', chapterNo: current.event.chapterNo,
        message: `第 ${current.event.chapterNo} 章书内时间无法解析（${current.event.bookTime}）`,
        severity: 'info',
      })
      continue
    }
    const previous = withKeys.slice(0, index).reverse().find((item) => item.key !== null)
    // 跨刻度（天 d* vs 年/日期 y*）无法可靠排序，跳过比较
    if (previous && previous.key !== null && previous.key[0] === current.key[0] && current.key < previous.key) {
      issues.push({
        kind: 'time-regression', chapterNo: current.event.chapterNo,
        message: `第 ${current.event.chapterNo} 章书内时间（${current.event.bookTime}）早于第 ${previous.event.chapterNo} 章（${previous.event.bookTime}），时间倒挂`,
        severity: 'warning',
      })
    }
  }
  return issues
}

/** 世界书沉淀建议：账本中出现 ≥2 次或首次出现的实体，生成建议条目文本。 */
export function suggestSediment(entries: readonly LedgerEntry[]): ConsistencyAuditReport['sedimentSuggestions'] {
  const byEntity = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const list = byEntity.get(entry.entity)
    if (list) list.push(entry)
    else byEntity.set(entry.entity, [entry])
  }
  const suggestions: ConsistencyAuditReport['sedimentSuggestions'] = []
  for (const [entity, list] of byEntity) {
    const fields = list.filter((entry) => entry.field !== 'stat_data')
    if (fields.length === 0) continue
    const lines = fields.slice(0, 6).map((entry) => `${entry.field}：${entry.value}`)
    suggestions.push({
      entity,
      field: fields.map((f) => f.field).join('、'),
      value: fields.map((f) => f.value).join('、'),
      chapterNo: list[0]!.chapterNo,
      suggestedEntry: `【${entity}】\n${lines.join('\n')}`,
    })
  }
  return suggestions.sort((a, b) => a.chapterNo - b.chapterNo)
}

/** 卷摘要聚合（数据层：拼接 + 截断；LLM 压缩在工具层）。 */
export function aggregateVolumeSummaries(summaries: readonly { no: number; text: string }[], cap = 600): string {
  const parts = summaries.map((s) => `第${s.no}章：${s.text.trim()}`)
  let joined = parts.join('\n')
  if (joined.length > cap) joined = joined.slice(0, cap) + '…'
  return joined
}
