/**
 * GUI 数据面（HTTP 路由）集成测试 —— 真实调用 handler。
 *
 * 用户要求「确认桌面客户端里能正常用」。抽屉的数据全靠这几个端点，
 * 所以这里不去 mock 业务层，而是像浏览器一样构造 req/res 直接调用
 * `registerNovelRoutes` 注册进来的 handler，断言状态码与 JSON 载荷。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'

const FENCE = 'x-dsh-novel-writer'

let dataDir: string
let ctx: Context
let handler: ((req: any, res: any) => Promise<void>) | null

/** 最小 req 假件（可写 body 的 EventEmitter）。 */
function makeReq(method: string, url: string, body?: unknown, trusted = true): any {
  const req = new EventEmitter() as any
  req.method = method
  req.url = url
  req.headers = trusted ? { [FENCE]: '1' } : {}
  if (body !== undefined) {
    req.bodyContent = JSON.stringify(body)
  }
  // handler 里通过 req.on('data'/'end') 读体
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

/** 最小 res 假件：记录 status / headers / body。 */
function makeRes(): any {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers?: Record<string, string>) {
      res.statusCode = code
      if (headers) Object.assign(res.headers, headers)
      return res
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk
    },
  }
  return res
}

async function request(method: string, url: string, body?: unknown, trusted = true) {
  const res = makeRes()
  await handler!(makeReq(method, url, body, trusted), res)
  let json: any
  try {
    json = JSON.parse(res.body)
  } catch {
    json = undefined
  }
  return { status: res.statusCode, json, raw: res.body }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'novel-http-'))
  ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  new ToolRuntime(ctx)
  new SkillRegistry(ctx)
  handler = null
  ctx.provide('webServer', {
    register: (route: { path: string; handler: (req: any, res: any) => Promise<void> }) => {
      if (route.path === '/api/novel-writer') handler = route.handler
      return () => {}
    },
  })
  apply(ctx, { enabled: true, dataDir })
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('GUI 数据面 — HTTP 端点', () => {
  it('路由已注册为 prefix /api/novel-writer', () => {
    expect(handler, 'handler 应已注册').toBeTypeOf('function')
  })

  it('GET /projects 返回空列表', async () => {
    const r = await request('GET', '/api/novel-writer/projects')
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.value).toEqual([])
  })

  it('POST /projects 建项目；无 fence 头应 403', async () => {
    const denied = await request('POST', '/api/novel-writer/projects', { title: 'x' }, false)
    expect(denied.status).toBe(403)

    const created = await request('POST', '/api/novel-writer/projects', {
      title: 'GUI 检查之书', genre: 'xianxia',
    })
    expect(created.status).toBe(200)
    expect(created.json.ok).toBe(true)
    const id = created.json.value.id
    expect(id).toBeTruthy()

    // 再列一次应能看到
    const list = await request('GET', '/api/novel-writer/projects')
    expect(JSON.stringify(list.json.value)).toContain('GUI 检查之书')
  })

  it('GET /projects/<id> 返回项目详情 + 审计尾部', async () => {
    const created = await request('POST', '/api/novel-writer/projects', { title: '详情检查' })
    const id = created.json.value.id
    const detail = await request('GET', `/api/novel-writer/projects/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.json.ok).toBe(true)
    expect(JSON.stringify(detail.json.value)).toContain('详情检查')
  })

  it('GET /projects/<id>/context/<no> 返回写章上下文包（抽屉「一键写章」依赖）', async () => {
    const created = await request('POST', '/api/novel-writer/projects', { title: '上下文检查' })
    const id = created.json.value.id
    const r = await request('GET', `/api/novel-writer/projects/${id}/context/1`)
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(JSON.stringify(r.json.value).length).toBeGreaterThan(50)
  })

  it('POST /projects/<id>/chapters/<no> 保存章节正文并落盘', async () => {
    const created = await request('POST', '/api/novel-writer/projects', { title: '存章检查' })
    const id = created.json.value.id
    const saved = await request('POST', `/api/novel-writer/projects/${id}/chapters/1`, {
      title: '第一章 山门', text: '林远握紧玉牌，掌心发烫。',
    })
    expect(saved.status).toBe(200)
    expect(saved.json.ok).toBe(true)

    const read = await request('GET', `/api/novel-writer/projects/${id}/chapters/1`)
    expect(read.status).toBe(200)
    // 契约：返回 { ok, value: 剥离 frontmatter 的纯正文 }
    expect(read.json.ok).toBe(true)
    expect(String(read.json.value)).toContain('林远握紧玉牌')
  })

  it('GET /projects/<id>/diagnose/<no> 返回诊断（抽屉「诊断」依赖）', async () => {
    const created = await request('POST', '/api/novel-writer/projects', { title: '诊断检查' })
    const id = created.json.value.id
    await request('POST', `/api/novel-writer/projects/${id}/chapters/1`, {
      title: '第一章', text: '林远握紧玉牌。' + '云海翻涌。'.repeat(30),
    })
    const r = await request('GET', `/api/novel-writer/projects/${id}/diagnose/1`)
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
  })

  it('POST /demo 一键导入示例项目（抽屉「一键导入示例」依赖）', async () => {
    const r = await request('POST', '/api/novel-writer/demo')
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)

    const list = await request('GET', '/api/novel-writer/projects')
    expect(list.json.value.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /lorebook/entries 与 GET /lorebook/groups 可用', async () => {
    const entries = await request('GET', '/api/novel-writer/lorebook/entries')
    expect(entries.status).toBe(200)
    expect(entries.json.ok).toBe(true)

    const groups = await request('GET', '/api/novel-writer/lorebook/groups')
    expect(groups.status).toBe(200)
    expect(groups.json.ok).toBe(true)
  })

  it('POST /lorebook/entries 建条目；POST /lorebook/entries/<id>/update 更新', async () => {
    const created = await request('POST', '/api/novel-writer/lorebook/entries', {
      name: '境界', content: '炼气→筑基', keywords: '境界',
    })
    expect(created.status).toBe(200)
    expect(created.json.ok).toBe(true)
    const id = created.json.value.id

    // 契约与抽屉客户端一致：动作作为第 4 段路径（/update、/toggle、/delete）
    const updated = await request('POST', `/api/novel-writer/lorebook/entries/${id}/update`, {
      name: '境界（改）',
    })
    expect(updated.status).toBe(200)
    expect(updated.json.ok).toBe(true)

    const toggled = await request('POST', `/api/novel-writer/lorebook/entries/${id}/toggle`, {})
    expect(toggled.status).toBe(200)

    const deleted = await request('POST', `/api/novel-writer/lorebook/entries/${id}/delete`, {})
    expect(deleted.status).toBe(200)
  })

  it('未启用插件时数据端点返回 503', async () => {
    // 用禁用配置重建一个 ctx
    const offCtx = new Context()
    offCtx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
    new ToolRuntime(offCtx)
    new SkillRegistry(offCtx)
    let offHandler: ((req: any, res: any) => Promise<void>) | null = null
    offCtx.provide('webServer', {
      register: (route: { path: string; handler: (req: any, res: any) => Promise<void> }) => {
        if (route.path === '/api/novel-writer') offHandler = route.handler
        return () => {}
      },
    })
    apply(offCtx, { enabled: false, dataDir })
    // 路由注册经 ctx.inject 异步生效，等一个宏任务
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(offHandler, '禁用态同样要注册路由（handler 内返回 503）').toBeTypeOf('function')
    const res = makeRes()
    await offHandler!(makeReq('GET', '/api/novel-writer/projects'), res)
    expect(res.statusCode).toBe(503)
  })

  it('未知子路径返回 404（不抛错）', async () => {
    const r = await request('GET', '/api/novel-writer/nope/nope')
    expect([404, 400]).toContain(r.status)
  })
})
