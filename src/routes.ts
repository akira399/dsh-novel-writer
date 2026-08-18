/**
 * dsh-novel-writer — host HTTP 路由（P1-I，GUI 数据面）。
 * 单 prefix 路由 /api/novel-writer（WebRoute.path 无尾斜杠），handler 内按路径分派：
 *   GET  /projects                项目列表
 *   POST /projects                创建项目（fence 头校验）
 *   GET  /projects/<id>           项目详情 + 审计尾部
 *   GET  /projects/<id>/chapters/<no>  章节原文
 * 安全：CSRF/dns-rebinding fence（自定义头校验，仿 dsh-plugin-publisher）。
 * 门禁联动：assembly 未启用时返回 503（路由固定注册、handler 检查）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NovelAssembly, NovelServices } from './assembly.ts'
import { readOptional } from './core/atomic-file.ts'
import { asResult } from './core/lorebook/service.ts'
import { buildWritePrompt } from './core/write-prompt.ts'
import { genreLabel } from './core/genres.ts'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = '/api/novel-writer'
const FENCE_HEADER = 'x-dsh-novel-writer'

/** 路由路径解析（纯函数，可单测）。返回 segments 与具名参数。 */
export function parseNovelPath(url: string | undefined): { segments: string[]; projectId?: string; section?: string; noText?: string } {
  const path = new URL(url ?? '/', 'http://localhost').pathname
  const rest = path.slice(PREFIX.length)
  const segments = rest.split('/').filter(Boolean)
  const [, projectId, section, noText] = segments
  return { segments, projectId, section, noText }
}

export function registerNovelRoutes(ctx: Context, assembly: NovelAssembly): void {
  ctx.inject(['webServer'], (wctx) => {
    const writeJson = (res: ServerResponse, status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const readJsonBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk: Buffer | string) => { data += String(chunk) })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) as Record<string, unknown> : {}) } catch { reject(new Error('invalid JSON body')) }
      })
      req.on('error', reject)
    })
    const trusted = (req: IncomingMessage): boolean => req.headers[FENCE_HEADER] === '1'
    const novelOf = (res: ServerResponse): NovelServices | null => {
      const services = assembly.services
      if (!services) writeJson(res, 503, { ok: false, error: { code: 'INVALID_STATE', message: '插件未启用' } })
      return services
    }
    const fail = (res: ServerResponse, status: number, code: string, message: string): void => {
      writeJson(res, status, { ok: false, error: { code, message } })
    }

    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const { segments, projectId, section, noText } = parseNovelPath(req.url)

        // GET /projects
        if (req.method === 'GET' && segments.length === 1 && segments[0] === 'projects') {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.novel.listProjects() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'projects') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const book = await svc.novel.createProject(String(body.title ?? ''), String(body.genre ?? 'fantasy'))
            writeJson(res, 200, { ok: true, value: book })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /demo：一键导入示例项目（《青云问道》+ 10 条世界书条目）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'demo') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const book = await svc.novel.createProject('青云问道', 'fantasy')
            const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'samples', 'demo-book', 'lorebook')
            const entries = JSON.parse(await readOptional(join(dir, 'entries.json')) ?? '{"data":[]}')
            const list = Array.isArray(entries) ? entries : (entries as { data: unknown[] }).data ?? []
            const result = await asResult(() => svc.lore.importEntries({ content: JSON.stringify(list), book_id: book.id }))
            if (!result.ok) throw new Error(result.error.message)
            writeJson(res, 200, { ok: true, value: { book, imported: result.value.imported_count } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /import：导入本地书籍文件（txt/md → 解析 → 建书 → 逐章写入，全自动）
        if (req.method === 'POST' && segments.length === 1 && segments[0] === 'import') {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const fileName = String(body.fileName ?? '').trim()
            const content = String(body.content ?? '')
            if (!content.trim()) return fail(res, 400, 'IMPORT_FILE_EMPTY', '文件内容为空')
            if (content.length > 8_000_000) return fail(res, 400, 'INVALID_FIELD_TYPE', '文件过大（超过 8MB），请拆分后导入')
            const { parseBookFile, BookImporter } = await import('./core/importer/index.js')
            const parsed = parseBookFile(fileName || '未命名书籍', content)
            const importer = new BookImporter({
              createProject: (title, genre) => svc.novel.createProject(title, genre),
              saveChapter: (id, no, title, text) => svc.novel.saveChapter(id, no, title, text),
              deleteProject: (id) => svc.novel.deleteProject(id, false),
            })
            const result = await importer.importParsed(parsed)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            const code = (error as { code?: string }).code
            if (code === 'IMPORT_FILE_EMPTY' || code === 'NO_IMPORTABLE_ENTRIES') {
              return fail(res, 400, code, (error as { message?: string }).message ?? String(error))
            }
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // ── 世界书（lorebook）GUI 数据面 ──
        // GET /lorebook/entries：条目列表
        if (req.method === 'GET' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 2) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.lore.listEntries() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /lorebook/entries：创建条目
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 2) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const entry = await svc.lore.createEntry({
              name: String(body.name ?? '').trim(),
              content: String(body.content ?? ''),
              keywords: typeof body.keywords === 'string' ? body.keywords : '',
              always_active: body.always_active === true,
              enabled: body.enabled !== false,
              priority: typeof body.priority === 'number' ? body.priority : 50,
              inject_target: typeof body.inject_target === 'string' ? body.inject_target as never : 'system',
              inject_position: typeof body.inject_position === 'string' ? body.inject_position as never : 'append',
            })
            writeJson(res, 200, { ok: true, value: entry })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /lorebook/entries/<id>/<action>：update | delete | toggle
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'entries' && segments.length === 4 && segments[3]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          const id = segments[2]!
          const action = segments[3]!
          try {
            if (action === 'toggle') {
              writeJson(res, 200, { ok: true, value: await svc.lore.toggleEntry(id) })
              return
            }
            if (action === 'delete') {
              writeJson(res, 200, { ok: true, value: await svc.lore.deleteEntry(id) })
              return
            }
            if (action === 'update') {
              const body = await readJsonBody(req)
              const updated = await svc.lore.updateEntry(id, {
                ...(body.name !== undefined ? { name: String(body.name) } : {}),
                ...(body.content !== undefined ? { content: String(body.content) } : {}),
                ...(body.keywords !== undefined ? { keywords: String(body.keywords) } : {}),
                ...(body.always_active !== undefined ? { always_active: body.always_active === true } : {}),
                ...(body.enabled !== undefined ? { enabled: body.enabled !== false } : {}),
                ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}),
                ...(body.inject_target !== undefined ? { inject_target: String(body.inject_target) as never } : {}),
                ...(body.inject_position !== undefined ? { inject_position: String(body.inject_position) as never } : {}),
              })
              writeJson(res, 200, { ok: true, value: updated })
              return
            }
            fail(res, 400, 'INVALID_FIELD_TYPE', 'unknown action')
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /lorebook/generate：AI 一键生成该书核心世界书设定（需要模型）
        if (req.method === 'POST' && segments[0] === 'lorebook' && segments[1] === 'generate' && segments.length === 3 && segments[2]) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          const bookId = segments[2]!
          try {
            const { loadPromptLibrary, renderPromptTemplate } = await import('./core/prompts/index.js')
            const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')
            const library = await loadPromptLibrary(promptsDir)
            const template = library.find((t) => t.id === 'lorebook-autogen')
            if (!template) return fail(res, 500, 'IO_FAILURE', '缺少生成提示词模板')
            const book = await svc.novel.load(bookId)
            const prompt = renderPromptTemplate(template, { title: book.title, genre: genreLabel(book.genre) })
            const raw = await svc.llm.complete('你是网文设定师，只输出 JSON 数组。', prompt, 3000)
            // 解析 JSON（容错：剥离 ```json 围栏）
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
            const parsed = JSON.parse(cleaned) as Array<{ name?: string; content?: string; keywords?: string[]; always_active?: boolean }>
            const created = []
            for (const item of Array.isArray(parsed) ? parsed : []) {
              if (!item?.name || !item?.content) continue
              const entry = await svc.lore.createEntry({
                name: item.name.trim(),
                content: item.content.trim(),
                keywords: (item.keywords ?? []).join(','),
                always_active: item.always_active === true,
                book_id: bookId,
              })
              created.push(entry)
            }
            writeJson(res, 200, { ok: true, value: { created: created.length, entries: created } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // GET /lorebook/groups：分组列表
        if (req.method === 'GET' && segments[0] === 'lorebook' && segments[1] === 'groups' && segments.length === 2) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            writeJson(res, 200, { ok: true, value: await svc.lore.listGroups() })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // GET /projects/<id> 或 /projects/<id>/chapters/<no> 或 /projects/<id>/context/<no>
        if (req.method === 'GET' && segments.length >= 2 && segments[0] === 'projects' && projectId) {
          const svc = novelOf(res)
          if (!svc) return
          try {
            if (section === 'chapters' && noText) {
              // 返回剥离 frontmatter 的纯正文（不向用户显示章节元数据注释）
              const content = await svc.novel.chapterText(projectId, Number(noText))
              writeJson(res, 200, { ok: true, value: content })
              return
            }
            // 写章上下文包（一键写章数据源）
            if (section === 'context' && noText) {
              const packet = await svc.novel.assemble(projectId, Number(noText))
              writeJson(res, 200, { ok: true, value: packet })
              return
            }
            // 规则层诊断（黄金三章/单章，从 noText 起最多 3 章）
            if (section === 'diagnose' && noText) {
              const { diagnoseFirstChapters } = await import('./core/diagnose/index.js')
              const book = await svc.novel.load(projectId)
              const start = Number(noText)
              const chapters = []
              for (let no = start; no <= Math.min(start + 2, book.stats.chapterCount + 1); no += 1) {
                const chapter = await svc.novel.chapterWithText(projectId, no)
                if (chapter) chapters.push({ no, title: chapter.chapter.title, text: chapter.content })
              }
              const report = diagnoseFirstChapters(chapters, { wordTargets: book.config.wordTargets })
              writeJson(res, 200, { ok: true, value: report })
              return
            }
            if (section === undefined) {
              const book = await svc.novel.load(projectId)
              const audit = await svc.novel.audit(projectId)
              writeJson(res, 200, { ok: true, value: { book, auditTail: audit.slice(-20) } })
              return
            }
            fail(res, 404, 'ENTRY_NOT_FOUND', 'unknown resource')
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>：保存章节（一键写章回写）
        if (req.method === 'POST' && segments.length === 4 && segments[0] === 'projects' && segments[2] === 'chapters' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const chapter = await svc.novel.saveChapter(
              projectId,
              Number(noText),
              String(body.title ?? `第 ${noText} 章`),
              String(body.text ?? ''),
              typeof body.brief === 'string' ? body.brief : undefined,
            )
            writeJson(res, 200, { ok: true, value: chapter })
          } catch (error) {
            fail(res, 400, 'INVALID_FIELD_TYPE', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>/write：一键写章（host LLM 直写 + 自动保存）
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[4] === 'write' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          try {
            const book = await svc.novel.load(projectId)
            const packet = await svc.novel.assemble(projectId, Number(noText))
            const text = await svc.llm.complete('你是网文作者，直接输出正文。', buildWritePrompt(book, packet), 6000)
            if (!text) return fail(res, 500, 'IO_FAILURE', '模型未返回正文')
            const chapter = await svc.novel.saveChapter(projectId, Number(noText), `第 ${noText} 章`, text)
            writeJson(res, 200, { ok: true, value: { chapter, text } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects/<id>/chapters/<no>/polish：AI 文笔润色（返回原文+润色文，不落盘，确认后走保存路由）
        if (req.method === 'POST' && segments.length === 5 && segments[0] === 'projects' && segments[2] === 'chapters' && segments[4] === 'polish' && noText && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          if (!svc.llm || !svc.llm.available()) return fail(res, 503, 'INVALID_STATE', '模型未就绪（请先在会话中发起一次对话）')
          try {
            const body = await readJsonBody(req)
            let text = typeof body.text === 'string' ? body.text.trim() : ''
            if (!text) {
              // 编辑区为空 → 回退到已保存章节正文
              text = (await svc.novel.chapterText(projectId, Number(noText)).catch(() => '')).trim()
            }
            if (!text) return fail(res, 400, 'INVALID_FIELD_TYPE', '没有可润色的正文内容')
            const { loadPromptLibrary, renderPromptTemplate } = await import('./core/prompts/index.js')
            const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')
            const library = await loadPromptLibrary(promptsDir)
            const template = library.find((t) => t.id === 'polish-literary')
            if (!template) return fail(res, 500, 'IO_FAILURE', '缺少润色提示词模板')
            const prompt = renderPromptTemplate(template, { text })
            // 润色需输出与原文等长的全篇正文：输出预算按原文长度动态放大，
            // 防止长章节被 maxTokens 截断（截断会导致"只改了开头几段"）。
            const maxTokens = Math.min(12000, Math.max(6000, Math.ceil(text.length * 1.6) + 2500))
            let polished = await svc.llm.complete('你是资深网文编辑，只输出润色后的完整正文，不要任何解释或前缀。', prompt, maxTokens)

            // 模型原样返回（无任何实质改动）→ 自动用更强的"强制重写"指令重试一次，
            // 保证用户至少得到有实质内容的润色建议。
            if (polished) {
              const { splitPolishSuggestions } = await import('./core/polish/diff.js')
              if (splitPolishSuggestions(text, polished).length === 0) {
                const retryPrompt = '你上一版把原文原样返回了，这不可接受！请按以下要求重新润色：' +
                  '\n- 对全章几乎每一段都必须做明显的文笔重写（换词、改句、调序、扩写、压缩都行）' +
                  '\n- 底线只是不改情节/设定/人物行为逻辑，表达层面要大改特改' +
                  '\n- 输出与原文的差异必须遍布全章，禁止与原文相同或近似相同\n\n' + prompt
                polished = await svc.llm.complete('你是资深网文编辑。上一次你原样返回了原文，这次必须充分重写并输出润色后的完整正文。', retryPrompt, maxTokens)
              }
            }
            if (!polished) return fail(res, 500, 'IO_FAILURE', '模型未返回润色结果')
            writeJson(res, 200, { ok: true, value: { original: text, polished } })
          } catch (error) {
            fail(res, 500, 'IO_FAILURE', String(error))
          }
          return
        }
        // POST /projects/<id>/delete：删除书籍（keepChapters 决定是否保留正文）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'delete' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const result = await svc.novel.deleteProject(projectId, body.keepChapters === true)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        // POST /projects/<id>/export：导出成稿（返回文件名+内容，GUI 下载）
        if (req.method === 'POST' && segments.length === 3 && segments[0] === 'projects' && segments[2] === 'export' && projectId) {
          if (!trusted(req)) return fail(res, 403, 'INVALID_STATE', 'forbidden')
          const svc = novelOf(res)
          if (!svc) return
          try {
            const body = await readJsonBody(req)
            const format = body.format === 'markdown' || body.format === 'platform' ? body.format : 'txt'
            const result = await svc.novel.exportProject(projectId, format)
            writeJson(res, 200, { ok: true, value: result })
          } catch (error) {
            fail(res, 404, 'ENTRY_NOT_FOUND', String(error))
          }
          return
        }
        fail(res, 404, 'ENTRY_NOT_FOUND', 'unknown resource')
      },
    }), 'dsh-novel-writer: routes')
  })
}
