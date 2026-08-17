/**
 * dsh-novel-writer — 小说项目域类型（P1-B）。
 */
import type { PhaseId, PhaseRecord } from '../workflow/types.ts'

/** 项目状态。 */
export type BookStatus = 'drafting' | 'finished' | 'abandoned'

/** 项目级配置（P1 基础字段；P2 起扩展 style/校验等）。 */
export interface BookConfig {
  title: string
  author?: string
  /** 类型模板 id（P2 模板库接入）。 */
  genre: string
  /** 每章目标字数区间（主口径 totalChars）。 */
  wordTargets: {
    perChapterMin: number
    perChapterMax: number
  }
  /** 风格约束（P2 样式表扩展）。 */
  style: {
    pov: 'first' | 'third'
    forbiddenWords: string[]
    aiTasteWords: string[]
  }
  /** 阶段门禁开关（false = 允许口头跳阶段，默认 true 强制）。 */
  phaseGating: boolean
}

/** 章节元数据（正文存 chapters/ch<no>.md，frontmatter 内嵌本结构）。 */
export interface Chapter {
  no: number
  title: string
  status: 'draft' | 'revised' | 'approved'
  /** 修订次数。 */
  version: number
  /** 主口径字数（totalChars，P1-F 统计接线后写入）。 */
  words: number
  /** 一句话梗概（细纲对照用）。 */
  brief?: string
  createdAt: string
  updatedAt: string
}

/** 小说项目核心状态（book.json，VersionedFile 外壳）。 */
export interface Book {
  id: string
  title: string
  genre: string
  status: BookStatus
  config: BookConfig
  /** 流程状态机面（workflow 引擎直接操作）。 */
  phases: Record<PhaseId, PhaseRecord>
  currentPhase: PhaseId
  stats: {
    totalWords: number
    chapterCount: number
    lastWriteAt?: string
  }
  createdAt: string
  updatedAt: string
  schemaVersion: number
}

/** 列表摘要（避免整本加载）。 */
export interface BookSummary {
  id: string
  title: string
  genre: string
  status: BookStatus
  currentPhase: PhaseId
  chapterCount: number
  totalWords: number
  updatedAt: string
}
