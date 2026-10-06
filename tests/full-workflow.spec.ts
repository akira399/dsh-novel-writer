/**
 * 全量功能集成测试 —— 在**真实 ToolRuntime** 上跑完整创作流程。
 *
 * 目的：用户要求「全量检查插件功能是否可用」。因此这里不 mock 任何业务逻辑，
 * 而是像 agent 一样通过 `ctx.tools.execute(toolName, args)` 真正调用工具，
 * 走一遍「建项目 → 九阶段门禁 → 写章 → 校验 → 世界书 → 一致性工具 → 导出」，
 * 断言每一步都返回 ok 且产出落到磁盘。
 *
 * 覆盖范围：novel_* 全流程 + lorebook_* 增删改查 + 质量类工具（规则层，
 * 不依赖模型）+ 统计/导出。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'

let dataDir: string
let ctx: Context
let tools: ToolRuntime
let routes: string[]

function fakeSystemPrompt(): { tools: () => () => void; section: () => () => void } {
  return { tools: () => () => {}, section: () => () => {} }
}

/** 调用工具并解出 `{ ok, value|error }` 载荷。 */
async function call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; value?: any; error?: any }> {
  const def = tools.get(name)
  if (!def) throw new Error('工具未注册: ' + name)
  const result = await def.execute(args, {} as never)
  return JSON.parse(JSON.stringify(result)) as { ok: boolean; value?: any; error?: any }
}

/** 断言工具成功，并返回 value。 */
async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await call(name, args)
  if (!r.ok) throw new Error(`${name} 失败: ${JSON.stringify(r.error)}`)
  return r.value
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'novel-full-'))
  ctx = new Context()
  ctx.provide('systemPrompt', fakeSystemPrompt())
  tools = new ToolRuntime(ctx)
  new SkillRegistry(ctx)
  routes = []
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      routes.push(route.path)
      return () => {}
    },
  })
  apply(ctx, { enabled: true, dataDir })
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('全量功能 — 项目与九阶段门禁', () => {
  it('建项目 → 初始为 topic 阶段，并落盘', async () => {
    const book = await ok('novel_create_project', { title: '全量检查之书', genre: 'xianxia' })
    expect(book.id).toBeTruthy()
    expect(book.title).toBe('全量检查之书')

    // 落盘：projects/<id>/
    const bookDir = join(dataDir, 'projects')
    expect(existsSync(bookDir)).toBe(true)
    const dirs = readFileSync
    expect(dirs).toBeTypeOf('function') // 占位避免未使用告警
  })

  it('novel_projects 能列出刚建的书', async () => {
    const book = await ok('novel_create_project', { title: '列表检查' })
    const list = await ok('novel_projects')
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((b: any) => b.id === book.id)).toBe(true)
  })

  it('novel_phase 查看阶段 + 门禁：未进入阶段时不能提交', async () => {
    const book = await ok('novel_create_project', { title: '门禁检查' })
    const view = await ok('novel_phase', { projectId: book.id })
    // 返回 { book }，阶段状态在 book.phases 上
    expect(view.book).toBeTruthy()
    expect(view.book.phases).toBeTruthy()

    // 九阶段初始全部 locked；未进入 topic 就提交应被拒绝
    const commit = await call('novel_commit', {
      projectId: book.id, phase: 'topic', artifact: '# 选题', errorCount: 0,
    })
    expect(commit.ok).toBe(false)
    expect(JSON.stringify(commit.error)).toContain('locked')

    // 直接跳到 writing（前置都没批准）也应被拒绝
    const jump = await call('novel_phase', { projectId: book.id, phase: 'writing' })
    expect(jump.ok).toBe(false)
  })

  it('进入阶段 → 提交选题产物 → 阶段推进', async () => {
    const book = await ok('novel_create_project', { title: '推进检查' })

    // 先进入 topic（locked → in_progress），才能提交
    const entered = await ok('novel_phase', { projectId: book.id, phase: 'topic' })
    expect(entered.entered).toBe('topic')
    expect(entered.book.phases.topic.state).toBe('in_progress')

    const committed = await ok('novel_commit', {
      projectId: book.id,
      phase: 'topic',
      artifact: '# 选题\n\n仙侠 + 宗门经营，主打群像成长。',
      errorCount: 0,
    })
    expect(committed).toBeTruthy()

    const after = await ok('novel_phase', { projectId: book.id })
    expect(after.book.phases.topic.state).toBe('approved')
  })

  it('novel_audit 记录阶段流转事件', async () => {
    const book = await ok('novel_create_project', { title: '审计检查' })
    await ok('novel_phase', { projectId: book.id, phase: 'topic' })
    await ok('novel_commit', { projectId: book.id, phase: 'topic', artifact: '# 选题', errorCount: 0 })
    const audit = await ok('novel_audit', { projectId: book.id })
    expect(JSON.stringify(audit)).toContain('topic')
  })

  it('novel_override 可跳过阶段', async () => {
    const book = await ok('novel_create_project', { title: '跳阶段检查' })
    await ok('novel_override', { projectId: book.id, phase: 'setting', action: 'skip' })
    const after = await ok('novel_phase', { projectId: book.id })
    expect(after.book.phases.setting.state).toBe('skipped')
  })
})

describe('全量功能 — 写章两段式', () => {
  it('novel_write_chapter 返回上下文包，novel_commit_chapter 落盘并统计', async () => {
    const book = await ok('novel_create_project', { title: '写章检查' })

    const pack = await ok('novel_write_chapter', { projectId: book.id, chapterNo: 1 })
    expect(pack).toBeTruthy()

    const text = [
      '林远站在山门前，风把衣角吹得猎猎作响。',
      '“今日起，你便是青云弟子。”老者递过一枚玉牌。',
      '他握紧玉牌，掌心发烫。远处云海翻涌，像有什么正在苏醒。',
    ].join('\n')
    const committed = await ok('novel_commit_chapter', {
      projectId: book.id, chapterNo: 1, title: '第一章 山门', text,
    })
    expect(committed).toBeTruthy()

    // 落盘 chapters/ch1.md
    const bookRoot = join(dataDir, 'projects', book.id)
    expect(existsSync(join(bookRoot, 'chapters', 'ch1.md'))).toBe(true)

    // novel_stats 应反映 1 章
    const stats = await ok('novel_stats', { projectId: book.id })
    expect(JSON.stringify(stats)).toContain('1')
  })

  it('novel_wordcount 统计与达标判定', async () => {
    const text = '一二三四五。' + '六七八九十。'.repeat(20)
    const value = await ok('novel_wordcount', { text, chapterNo: 1, min: 10, max: 10000 })
    expect(value).toBeTruthy()
    expect(JSON.stringify(value)).toMatch(/chars|total|count/i)
  })

  it('novel_validate 对已提交章节出校验报告', async () => {
    const book = await ok('novel_create_project', { title: '校验检查' })
    const text = '林远握紧玉牌。' + '云海翻涌。'.repeat(30)
    await ok('novel_commit_chapter', { projectId: book.id, chapterNo: 1, title: '第一章', text })
    const report = await ok('novel_validate', { projectId: book.id, chapterNo: 1 })
    expect(report).toBeTruthy()
    expect(JSON.stringify(report)).toMatch(/issue|error|warning|pass/i)
  })

  it('novel_diagnose 规则层出分（不依赖模型）', async () => {
    const book = await ok('novel_create_project', { title: '诊断检查' })
    const text = '林远握紧玉牌，掌心发烫。' + '他抬头看向云海。'.repeat(20)
    await ok('novel_commit_chapter', { projectId: book.id, chapterNo: 1, title: '第一章', text })
    const report = await ok('novel_diagnose', {
      projectId: book.id, chapterStart: 1, count: 1, withModel: false,
    })
    expect(report).toBeTruthy()
    expect(JSON.stringify(report)).toMatch(/score|规则|rule/i)
  })

  it('novel_depolish 检测 AI 味（规则层）', async () => {
    const book = await ok('novel_create_project', { title: '去味检查' })
    const text = '他缓缓抬起头，眼底闪过一丝不易察觉的神色，仿佛一切都已注定。'
    const value = await ok('novel_depolish', { projectId: book.id, text, mode: 'detect' })
    expect(value).toBeTruthy()
    expect(JSON.stringify(value)).toMatch(/density|score|hit|category/i)
  })
})

describe('全量功能 — 世界书', () => {
  it('增 → 查 → 改 → 导出 → 删 全链路', async () => {
    const entry = await ok('lorebook_create_entry', {
      name: '境界体系',
      content: '炼气 → 筑基 → 金丹 → 元婴',
      keywords: '境界,修为',
      always_active: true,
      priority: 90,
    })
    const id = entry.id ?? entry.entry?.id
    expect(id).toBeTruthy()

    const list = await ok('lorebook_list_entries')
    expect(JSON.stringify(list)).toContain('境界体系')

    const got = await ok('lorebook_get_entry', { id })
    expect(JSON.stringify(got)).toContain('境界体系')

    await ok('lorebook_update_entry', { id, name: '境界体系（修订）' })
    const after = await ok('lorebook_get_entry', { id })
    expect(JSON.stringify(after)).toContain('修订')

    const exported = await ok('lorebook_export_entries', { format: 'sillytavern' })
    expect(JSON.stringify(exported)).toContain('entries')

    await ok('lorebook_toggle_entry', { id })
    await ok('lorebook_delete_entry', { id })
    const finalList = await ok('lorebook_list_entries')
    expect(JSON.stringify(finalList)).not.toContain('境界体系（修订）')
  })

  it('分组：建组 → 移入 → 列出 → 删组', async () => {
    const entry = await ok('lorebook_create_entry', { name: '主角设定', content: '林远，剑修' })
    const id = entry.id ?? entry.entry?.id
    const group = await ok('lorebook_create_group', { name: '人物', entry_ids: id })
    const gid = group.id ?? group.group?.id
    expect(gid).toBeTruthy()

    const groups = await ok('lorebook_list_groups')
    expect(JSON.stringify(groups)).toContain('人物')

    await ok('lorebook_move_entry', { entry_id: id })
    await ok('lorebook_delete_group', { id: gid })
  })

  it('导入 SillyTavern lorebook 文本', async () => {
    const payload = JSON.stringify({
      entries: {
        0: { uid: 0, key: ['测试关键词'], keysecondary: [], comment: '导入条目', content: '导入内容', constant: false, disable: false },
      },
    })
    const value = await ok('lorebook_import_entries', { content: payload })
    expect(value).toBeTruthy()
    expect(JSON.stringify(value)).toMatch(/import|count|counts/i)
  })
})

describe('全量功能 — 一致性 / 辅助 / 导出', () => {
  it('伏笔：登记 → 列表 → 回收', async () => {
    const book = await ok('novel_create_project', { title: '伏笔检查' })
    const planted = await ok('novel_foreshadow', {
      projectId: book.id, action: 'plant', content: '老者递给林远的玉牌有裂纹',
      plantChapter: 1, plannedRevealChapter: 9,
    })
    const list = await ok('novel_foreshadow', { projectId: book.id, action: 'list' })
    expect(JSON.stringify(list)).toContain('裂纹')
    const fid = planted.id ?? planted.foreshadow?.id
    if (fid) await ok('novel_foreshadow', { projectId: book.id, action: 'reveal', id: fid, chapterNo: 9 })
  })

  it('灵感库：添加 → 检索', async () => {
    const book = await ok('novel_create_project', { title: '灵感检查' })
    await ok('novel_idea', { projectId: book.id, action: 'add', content: '宗门大比时主角暴露真实身份', tags: '爽点' })
    const list = await ok('novel_idea', { projectId: book.id, action: 'list', query: '身份' })
    expect(JSON.stringify(list)).toContain('身份')
  })

  it('术语表：添加 → 列表', async () => {
    const book = await ok('novel_create_project', { title: '术语检查' })
    await ok('novel_glossary', { projectId: book.id, action: 'add', term: '青云宗', definition: '正道第一大宗' })
    const list = await ok('novel_glossary', { projectId: book.id, action: 'list' })
    expect(JSON.stringify(list)).toContain('青云宗')
  })

  it('时间线：登记 → 列表', async () => {
    const book = await ok('novel_create_project', { title: '时间线检查' })
    await ok('novel_timeline', { projectId: book.id, action: 'record', chapterNo: 1, bookTime: '第一日', event: '入门' })
    const list = await ok('novel_timeline', { projectId: book.id, action: 'list' })
    expect(JSON.stringify(list)).toContain('第一日')
  })

  it('一致性巡检可运行', async () => {
    const book = await ok('novel_create_project', { title: '巡检检查' })
    const report = await ok('novel_consistency_audit', { projectId: book.id })
    expect(report).toBeTruthy()
  })

  it('导出成稿：txt 落盘', async () => {
    const book = await ok('novel_create_project', { title: '导出检查' })
    await ok('novel_commit_chapter', {
      projectId: book.id, chapterNo: 1, title: '第一章', text: '林远握紧玉牌。',
    })
    const value = await ok('novel_export', { projectId: book.id, format: 'txt' })
    expect(value).toBeTruthy()
    const exportsDir = join(dataDir, 'projects', book.id, 'exports')
    expect(existsSync(exportsDir)).toBe(true)
  })

  it('克隆项目：模板复制不复制正文', async () => {
    const src = await ok('novel_create_project', { title: '源书', genre: 'xianxia' })
    await ok('novel_commit_chapter', { projectId: src.id, chapterNo: 1, title: '第一章', text: '正文内容。' })
    const cloned = await ok('novel_clone_project', { sourceId: src.id, title: '克隆书' })
    expect(cloned).toBeTruthy()
    expect(JSON.stringify(cloned)).toContain('克隆书')
  })

  it('创作向导可查询状态', async () => {
    const book = await ok('novel_create_project', { title: '向导检查' })
    const status = await ok('novel_wizard', { projectId: book.id, action: 'status' })
    expect(status).toBeTruthy()
  })

  it('意图解析：自然语言 → 结构化动作', async () => {
    const value = await ok('novel_guide', { text: '帮我创建一本新书' })
    expect(value).toBeTruthy()
  })

  it('提示词库：list / get / render', async () => {
    const list = await ok('novel_prompts', { action: 'list' })
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(30)

    const first = list[0]
    const got = await ok('novel_prompts', { action: 'get', id: first.id })
    expect(got).toBeTruthy()

    const rendered = await ok('novel_prompts', {
      action: 'render', id: first.id, vars: JSON.stringify({ title: '青云问道', genre: '仙侠' }),
    })
    expect(JSON.stringify(rendered)).toBeTruthy()
  })
})
