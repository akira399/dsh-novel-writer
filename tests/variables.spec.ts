import { describe, expect, it } from 'vitest'
import {
  applyPatchOperations,
  DEFAULT_VARIABLE_NAME,
  extractJsonPatchOperations,
  getValueByPointer,
  parseIndentedYamlLike,
  parseInitVarTemplate,
  renderNameMacros,
  renderVariables,
} from '../src/core/variables/index.ts'
import type { VariableContext } from '../src/core/variables/index.ts'

describe('variables — YAML-like parsing', () => {
  it('parses nested objects, arrays and typed scalars', () => {
    const text = `境界: 筑基三层
属性:
  力量: 12
  敏捷: 8.5
  天赋: true
技能:
  - 御剑
  - 炼丹
备注: null`
    const parsed = parseIndentedYamlLike(text) as Record<string, unknown>
    expect(parsed.境界).toBe('筑基三层')
    expect(parsed.属性).toEqual({ 力量: 12, 敏捷: 8.5, 天赋: true })
    expect(parsed.技能).toEqual(['御剑', '炼丹'])
    expect(parsed.备注).toBeNull()
  })

  it('parses array-of-objects and multiline blocks', () => {
    const text = `敌人:
  - name: 赵无极
    境界: 筑基初期
  - name: 血煞老祖
誓言: |-
  第一行
  第二行`
    const parsed = parseIndentedYamlLike(text) as Record<string, unknown>
    expect(parsed.敌人).toEqual([
      { name: '赵无极', 境界: '筑基初期' },
      { name: '血煞老祖' },
    ])
    expect(parsed.誓言).toBe('第一行\n第二行')
  })

  it('finds InitVar templates by entry name', () => {
    const entries = [
      { name: '普通条目', content: 'x' },
      { name: '[InitVar] 初始变量', content: '修为: 炼气一层' },
    ]
    const template = parseInitVarTemplate(entries)
    expect(template).toEqual({ 修为: '炼气一层' })
  })
})

describe('variables — JSON Pointer and Patch', () => {
  it('reads values by pointer through arrays and objects', () => {
    const data = { stat_data: { 队友: ['林远', '苏雪'], 背包: { 灵石: 100 } } }
    expect(getValueByPointer(data, '/stat_data/队友/0')).toBe('林远')
    expect(getValueByPointer(data, '/stat_data/背包/灵石')).toBe(100)
    expect(getValueByPointer(data, '/stat_data/不存在')).toBeUndefined()
  })

  it('applies replace/insert/remove/delta/move', () => {
    const vars: Record<string, unknown> = { stat_data: { 灵石: 10, 队友: ['林远'] } }
    const changed = applyPatchOperations(vars, [
      { op: 'replace', path: '/stat_data/灵石', value: 20 },
      { op: 'delta', path: '/stat_data/灵石', value: 5 },
      { op: 'insert', path: '/stat_data/队友/-', value: '苏雪' },
      { op: 'move', from: '/stat_data/队友/1', path: '/stat_data/队友/0' },
      { op: 'remove', path: '/stat_data/队友/1' },
    ])
    expect(changed).toBe(true)
    const root = vars.stat_data as Record<string, unknown>
    expect(root.灵石).toBe(25)
    expect(root.队友).toEqual(['苏雪'])
  })

  it('protects underscore-prefixed keys and creates missing parents on insert', () => {
    const vars: Record<string, unknown> = { stat_data: {} }
    applyPatchOperations(vars, [
      { op: 'insert', path: '/stat_data/新域/子域', value: 1 },
      { op: 'insert', path: '/stat_data/_secret', value: 'no' },
    ])
    const root = vars.stat_data as Record<string, unknown>
    expect((root.新域 as Record<string, unknown>).子域).toBe(1)
    expect('_secret' in root).toBe(false)
  })

  it('does not mutate when nothing applies', () => {
    const vars: Record<string, unknown> = { stat_data: { a: 1 } }
    const changed = applyPatchOperations(vars, [{ op: 'remove', path: '/stat_data/nope' }])
    expect(changed).toBe(false)
  })
})

describe('variables — <UpdateVariable>/<JSONPatch> extraction', () => {
  it('extracts fenced and raw JSON patches in all wrapper forms', () => {
    const text = [
      '<UpdateVariable><JSONPatch>```json\n[{"op":"replace","path":"/stat_data/修为","value":"筑基"}]\n```</JSONPatch></UpdateVariable>',
      '<JSONPatch>[{"op":"delta","path":"/stat_data/灵石","value":10}]</JSONPatch>',
      '普通正文没有 patch',
    ].join('\n')
    const ops = extractJsonPatchOperations(text)
    expect(ops).toHaveLength(2)
    expect(ops[0]?.path).toBe('/stat_data/修为')
    expect(ops[1]?.op).toBe('delta')
  })

  it('tolerates malformed patches', () => {
    const ops = extractJsonPatchOperations('<JSONPatch>not json</JSONPatch>')
    expect(ops).toEqual([])
  })
})

describe('variables — macro rendering', () => {
  const context: VariableContext = {
    localVariables: { stat_data: { 修为: '筑基三层', 队友: ['林远'] } },
    bookVariables: { 好感度: 80 },
    globalVariables: { world: { version: 2 } },
  }

  it('renders get_*/format_* scoped macros', () => {
    // get_* 为 JSON 序列化语义（对齐夏瑾/ST）：字符串带引号
    expect(renderVariables('修为：{{get_message_variable::stat_data.修为}}', context)).toBe('修为："筑基三层"')
    expect(renderVariables('{{get_character_variable::好感度}}', context)).toBe('80')
    expect(renderVariables('{{get_global_variable::world.version}}', context)).toBe('2')
    expect(renderVariables('{{get_chat_variable::stat_data.修为}}', context)).toBe('"筑基三层"')
    expect(renderVariables('{{get_book_variable::好感度}}', context)).toBe('80')
  })

  it('format_* renders objects as YAML-like text', () => {
    const rendered = renderVariables('队友：\n{{format_message_variable::stat_data.队友}}', context)
    expect(rendered).toContain('- 林远')
  })

  it('renders shorthand macros and empty for missing paths', () => {
    expect(renderVariables('{{getvar::stat_data.修为}}', context)).toBe('筑基三层')
    expect(renderVariables('{{getglobalvar::world.version}}', context)).toBe('2')
    // {{.x}} 查局部变量顶层键（中文键已支持）
    expect(renderVariables('{{.stat_data}}', context)).toContain('筑基三层')
    expect(renderVariables('{{$world}}', context)).toContain('version')
    expect(renderVariables('{{$missing}}', context)).toBe('')
    expect(renderVariables('<%= getvar(\'stat_data.修为\') %>', context)).toBe('筑基三层')
    expect(renderVariables('<%= getglobalvar(\'world.version\') %>', context)).toBe('2')
    expect(renderVariables('{{getvar::缺失路径}}', context)).toBe('')
  })

  it('renders char/user name macros', () => {
    expect(renderNameMacros('{{char}}与{{user}}', '林远', '我')).toBe('林远与我')
    expect(renderNameMacros('{{char}}', '', '我')).toBe('{{char}}')
  })

  it('keeps unknown macros untouched', () => {
    expect(renderVariables('{{unknown_macro::x}}', context)).toBe('{{unknown_macro::x}}')
  })
})

/** 类型冒烟：默认变量根键存在。 */
void DEFAULT_VARIABLE_NAME
