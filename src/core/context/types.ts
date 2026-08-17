/**
 * dsh-novel-writer — 上下文包类型（P1-E）。
 * 写章时发给模型的受控上下文（方案 §3.3 三层记忆）。
 */
import type { InjectionPlan } from '../types.ts'
import type { BookConfig } from '../novel/types.ts'

export interface PrevChapterRef {
  no: number
  title: string
  text: string
}

/** 组装结果（写作指令数据源）。 */
export interface ContextPacket {
  bookId: string
  chapterNo: number
  /** L1 全书级：书名/类型/风格一句话 + 全书大纲压缩（≤500 字）。 */
  projectBrief: string
  style: BookConfig['style']
  /** L2：当前章细纲（外部传入优先，否则用 chapter 阶段产物）。 */
  currentBrief: string
  /** L2：本卷细纲（volume 阶段产物；无则用全书大纲）。 */
  volumeOutline: string
  /** L2：前 N 章全文（最近优先）。 */
  prevChapters: PrevChapterRef[]
  /** L3：更早章节摘要（≤200 字/章；缺失时降级为章节首 200 字）。 */
  prevSummaries: Array<{ no: number; text: string }>
  /** L3：书级变量快照（stat_data）。 */
  variableSnapshot?: Record<string, unknown>
  /** L3：lorebook 注入计划（命中条目渲染文本）。 */
  loreInjection: InjectionPlan
  /** 硬约束（字数区间/禁用词/钩子等）。 */
  constraints: string[]
  /** 估算 token（组装后）。 */
  tokenEstimate: number
  /** 预算降级记录（哪一层被裁剪）。 */
  truncatedInfo: string[]
}
