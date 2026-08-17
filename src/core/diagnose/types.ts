/**
 * dsh-novel-writer — 黄金三章诊断类型（P2-B）。
 */

/** 诊断维度键（规则层 + 模型层共用）。 */
export type GoldenDimension =
  | '开场钩子'
  | '主角亮相'
  | '冲突引入'
  | '爽点密度'
  | '章末悬念'
  | '设定灌输'

export interface GoldenChapterIssue {
  severity: 'error' | 'warning'
  /** 触发规则 id（rule-<key>）。 */
  rule: string
  chapter: number
  /** 原文证据（截断）。 */
  evidence: string
  /** 可执行建议。 */
  advice: string
}

export interface Golden3Report {
  /** 覆盖章节号列表。 */
  chapters: number[]
  /** 总分 0-100。 */
  score: number
  /** 各维度得分 0-100。 */
  dimensions: Partial<Record<GoldenDimension, number>>
  issues: GoldenChapterIssue[]
  /** 模型层结果（P2-B 协议占位：score/dimensions/issues/summary）。 */
  model?: unknown
  ranAt: string
}

/** 模型层 LLM 输出协议（诊断提示词要求输出此 JSON）。 */
export interface ModelDiagnosis {
  score: number
  dimensions: Record<GoldenDimension, number>
  issues: Array<{
    severity: 'error' | 'warning'
    chapter: number
    evidence: string
    advice: string
    suggestion?: string
  }>
  summary: string
}
