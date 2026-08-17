/**
 * dsh-novel-writer — 九阶段流程状态机引擎（P1-A）。
 *
 * 纯函数设计：所有操作接收 PhaseLedger 返回新 ledger + 审计事件，
 * 无 IO 无 cordis 依赖（持久化在 P1-B）。门禁规则（DEVELOPMENT-PLAN §3.1）：
 *  1. 前一阶段必须 approved 或 skipped，当前阶段才能 in_progress；
 *  2. submit 时 report.errorCount>0 → review 挂起（不自动推进）；
 *  3. 校验通过 → approved；
 *  4. 用户可 force（强制放行）或 reopen（驳回回 in_progress）；
 *  5. revision 阶段允许 rollback 到任意已 approved/skipped 阶段；
 *  6. done 为终态。
 */
import type { PluginError, Result } from '../types.ts'
import type { AuditEvent, PhaseId, PhaseLedger, PhaseRecord, PhaseReport, PhaseState } from './types.ts'

/** 九阶段线性主链（顺序即索引）。 */
export const PHASE_ORDER: readonly PhaseId[] = [
  'topic', 'setting', 'character', 'outline', 'volume', 'chapter', 'writing', 'revision', 'done',
]

export const PHASE_INDEX: Readonly<Record<PhaseId, number>> = Object.freeze(
  Object.fromEntries(PHASE_ORDER.map((id, index) => [id, index])) as Record<PhaseId, number>,
)

/** 相邻下一阶段（done 之后为 null）。 */
export function nextPhaseOf(id: PhaseId): PhaseId | null {
  const index = PHASE_INDEX[id]
  return index === undefined ? null : (PHASE_ORDER[index + 1] ?? null)
}

function invalid(message: string): PluginError {
  return { code: 'INVALID_STATE', message }
}

/** 阶段推进许可判定：前一阶段必须 approved/skipped（topic 恒可进）。 */
export function canEnter(ledger: PhaseLedger, phaseId: PhaseId): { ok: true } | { ok: false; reason: string } {
  if (!(phaseId in PHASE_INDEX)) return { ok: false, reason: `未知阶段: ${phaseId}` }
  const previous = PHASE_ORDER[PHASE_INDEX[phaseId] - 1]
  if (previous === undefined) return { ok: true }
  const record = ledger.phases[previous]
  if (!record) return { ok: false, reason: `前置阶段 ${previous} 尚未建立` }
  if (record.state === 'approved' || record.state === 'skipped') return { ok: true }
  return { ok: false, reason: `前置阶段 ${previous} 处于 ${record.state}，需 approved/skipped 后才能进入 ${phaseId}` }
}

/** 新建 ledger（项目创建时调用；topic 直接可进入）。 */
export function createLedger(id: string, now: string): PhaseLedger {
  const phases = Object.fromEntries(
    PHASE_ORDER.map((phaseId) => [phaseId, { id: phaseId, state: 'locked' as PhaseState, version: 0 }]),
  ) as Record<PhaseId, PhaseRecord>
  return { id, phases, currentPhase: 'topic' }
}

/** 进入阶段（门禁未过返回 INVALID_STATE）。已 approved/skipped 的阶段不可重入（须先驳回）。 */
export function enter(ledger: PhaseLedger, phaseId: PhaseId, now: string, actor: AuditEvent['actor'] = 'agent'): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const gate = canEnter(ledger, phaseId)
  if (!gate.ok) return { ok: false, error: invalid(gate.reason) }
  const existing = ledger.phases[phaseId]
  if (existing && (existing.state === 'approved' || existing.state === 'skipped')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 已 ${existing.state}，不能重复进入（需先驳回）`) }
  }
  const next = clone(ledger)
  next.currentPhase = phaseId
  next.phases[phaseId] = { ...next.phases[phaseId], state: 'in_progress', startedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'enter', phase: phaseId, actor, detail: 'in_progress' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/**
 * 提交阶段产物（唯一推进入口语义）：
 * report.passed → approved；errorCount>0 → review 挂起；其余按 passed 判定。
 */
export function submit(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  report: PhaseReport,
  now: string,
  actor: AuditEvent['actor'] = 'agent',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = ledger.phases[phaseId]
  if (!record || record.state !== 'in_progress' && record.state !== 'review') {
    return { ok: false, error: invalid(`阶段 ${phaseId} 当前状态 ${record?.state ?? '缺失'}，不能提交`) }
  }
  const next = clone(ledger)
  const target: PhaseState = report.errorCount > 0 ? 'review' : report.passed ? 'approved' : 'review'
  next.phases[phaseId] = {
    ...next.phases[phaseId],
    state: target,
    version: next.phases[phaseId].version + 1,
    lastReport: report,
    ...(target === 'approved' ? { approvedAt: now } : {}),
  }
  const detail = target === 'approved' ? 'approved' : `review(${report.errorCount} errors, ${report.warningCount} warnings)`
  const event: AuditEvent = { seq: 0, at: now, action: 'submit', phase: phaseId, actor, detail }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 用户强制放行（review → approved；记录审计，不校验报告）。 */
export function forceApprove(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = ledger.phases[phaseId]
  if (!record || (record.state !== 'review' && record.state !== 'in_progress')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能强制放行`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...next.phases[phaseId], state: 'approved', approvedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'force', phase: phaseId, actor, detail: 'force approved' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 驳回（review/in_progress → 回 in_progress 继续修改）。 */
export function reopen(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = ledger.phases[phaseId]
  if (!record || record.state === 'locked' || record.state === 'approved' || record.state === 'skipped') {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能驳回`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...next.phases[phaseId], state: 'in_progress' }
  const event: AuditEvent = { seq: 0, at: now, action: 'reopen', phase: phaseId, actor, detail: 'reopened' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/** 用户跳过阶段（approved 替代语义；不改变 currentPhase 之外的推进）。 */
export function skip(
  ledger: PhaseLedger,
  phaseId: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const record = ledger.phases[phaseId]
  if (!record || (record.state !== 'locked' && record.state !== 'in_progress')) {
    return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能跳过`) }
  }
  const next = clone(ledger)
  next.phases[phaseId] = { ...next.phases[phaseId], state: 'skipped' }
  const event: AuditEvent = { seq: 0, at: now, action: 'skip', phase: phaseId, actor, detail: 'skipped' }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

/**
 * 回退（修订回环）：把 currentPhase 置回目标阶段并置 in_progress。
 * 规则：仅当 currentPhase 是 revision（或 done）时允许；目标必须已 approved/skipped。
 * 回退也会清除目标之后阶段的 approved 状态（置 locked），保证重新走。
 */
export function rollback(
  ledger: PhaseLedger,
  target: PhaseId,
  now: string,
  actor: AuditEvent['actor'] = 'user',
): Result<{ ledger: PhaseLedger; event: AuditEvent; seq: number }> {
  const current = ledger.phases[ledger.currentPhase]
  if (!current) return { ok: false, error: invalid('当前阶段缺失') }
  if (ledger.currentPhase !== 'revision' && ledger.currentPhase !== 'done') {
    return { ok: false, error: invalid(`仅 revision/done 阶段可回退，当前是 ${ledger.currentPhase}`) }
  }
  if (target === 'done' || target === 'revision') return { ok: false, error: invalid(`不能回退到 ${target}`) }
  const targetRecord = ledger.phases[target]
  if (!targetRecord || (targetRecord.state !== 'approved' && targetRecord.state !== 'skipped')) {
    return { ok: false, error: invalid(`目标阶段 ${target} 状态 ${targetRecord?.state ?? '缺失'}，需 approved/skipped`) }
  }
  const next = clone(ledger)
  // 目标之后的已批准阶段全部解锁（重新走），并清除 approved 残留元数据
  const targetIndex = PHASE_INDEX[target]
  for (const phaseId of PHASE_ORDER) {
    const index = PHASE_INDEX[phaseId]
    if (index > targetIndex && (next.phases[phaseId].state === 'approved' || next.phases[phaseId].state === 'skipped')) {
      const { approvedAt: _dropped, ...rest } = next.phases[phaseId]
      void _dropped
      next.phases[phaseId] = { ...rest, state: 'locked' }
    }
  }
  next.currentPhase = target
  const { approvedAt: _targetApprovedAt, ...targetRest } = next.phases[target]
  void _targetApprovedAt
  next.phases[target] = { ...targetRest, state: 'in_progress', startedAt: now }
  const event: AuditEvent = { seq: 0, at: now, action: 'rollback', phase: target, actor, detail: `rolled back from ${ledger.currentPhase}` }
  return { ok: true, value: { ledger: next, event, seq: 0 } }
}

function clone(ledger: PhaseLedger): PhaseLedger {
  return {
    id: ledger.id,
    currentPhase: ledger.currentPhase,
    phases: Object.fromEntries(
      PHASE_ORDER.map((phaseId) => [phaseId, { ...ledger.phases[phaseId] }]),
    ) as Record<PhaseId, PhaseRecord>,
  }
}
