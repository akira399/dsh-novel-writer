/**
 * 端到端装配冒烟：用「真实的 DSH 服务实现 + 真实的构建产物」跑一遍插件装配。
 *
 * 与其它单测的区别：这里不 mock 任何东西，直接 `new` DSH 0.2.0-rc.2 真实的
 * ToolRuntime / SkillRegistry（与桌面版同版本），把 `lib/index.js` 的 apply()
 * 当宿主那样调用。因此它会真实覆盖：
 *   - apply() 是否能在不改动 DSH 契约的情况下跑完（不抛错）
 *   - 每个工具定义是否通过真实 ToolRuntime.register 的 schema 校验
 *   - ctx.skills.register 的字段是否仍被真实 SkillRegistry 接受
 *   - enabled=false 时是否确实注销（门禁语义）
 *   - 工具 execute() 在真实参数下是否可用（含读资产的 novel_prompts）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../src/index.ts'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

let dataDir: string
let ctx: Context
let toolsService: ToolRuntime
let skillsService: SkillRegistry
let registeredRoutes: string[]

/** 最小的 webServer 假件：只记录路由，不监听端口。 */
function fakeWebServer(routes: string[]): { register: (route: { path: string }) => () => void } {
  return {
    register: (route) => {
      routes.push(route.path)
      return () => {
        const at = routes.indexOf(route.path)
        if (at >= 0) routes.splice(at, 1)
      }
    },
  }
}

/** 最小的 systemPrompt 假件：ToolRuntime 构造时会向它注册 schema provider。 */
function fakeSystemPrompt(): { tools: () => () => void; section: () => () => void } {
  return {
    tools: () => () => {},
    section: () => () => {},
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'novel-e2e-'))
  ctx = new Context()
  // ToolRuntime 构造期依赖 systemPrompt（真实运行时由 dsh-system-prompt 提供）
  ctx.provide('systemPrompt', fakeSystemPrompt())
  // 真服务：Service 基类在构造时自行注册（ctx.reflect.provide），无需再 provide
  toolsService = new ToolRuntime(ctx)
  skillsService = new SkillRegistry(ctx)
  registeredRoutes = []
  ctx.provide('webServer', fakeWebServer(registeredRoutes))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('端到端 — 真实 DSH 服务下的插件装配', () => {
  it('apply() 在真实服务上跑通，且注册了全部工具与技能', async () => {
    expect(() => apply(ctx, { enabled: true, dataDir, uiHidden: false })).not.toThrow()

    const names = toolsService.schemas().map((schema) => schema.name).sort()

    // 工具集完整性：novel_* / lorebook_* / 统计
    expect(names).toContain('novel_prompts')
    expect(names).toContain('novel_write_chapter')
    expect(names).toContain('novel_commit_chapter')
    expect(names).toContain('lorebook_list_entries')
    expect(names.filter((n) => n.startsWith('novel_')).length).toBeGreaterThanOrEqual(15)
    expect(names.filter((n) => n.startsWith('lorebook_')).length).toBeGreaterThanOrEqual(10)
    // AGENTS.md 约定：工具必须是 novel_* / lorebook_* / novel_prompts 三类
    for (const name of names) {
      expect(name === 'novel_prompts' || name.startsWith('novel_') || name.startsWith('lorebook_'), '越界工具名: ' + name).toBe(true)
    }
    expect(names.length).toBeGreaterThanOrEqual(41)

    // 技能：真实 SkillRegistry 接受该注册（get 为异步）
    expect(await skillsService.get('novel-writing-workflow')).toBeDefined()

    // GUI 路由：真实注册路径
    expect(registeredRoutes).toContain('/api/novel-writer')
  })

  it('每个工具定义都带 name / description / parameters（真实注册不含空壳）', () => {
    apply(ctx, { enabled: true, dataDir })
    const schemas = toolsService.schemas()
    expect(schemas.length).toBeGreaterThan(0)
    for (const schema of schemas) {
      expect(schema.name, '工具缺 name').toBeTruthy()
      expect(typeof schema.description, schema.name + ' 缺 description').toBe('string')
      expect(schema.description.length, schema.name + ' 描述为空').toBeGreaterThan(0)
    }
  })

  it('enabled=false 时不注册任何工具/技能（门禁语义）', async () => {
    apply(ctx, { enabled: false, dataDir })
    expect(toolsService.schemas()).toHaveLength(0)
    expect(await skillsService.get('novel-writing-workflow')).toBeUndefined()
  })

  it('novel_prompts 工具在真实服务下可执行并读到包内 assets', async () => {
    apply(ctx, { enabled: true, dataDir })
    const definition = toolsService.get('novel_prompts')
    expect(definition, 'novel_prompts 未注册').toBeDefined()

    const result = await definition!.execute({ action: 'list' }, {} as never)
    const payload = JSON.parse(JSON.stringify(result)) as { ok: boolean; value: unknown[] }
    expect(payload.ok).toBe(true)
    // 回归：此前 assets 路径在多级目录布局下解析到 lib/assets/**，
    // 导致提示词库静默为空（ok:true 但 value:[]），必须为非空。
    expect(Array.isArray(payload.value)).toBe(true)
    expect(payload.value.length).toBeGreaterThan(30)

    const text = JSON.stringify(payload.value)
    expect(text).toContain('creation-')
    expect(text).toContain('polish-')
    expect(text).toContain('diagnose-')
  })

  it('技能正文来自包内 SKILL.md（非空），说明资源基址解析正确', async () => {
    apply(ctx, { enabled: true, dataDir })
    const skill = await skillsService.get('novel-writing-workflow')
    expect(skill).toBeDefined()
    expect(skill!.content.length).toBeGreaterThan(200)
    expect(skill!.resourceBase).toMatchObject({ kind: 'directory' })
  })

  it('数据目录按配置创建（host 启动副作用生效）', () => {
    apply(ctx, { enabled: true, dataDir })
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    expect(existsSync(join(dataDir, 'projects'))).toBe(true)
  })
})

/**
 * 构建产物布局冒烟：直接加载 lib/index.js（不是 src/）。
 *
 * 必要性：assets 路径此前固定写成 `'..','assets'`，只在 Rspack 打包布局下成立；
 * 走 tsc 的构建产物里模块落在 lib/<dir>/，实际 assets 在包根，导致提示词库、
 * 技能、预设、示例书籍全部解析失败并静默降级。而 src/ 下的测试看不到这一点
 * （src/x/y.ts 到 assets 恰好是 '..','assets'），所以必须单独跑构建产物。
 */
describe('端到端 — 构建产物布局（lib/）', () => {
  it('从 lib/index.js 装配时，assets 仍能被正确解析（提示词库非空）', async () => {
    const { createRequire } = await import('node:module')
    const req = createRequire(join(ROOT, 'lib', 'index.js'))
    const built = req('./index.js') as { apply: (ctx: Context, config: object) => void }

    const builtCtx = new Context()
    builtCtx.provide('systemPrompt', fakeSystemPrompt())
    const builtTools = new ToolRuntime(builtCtx)
    const builtSkills = new SkillRegistry(builtCtx)
    const dir = mkdtempSync(join(tmpdir(), 'novel-e2e-lib-'))
    const routes: string[] = []
    builtCtx.provide('webServer', fakeWebServer(routes))

    try {
      expect(() => built.apply(builtCtx, { enabled: true, dataDir: dir })).not.toThrow()
      // ctx.inject 的回调在服务就绪后异步触发，给它一个微任务/宏任务窗口
      await new Promise((resolve) => setTimeout(resolve, 20))

      const names = builtTools.schemas().map((s) => s.name)
      expect(names.length).toBeGreaterThanOrEqual(41)
      expect(routes).toContain('/api/novel-writer')

      // 关键回归点：lib/ 布局下的 assets 解析
      const prompts = builtTools.get('novel_prompts')
      expect(prompts).toBeDefined()
      const result = JSON.parse(JSON.stringify(await prompts!.execute({ action: 'list' }, {} as never))) as {
        ok: boolean
        value: unknown[]
      }
      expect(result.ok).toBe(true)
      expect(result.value.length, 'lib/ 布局下提示词库为空 → assets 路径解析错误').toBeGreaterThan(30)

      const skill = await builtSkills.get('novel-writing-workflow')
      expect(skill, 'lib/ 布局下技能未注册（SKILL.md 读不到）').toBeDefined()
      expect(skill!.content.length).toBeGreaterThan(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
