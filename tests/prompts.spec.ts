import { describe, expect, it } from 'vitest'
import {
  loadPromptLibrary,
  parsePromptFrontmatter,
  parsePromptTemplate,
  renderPromptTemplate,
} from '../src/core/prompts/index.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('prompts — frontmatter parsing', () => {
  it('parses fenced frontmatter with variables list', () => {
    const text = `---
id: creation.topic
category: creation
name: 选题生成
description: 生成选题报告
variables: [genre, seed]
---
正文模板 {{genre}} {{seed}}`
    const { data, body } = parsePromptFrontmatter(text)
    expect(data.id).toBe('creation.topic')
    expect(data.name).toBe('选题生成')
    expect(data.variables).toEqual(['genre', 'seed'])
    expect(body).toBe('正文模板 {{genre}} {{seed}}')
  })

  it('handles text without frontmatter', () => {
    const { data, body } = parsePromptFrontmatter('纯正文')
    expect(data).toEqual({})
    expect(body).toBe('纯正文')
  })

  it('builds a PromptTemplate from text', () => {
    const template = parsePromptTemplate('my-id', '---\nname: N\ncategory: c\ndescription: D\nvariables: [a]\n---\n正文 {{a}}')
    expect(template.id).toBe('my-id')
    expect(template.category).toBe('c')
    expect(template.variables).toEqual(['a'])
    expect(template.source).toBe('builtin')
    expect(template.version).toBe(1)
  })
})

describe('prompts — rendering', () => {
  it('replaces placeholders and keeps missing ones', () => {
    const template = parsePromptTemplate('t', '---\nname: T\n---\n《{{title}}》第{{chapterNo}}章 {{保持}}')
    const rendered = renderPromptTemplate(template, { title: '青云问道', chapterNo: '3' })
    expect(rendered).toBe('《青云问道》第3章 {{保持}}')
  })
})

describe('prompts — library loading', () => {
  it('loads all builtin templates from the package assets', async () => {
    const dir = join(process.cwd(), 'assets', 'prompts')
    const library = await loadPromptLibrary(dir)
    const empty = library.filter((t) => !t.template.trim()).map((t) => `${t.id}:${t.description.slice(0, 40)}`)
    expect(empty, `空正文模板: ${empty.join('; ')}`).toEqual([])
    expect(library.length).toBeGreaterThanOrEqual(60)
    const ids = new Set(library.map((t) => t.id))
    expect(ids.size).toBe(library.length)
    // 关键模板存在（id = 文件名，保证唯一）
    for (const expected of ['creation-topic', 'creation-outline', 'writing-chapter-xuanhuan', 'polish-depolish', 'diagnose-golden3', 'style-xuanhuan', 'style-urban', 'guide-assistant-persona', 'lorebook-sediment', 'creation-market']) {
      expect(ids.has(expected), `缺少模板 ${expected}`).toBe(true)
    }
    expect(library.every((t) => t.template.trim().length > 0)).toBe(true)
  })

  it('tolerates a broken template without failing the library', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompts-'))
    roots.push(dir)
    await writeFile(join(dir, 'good.md'), '---\nname: G\n---\nok', 'utf8')
    await writeFile(join(dir, 'bad.md'), '---\nname: B\n---', 'utf8') // 空正文
    const library = await loadPromptLibrary(dir)
    expect(library).toHaveLength(2)
    const bad = library.find((t) => t.id === 'bad')
    expect(bad?.category).toBe('broken')
    expect(bad?.version).toBe(0)
  })
})
