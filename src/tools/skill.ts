/**
 * dsh-novel-writer — 技能注册 + 提示词库工具（P1-G）。
 * 技能 novel-writing-workflow（assets/skills/）随包分发，host 启动时注册；
 * novel_prompts 工具提供提示词库浏览与渲染。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPromptLibrary, renderPromptTemplate } from '../core/prompts/index.ts'
import { jsonOutput } from './json.ts'

export const SKILL_NAME = 'novel-writing-workflow'
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills', SKILL_NAME)

/** 从 SKILL.md 解析 frontmatter（name/description/whenToUse）。 */
function parseSkillFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const firstLineEnd = text.indexOf('\n')
  const isFenced = firstLineEnd >= 0 && text.slice(0, firstLineEnd).replace(/\r$/, '') === '---'
  if (!isFenced) return { data: {}, body: text.trim() }
  const end = text.indexOf('\n---', firstLineEnd + 1)
  const body = end === -1 ? '' : text.slice(end + 4).trim()
  const header = text.slice(firstLineEnd + 1, end === -1 ? text.length : end)
  const data: Record<string, string> = {}
  for (const rawLine of header.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(rawLine.trim())
    if (!match) continue
    const value = match[2]!.trim()
    data[match[1]!] = (value.startsWith('"') && value.endsWith('"')) ? value.slice(1, -1) : value
  }
  return { data, body }
}

/** 注册创作流程技能（enabled 门禁内调用）。返回 disposer。 */
export function registerWorkflowSkill(ctx: Context): (() => void) | null {
  try {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    const { data, body } = parseSkillFrontmatter(raw)
    const disposer = ctx.skills.register({
      name: data.name?.trim() || SKILL_NAME,
      description: data.description?.trim() || '网络小说创作全流程（九阶段门禁式创作）。',
      ...(data.whenToUse?.trim() ? { whenToUse: data.whenToUse.trim() } : {}),
      content: body,
      source: 'dsh-novel-writer',
      metadata: { version: '0.1.0', defaultEnabled: true },
      resourceBase: { kind: 'directory', path: SKILL_DIR },
    })
    return disposer
  } catch (error) {
    ctx.logger?.warn?.('[' + SKILL_NAME + '] 技能注册失败: ' + String(error))
    return null
  }
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** 注册 novel_prompts 工具（提示词库浏览/渲染）。 */
export function registerPromptsTool(ctx: Context): () => void {
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')
  return ctx.tools.register(defineTool({
    name: 'novel_prompts',
    description: '浏览/渲染内置提示词库（创作模板/文风预设/去AI味/润色/诊断）。' +
      'action=list 列出全部；action=get 取模板原文；action=render 用变量渲染模板（如写作指令）。',
    parameters: {
      action: { type: 'string', required: true, description: 'list | get | render' },
      id: { type: 'string', description: '模板 id（get/render 必填）' },
      vars: { type: 'string', description: 'render 用：JSON 对象字符串，如 {"title":"青云问道"}' },
    },
    output: jsonOutput(),
    execute: async (rawArgs) => {
      const args = rawArgs as { action: 'list' | 'get' | 'render'; id?: string; vars?: string }
      try {
        const library = await loadPromptLibrary(promptsDir)
        if (args.action === 'list') {
          return asJson({ ok: true, value: library.map((t) => ({ id: t.id, category: t.category, name: t.name, description: t.description, variables: t.variables })) })
        }
        const template = library.find((t) => t.id === args.id)
        if (!template) return asJson({ ok: false, error: { code: 'ENTRY_NOT_FOUND', message: `模板不存在: ${args.id}` } })
        if (args.action === 'get') return asJson({ ok: true, value: template })
        let vars: Record<string, string> = {}
        if (args.vars) {
          try {
            vars = JSON.parse(args.vars) as Record<string, string>
          } catch {
            return asJson({ ok: false, error: { code: 'INVALID_JSON', message: 'vars 必须是 JSON 对象字符串' } })
          }
        }
        return asJson({ ok: true, value: { id: template.id, rendered: renderPromptTemplate(template, vars) } })
      } catch (error) {
        return asJson({ ok: false, error: { code: 'IO_FAILURE', message: error instanceof Error ? error.message : String(error) } })
      }
    },
    isConcurrencySafe: () => true,
  }))
}
