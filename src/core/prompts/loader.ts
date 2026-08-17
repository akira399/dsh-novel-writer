/**
 * dsh-novel-writer — 内置提示词库加载器（P1-G）。
 *
 * assets/prompts/*.md：YAML frontmatter（id/category/name/description/variables）
 * + 模板正文（{{var}} 占位符）。读取/解析/渲染全部为纯函数（文件读取注入）。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromptTemplate } from '../types.ts'

/** 解析 YAML frontmatter（极小子集：仅支持键: 值 行）。 */
export function parsePromptFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const firstLineEnd = text.indexOf('\n')
  const isFenced = firstLineEnd >= 0 && text.slice(0, firstLineEnd).replace(/\r$/, '') === '---'
  if (!isFenced) return { data: {}, body: text.trim() }
  const end = text.indexOf('\n---', firstLineEnd + 1)
  const body = end === -1 ? '' : text.slice(end + 4).trim()
  const header = text.slice(firstLineEnd + 1, end === -1 ? text.length : end)
  const data: Record<string, string | string[]> = {}
  for (const rawLine of header.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(rawLine.trim())
    if (!match) continue
    const key = match[1]!
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key === 'variables') {
      // 支持 [a, b] 与 a, b 两种写法
      const trimmed = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
      data[key] = trimmed.split(',').map((v) => v.trim()).filter(Boolean)
    } else {
      data[key] = value
    }
  }
  return { data, body }
}

/** 解析单个模板文件文本 → PromptTemplate（非法 id 抛错）。 */
export function parsePromptTemplate(id: string, text: string): PromptTemplate {
  const { data, body } = parsePromptFrontmatter(text)
  if (!body.trim()) throw new Error(`prompt template 正文为空: ${id}`)
  const name = typeof data.name === 'string' ? data.name.trim() : id
  const category = typeof data.category === 'string' ? data.category.trim() : 'general'
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  const variables = Array.isArray(data.variables) ? data.variables : []
  return {
    id,
    category,
    name,
    description,
    template: body,
    variables,
    source: 'builtin',
    version: 1,
  }
}

/** 目录 → 模板列表（*.md 文件，文件名即 id）。 */
export async function loadPromptLibrary(dir: string): Promise<PromptTemplate[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const templates: PromptTemplate[] = []
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    const id = name.slice(0, -3)
    try {
      const text = await readFile(join(dir, name), 'utf8')
      templates.push(parsePromptTemplate(id, text))
    } catch (error) {
      // 单个模板损坏不阻断整库加载
      templates.push({
        id,
        category: 'broken',
        name: id,
        description: `模板解析失败: ${error instanceof Error ? error.message : String(error)}`,
        template: '',
        variables: [],
        source: 'builtin',
        version: 0,
      })
    }
  }
  return templates
}

/** 渲染模板：{{var}} 占位符替换（缺失变量保留原样；值中的 $&/$1 等不做特殊解释）。 */
export function renderPromptTemplate(template: PromptTemplate, vars: Record<string, string>): string {
  let rendered = template.template
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g'), () => value)
  }
  return rendered
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
