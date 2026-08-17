/**
 * dsh-novel-writer — AI 味检测类型（P2-A）。
 */

/** AI 味词类别（5 类）。 */
export type AiTasteCategory = 'connector' | 'action' | 'psychology' | 'adjective' | 'tone'

/** 词条处理策略。 */
export type AiTasteStrategy = 'replace' | 'delete' | 'rewrite'

/** 一条 AI 味词（随包内置；项目级可覆盖扩充）。 */
export interface AiTasteWord {
  /** 命中词（原样匹配）。 */
  word: string
  category: AiTasteCategory
  /** 处理策略：replace=可替换 / delete=建议删除 / rewrite=需改写句子。 */
  strategy: AiTasteStrategy
  /** 推荐替换（replace 策略时）。 */
  replacement?: string
}

/** 一次命中（含上下文句子）。 */
export interface AiTasteHit {
  word: string
  category: AiTasteCategory
  strategy: AiTasteStrategy
  replacement?: string
  /** 命中所处的句子（截断 60 字）。 */
  sentence: string
  /** 句子内命中位置。 */
  index: number
}

/** 检测报告。 */
export interface AiTasteReport {
  /** 密度评分 0-100（每千字命中数加权）。 */
  score: number
  /** 命中总数。 */
  hits: number
  /** 中文字符数（分母）。 */
  cjkChars: number
  /** 类别分布。 */
  byCategory: Record<AiTasteCategory, number>
  /** 命中明细（按句子顺序）。 */
  details: AiTasteHit[]
  scannedAt: string
}
