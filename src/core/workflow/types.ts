/**
 * dsh-novel-writer — 九阶段创作流程状态机（P1-A）。
 *
 * 职责：定义阶段顺序、阶段记录、审计事件等纯类型。
 * 引擎函数见 engine.ts；持久化由 novel 存储模块（P1-B）负责。
 * 语义对齐 DEVELOPMENT-PLAN.md §3.1：九阶段线性主链 + 修订回环。
 */

/** 九个创作阶段（线性主链，revision 允许回退）。 */
export type PhaseId =
  | 'topic'        // 选题
  | 'setting'      // 核心设定
  | 'character'    // 人设
  | 'outline'      // 全书大纲
  | 'volume'       // 分卷
  | 'chapter'      // 分章细纲
  | 'writing'      // 正文
  | 'revision'     // 修订
  | 'done'         // 完本

/** 阶段实例状态（DEVELOPMENT-PLAN §3.1）。 */
export type PhaseState = 'locked' | 'in_progress' | 'review' | 'approved' | 'skipped'

/** 阶段产物校验报告摘要（提交门禁用；完整报告由 quality 模块产出，P2）。 */
export interface PhaseReport {
  /** 是否通过门禁（无 error 级问题）。 */
  passed: boolean
  /** error 级问题数（>0 时进入 review 挂起）。 */
  errorCount: number
  /** warning 级问题数（仅提示不阻断）。 */
  warningCount: number
  /** 校验器集合 id（调试/审计用）。 */
  rules?: string[]
}

/** 单个阶段的持久化记录。 */
export interface PhaseRecord {
  id: PhaseId
  state: PhaseState
  /** 产物修订次数（每次 commit +1；版本快照见存储层）。 */
  version: number
  /** 最近一次提交的校验报告摘要。 */
  lastReport?: PhaseReport
  /** 进入 approved 的时间。 */
  approvedAt?: string
  /** 进入 in_progress 的时间。 */
  startedAt?: string
}

/** 审计事件（append-only；audit.jsonl 每行一条）。 */
export interface AuditEvent {
  seq: number
  at: string
  action: 'enter' | 'submit' | 'reopen' | 'skip' | 'force' | 'rollback' | 'create'
  phase: PhaseId
  /** 触发方：user | agent | system。 */
  actor: 'user' | 'agent' | 'system'
  /** 结果摘要（如 "approved" / "review(2 errors)" / "skipped"）。 */
  detail: string
}

/** 状态机操作的最小视图（Book 的 workflow 面；完整 Book 见 novel 存储模块）。 */
export interface PhaseLedger {
  id: string
  phases: Record<PhaseId, PhaseRecord>
  currentPhase: PhaseId
}
