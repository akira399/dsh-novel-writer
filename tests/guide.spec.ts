import { describe, expect, it } from 'vitest'
import {
  createWizard,
  parseIntent,
  wizardCommit,
  wizardNext,
  wizardSkip,
} from '../src/core/guide/index.ts'
import type { WizardState } from '../src/core/guide/index.ts'

const NOW = '2026-08-16T00:00:00.000Z'

describe('wizard — state machine', () => {
  it('starts at genre and walks the five steps', () => {
    const wizard = createWizard(NOW)
    expect(wizard.step).toBe('genre')
    expect(wizard.readyToWrite).toBe(false)

    // genre → title
    const c1 = wizardCommit(wizard, 'genre', 'fantasy', NOW)
    expect(c1.ok).toBe(true)
    if (!c1.ok) return
    const n1 = wizardNext(c1.value, NOW)
    expect(n1.ok).toBe(true)
    if (!n1.ok) return
    expect(n1.value.step).toBe('title')

    // title → setting
    const c2 = wizardCommit(n1.value.state, 'title', '青云问道', NOW)
    if (!c2.ok) return
    const n2 = wizardNext(c2.value, NOW)
    if (!n2.ok) return
    expect(n2.value.step).toBe('setting')

    // setting → outline
    const c3 = wizardCommit(n2.value.state, 'setting', '设定文本', NOW)
    if (!c3.ok) return
    const n3 = wizardNext(c3.value, NOW)
    if (!n3.ok) return
    expect(n3.value.step).toBe('outline')

    // outline → start
    const c4 = wizardCommit(n3.value.state, 'outline', '大纲文本', NOW)
    if (!c4.ok) return
    const n4 = wizardNext(c4.value, NOW)
    if (!n4.ok) return
    expect(n4.value.step).toBe('start')

    // start done → readyToWrite
    const c5 = wizardCommit(n4.value.state, 'start', '开始写作', NOW)
    if (!c5.ok) return
    expect(c5.value.readyToWrite).toBe(true)
    const n5 = wizardNext(c5.value, NOW)
    if (!n5.ok) return
    expect(n5.value.step).toBeNull()
  })

  it('rejects advancing before the current step is done', () => {
    const wizard = createWizard(NOW)
    const next = wizardNext(wizard, NOW)
    expect(next.ok).toBe(false)
    if (!next.ok) expect(next.error.code).toBe('INVALID_STATE')
  })

  it('supports skipping steps', () => {
    const wizard = createWizard(NOW)
    const skipped = wizardSkip(wizard, 'genre', NOW)
    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    expect(skipped.value.status.genre).toBe('skipped')
    const next = wizardNext(skipped.value, NOW)
    if (!next.ok) return
    expect(next.value.step).toBe('title')
  })

  it('rejects empty artifacts', () => {
    const wizard = createWizard(NOW)
    const commit = wizardCommit(wizard, 'genre', '   ', NOW)
    expect(commit.ok).toBe(false)
  })

  it('skips already-done steps when advancing', () => {
    const wizard = createWizard(NOW)
    const c1 = wizardCommit(wizard, 'genre', 'x', NOW)
    if (!c1.ok) return
    // 手工把 title 标 done（模拟恢复场景）
    const patched: WizardState = { ...c1.value, status: { ...c1.value.status, title: 'done' } }
    const next = wizardNext(patched, NOW)
    if (!next.ok) return
    expect(next.value.step).toBe('setting')
  })
})

describe('intent — rule channel', () => {
  it('maps common writing commands', () => {
    expect(parseIntent('帮我写下一章')?.action).toBe('novel_write_chapter')
    expect(parseIntent('继续写')?.action).toBe('novel_write_chapter')
    expect(parseIntent('写第 5 章')?.action).toBe('novel_write_chapter')
  })

  it('maps polish and diagnosis commands', () => {
    const depolish = parseIntent('把这段去 AI 味')
    expect(depolish?.action).toBe('novel_depolish')
    expect(depolish?.confirmRequired).toBe(true)

    expect(parseIntent('润色第三章')?.action).toBe('novel_revise')
    expect(parseIntent('帮我检查一下开头有没有问题')?.action).toBe('novel_diagnose')
    expect(parseIntent('黄金三章诊断')?.action).toBe('novel_diagnose')
  })

  it('maps phase commands with params', () => {
    expect(parseIntent('帮我生成世界观设定')?.params).toMatchObject({ phase: 'setting' })
    expect(parseIntent('设计人设')?.params).toMatchObject({ phase: 'character' })
    expect(parseIntent('写全书大纲')?.params).toMatchObject({ phase: 'outline' })
    expect(parseIntent('分卷规划')?.params).toMatchObject({ phase: 'volume' })
    expect(parseIntent('第三章细纲')?.params).toMatchObject({ phase: 'chapter' })
  })

  it('maps query and create commands', () => {
    expect(parseIntent('林远现在什么境界')?.action).toBe('novel_ledger')
    expect(parseIntent('记个灵感：雨夜剑冢')?.action).toBe('novel_idea')
    expect(parseIntent('创建项目，写本都市小说')?.action).toBe('novel_create_project')
    expect(parseIntent('全书多少字了')?.action).toBe('novel_wordcount')
    expect(parseIntent('导出成稿')?.action).toBe('novel_export')
    expect(parseIntent('帮我查查玄幻市场行情')?.action).toBe('novel_market_research')
    expect(parseIntent('克隆青云问道当模板')?.action).toBe('novel_clone_project')
  })

  it('returns null for free-form chat', () => {
    expect(parseIntent('今天天气不错')).toBeNull()
    expect(parseIntent('')).toBeNull()
  })
})
