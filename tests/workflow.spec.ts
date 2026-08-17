import { describe, expect, it } from 'vitest'
import {
  PHASE_ORDER,
  canEnter,
  createLedger,
  enter,
  forceApprove,
  nextPhaseOf,
  reopen,
  rollback,
  skip,
  submit,
} from '../src/core/workflow/index.ts'
import type { PhaseLedger } from '../src/core/workflow/index.ts'

const NOW = '2026-08-16T00:00:00.000Z'

function fresh(): PhaseLedger {
  return createLedger('bk_1', NOW)
}

/** 一路批准到指定阶段（辅助：走完整合法链）。 */
function approveThrough(ledger: PhaseLedger, targetIndex: number): PhaseLedger {
  let current = ledger
  for (let i = 0; i <= targetIndex; i += 1) {
    const phaseId = PHASE_ORDER[i]!
    const entered = enter(current, phaseId, NOW)
    if (!entered.ok) throw new Error(`enter ${phaseId} failed: ${entered.error.message}`)
    current = entered.value.ledger
    const submitted = submit(current, phaseId, { passed: true, errorCount: 0, warningCount: 0 }, NOW)
    if (!submitted.ok) throw new Error(`submit ${phaseId} failed`)
    current = submitted.value.ledger
  }
  return current
}

describe('workflow — order and adjacency', () => {
  it('exposes the nine-phase main chain', () => {
    expect(PHASE_ORDER).toEqual([
      'topic', 'setting', 'character', 'outline', 'volume', 'chapter', 'writing', 'revision', 'done',
    ])
    expect(nextPhaseOf('topic')).toBe('setting')
    expect(nextPhaseOf('done')).toBeNull()
  })

  it('creates a ledger with all phases locked and topic current', () => {
    const ledger = fresh()
    expect(ledger.currentPhase).toBe('topic')
    expect(Object.values(ledger.phases).every((p) => p.state === 'locked')).toBe(true)
  })
})

describe('workflow — gate rules', () => {
  it('topic is always enterable; later phases need the previous approved', () => {
    const ledger = fresh()
    expect(canEnter(ledger, 'topic').ok).toBe(true)
    const gate = canEnter(ledger, 'setting')
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toContain('topic')
  })

  it('enter fails without gate and reports INVALID_STATE', () => {
    const ledger = fresh()
    const result = enter(ledger, 'writing', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATE')
  })

  it('skipped previous phase also unlocks the next', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW)
    if (!entered.ok) throw new Error('enter topic')
    const skipped = skip(entered.value.ledger, 'topic', NOW)
    if (!skipped.ok) throw new Error('skip topic')
    expect(canEnter(skipped.value.ledger, 'setting').ok).toBe(true)
  })

  it('rejects unknown phases', () => {
    const result = enter(fresh(), 'nope' as never, NOW)
    expect(result.ok).toBe(false)
  })
})

describe('workflow — full progression', () => {
  it('walks topic → done approving each phase', () => {
    const done = approveThrough(fresh(), PHASE_ORDER.length - 1)
    expect(done.currentPhase).toBe('done')
    expect(done.phases.done.state).toBe('approved')
    expect(done.phases.topic.state).toBe('approved')
  })

  it('submit with errors parks the phase in review', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW)
    if (!entered.ok) throw new Error('enter')
    const submitted = submit(entered.value.ledger, 'topic', { passed: false, errorCount: 2, warningCount: 1 }, NOW)
    expect(submitted.ok).toBe(true)
    if (submitted.ok) {
      expect(submitted.value.ledger.phases.topic.state).toBe('review')
      expect(submitted.value.event.detail).toContain('2 errors')
      // review 状态可再次提交修复
      const retry = submit(submitted.value.ledger, 'topic', { passed: true, errorCount: 0, warningCount: 0 }, NOW)
      expect(retry.ok).toBe(true)
      if (retry.ok) expect(retry.value.ledger.phases.topic.state).toBe('approved')
    }
  })

  it('submit bumps version and records approvedAt', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW)
    if (!entered.ok) throw new Error('enter')
    const s1 = submit(entered.value.ledger, 'topic', { passed: false, errorCount: 1, warningCount: 0 }, NOW)
    if (!s1.ok) throw new Error('s1')
    expect(s1.value.ledger.phases.topic.version).toBe(1)
    const s2 = submit(s1.value.ledger, 'topic', { passed: true, errorCount: 0, warningCount: 0 }, NOW)
    if (!s2.ok) throw new Error('s2')
    expect(s2.value.ledger.phases.topic.version).toBe(2)
    expect(s2.value.ledger.phases.topic.approvedAt).toBe(NOW)
  })

  it('submit is rejected outside in_progress/review', () => {
    const ledger = fresh()
    const result = submit(ledger, 'topic', { passed: true, errorCount: 0, warningCount: 0 }, NOW)
    expect(result.ok).toBe(false)
  })
})

describe('workflow — user overrides', () => {
  it('forceApprove promotes review to approved', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW)
    if (!entered.ok) throw new Error('enter')
    const submitted = submit(entered.value.ledger, 'topic', { passed: false, errorCount: 3, warningCount: 0 }, NOW)
    if (!submitted.ok) throw new Error('submit')
    const forced = forceApprove(submitted.value.ledger, 'topic', NOW)
    expect(forced.ok).toBe(true)
    if (forced.ok) expect(forced.value.ledger.phases.topic.state).toBe('approved')
  })

  it('reopen sends review/in_progress back to in_progress', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW)
    if (!entered.ok) throw new Error('enter')
    const reopened = reopen(entered.value.ledger, 'topic', NOW)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.value.ledger.phases.topic.state).toBe('in_progress')
  })

  it('skip works from locked or in_progress only', () => {
    const ledger = fresh()
    const skipped = skip(ledger, 'setting', NOW)
    expect(skipped.ok).toBe(true)
    if (skipped.ok) expect(skipped.value.ledger.phases.setting.state).toBe('skipped')
    // approved 阶段不能跳过
    const approved = approveThrough(fresh(), 0)
    const again = skip(approved, 'topic', NOW)
    expect(again.ok).toBe(false)
  })
})

describe('workflow — revision rollback', () => {
  it('rolls back from revision to any approved phase and relocks the rest', () => {
    const done = approveThrough(fresh(), PHASE_ORDER.length - 1)
    const rolled = rollback(done, 'outline', NOW)
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      const ledger = rolled.value.ledger
      expect(ledger.currentPhase).toBe('outline')
      expect(ledger.phases.outline.state).toBe('in_progress')
      // outline 之后的已批准阶段被解锁
      expect(ledger.phases.volume.state).toBe('locked')
      expect(ledger.phases.writing.state).toBe('locked')
      // 之前的保持不变
      expect(ledger.phases.topic.state).toBe('approved')
      expect(rolled.value.event.detail).toContain('rolled back from')
    }
  })

  it('refuses rollback outside revision/done', () => {
    const writing = approveThrough(fresh(), 6) // writing approved
    const result = rollback(writing, 'outline', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('revision/done')
  })

  it('refuses rollback to locked or unfinished targets', () => {
    const done = approveThrough(fresh(), PHASE_ORDER.length - 1)
    const result = rollback(done, 'character', NOW) // character 已批准
    expect(result.ok).toBe(true)
    const done2 = approveThrough(fresh(), PHASE_ORDER.length - 1)
    const bad = rollback(done2, 'done', NOW)
    expect(bad.ok).toBe(false)
  })

  it('audit events carry phase, actor and detail', () => {
    const ledger = fresh()
    const entered = enter(ledger, 'topic', NOW, 'user')
    expect(entered.ok).toBe(true)
    if (entered.ok) {
      expect(entered.value.event.action).toBe('enter')
      expect(entered.value.event.phase).toBe('topic')
      expect(entered.value.event.actor).toBe('user')
    }
  })
})
