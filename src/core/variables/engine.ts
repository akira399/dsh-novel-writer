/**
 * dsh-novel-writer — 变量引擎纯函数（P1-C）。
 *
 * 移植夏瑾 worldbook_variables.js 核心能力，全部无 IO：
 *  1. YAML-like 解析（InitVar 模板）；
 *  2. JSON Pointer 读写（数组/对象/保护键/`-` 追加）；
 *  3. JSON Patch 应用（replace/insert/remove/delta/move）；
 *  4. <UpdateVariable>/<JSONPatch> 从章节文本提取；
 *  5. 宏渲染全集（SillyTavern/夏瑾兼容语法 + 缺失路径→空串）。
 */
import type { PatchOperation, VariableContext } from './types.ts'

/** 默认变量根键（夏瑾 DEFAULT_VARIABLE_NAME）。 */
export const DEFAULT_VARIABLE_NAME = 'stat_data'

// ─────────────────────────── YAML-like 解析（InitVar 模板） ───────────────────────────

function decodeYamlScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === '{}') return {}
  if (value === '[]') return []
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function countIndent(line: string): number {
  let count = 0
  while (count < line.length && line[count] === ' ') count += 1
  return count
}

/** 缩进式 YAML 子集解析（键: 值 / 嵌套对象 / 数组 / 多行块字符串 |-）。 */
export function parseIndentedYamlLike(text: string): unknown {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim().length > 0)

  function parseBlock(startIndex: number, indent: number): [unknown, number] {
    if (startIndex >= lines.length) return [null, startIndex]
    const currentLine = lines[startIndex]!
    if (countIndent(currentLine) < indent) return [null, startIndex]
    return currentLine.trimStart().startsWith('- ')
      ? parseArray(startIndex, indent)
      : parseObject(startIndex, indent)
  }

  function parseObject(startIndex: number, indent: number): [Record<string, unknown>, number] {
    const result: Record<string, unknown> = {}
    let index = startIndex
    while (index < lines.length) {
      const rawLine = lines[index]!
      const lineIndent = countIndent(rawLine)
      if (lineIndent < indent) break
      if (lineIndent > indent) { index += 1; continue }
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('- ')) break
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) { index += 1; continue }
      const key = trimmed.slice(0, colonIndex).trim()
      const remainder = trimmed.slice(colonIndex + 1).trim()
      if (remainder.length > 0) {
        // 多行块字符串 |-（保持后续缩进行原样）
        if (remainder === '|-' || remainder === '|') {
          const blockLines: string[] = []
          let next = index + 1
          const blockIndent = next < lines.length ? countIndent(lines[next]!) : -1
          while (next < lines.length && blockIndent >= 0 && countIndent(lines[next]!) > indent) {
            blockLines.push(lines[next]!.slice(blockIndent))
            next += 1
          }
          result[key] = blockLines.join('\n')
          index = next
          continue
        }
        result[key] = decodeYamlScalar(remainder)
        index += 1
        continue
      }
      const nextIndex = index + 1
      if (nextIndex >= lines.length) { result[key] = null; index = nextIndex; continue }
      if (countIndent(lines[nextIndex]!) <= lineIndent) { result[key] = null; index = nextIndex; continue }
      const [nestedValue, consumedIndex] = parseBlock(nextIndex, countIndent(lines[nextIndex]!))
      result[key] = nestedValue
      index = consumedIndex
    }
    return [result, index]
  }

  function parseArray(startIndex: number, indent: number): [unknown[], number] {
    const result: unknown[] = []
    let index = startIndex
    while (index < lines.length) {
      const rawLine = lines[index]!
      const lineIndent = countIndent(rawLine)
      if (lineIndent < indent) break
      if (lineIndent !== indent) { index += 1; continue }
      const trimmed = rawLine.trim()
      if (!trimmed.startsWith('- ')) break
      const itemText = trimmed.slice(2).trim()
      if (!itemText) {
        const nextIndex = index + 1
        if (nextIndex < lines.length && countIndent(lines[nextIndex]!) > lineIndent) {
          const [nestedValue, consumedIndex] = parseBlock(nextIndex, countIndent(lines[nextIndex]!))
          result.push(nestedValue)
          index = consumedIndex
        } else {
          result.push(null)
          index = nextIndex
        }
        continue
      }
      const colonIndex = itemText.indexOf(':')
      if (colonIndex !== -1) {
        const key = itemText.slice(0, colonIndex).trim()
        const remainder = itemText.slice(colonIndex + 1).trim()
        const itemObject: Record<string, unknown> = { [key]: remainder.length > 0 ? decodeYamlScalar(remainder) : null }
        let nextIndex = index + 1
        if (nextIndex < lines.length && countIndent(lines[nextIndex]!) > lineIndent) {
          const [nestedValue, consumedIndex] = parseBlock(nextIndex, countIndent(lines[nextIndex]!))
          if (remainder.length === 0) {
            // `- key:` 无值 → 嵌套块整体作为该键的值（对象或数组；修复：数组不再丢失）
            if (nestedValue !== null && typeof nestedValue === 'object') {
              itemObject[key] = nestedValue
            }
          } else if (nestedValue !== null && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
            // `- key: value` + 缩进续行 → YAML 块续行语义：摊平追加字段
            Object.assign(itemObject, nestedValue)
          }
          nextIndex = consumedIndex
        }
        result.push(itemObject)
        index = nextIndex
        continue
      }
      result.push(decodeYamlScalar(itemText))
      index += 1
    }
    return [result, index]
  }

  const [parsed] = parseBlock(0, countIndent(lines[0] ?? ''))
  return parsed
}

/** 从世界书条目中寻找 InitVar 模板并解析（条目名匹配 [InitVar] 或 InitVar）。 */
export function parseInitVarTemplate(entries: ReadonlyArray<{ name: string; content: string }>): Record<string, unknown> | null {
  const init = entries.find((entry) => /\[?\s*InitVar\s*\]?/i.test(entry.name))
  if (!init?.content) return null
  const parsed = parseIndentedYamlLike(init.content)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

// ─────────────────────────── JSON Pointer ───────────────────────────

function pathTokensFromPointer(path: string): string[] {
  if (!path || path === '/') return []
  return path.split('/').slice(1).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function containsProtectedToken(tokens: string[]): boolean {
  return tokens.some((token) => token.startsWith('_'))
}

function resolveVariableRoot(variableMap: Record<string, unknown>, pathTokens: string[]): { root: Record<string, unknown>; tokens: string[] } {
  if (pathTokens.length === 0) return { root: variableMap, tokens: pathTokens }
  if (pathTokens[0] !== undefined && pathTokens[0] in variableMap) return { root: variableMap, tokens: pathTokens }
  const defaultRoot = variableMap[DEFAULT_VARIABLE_NAME]
  if (defaultRoot && typeof defaultRoot === 'object' && !Array.isArray(defaultRoot)) {
    return { root: defaultRoot as Record<string, unknown>, tokens: pathTokens }
  }
  return { root: variableMap, tokens: pathTokens }
}

export function getValueByPointer(root: unknown, path: string): unknown {
  const tokens = pathTokensFromPointer(path)
  let current: unknown = root
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

function setValueByPointer(root: Record<string, unknown>, tokens: string[], value: unknown, createMissing: boolean): boolean {
  if (tokens.length === 0) return false
  let current: unknown = root
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!
    const nextToken = tokens[index + 1]!
    if (Array.isArray(current)) {
      const arrayIndex = Number(token)
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return false
      let nextValue = current[arrayIndex]
      if (nextValue == null && createMissing) {
        nextValue = /^\d+$/.test(nextToken) ? [] : {}
        current[arrayIndex] = nextValue
      }
      if (!nextValue || typeof nextValue !== 'object') return false
      current = nextValue
      continue
    }
    if (!current || typeof current !== 'object') return false
    const record = current as Record<string, unknown>
    let nextValue = record[token]
    if (nextValue == null && createMissing) {
      nextValue = /^\d+$/.test(nextToken) ? [] : {}
      record[token] = nextValue
    }
    if (!nextValue || typeof nextValue !== 'object') return false
    current = nextValue
  }
  const container = current as unknown
  const key = tokens[tokens.length - 1]!
  if (Array.isArray(container)) {
    if (key === '-') {
      container.push(value)
      return true
    }
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) return false
    container[index] = value
    return true
  }
  if (!container || typeof container !== 'object') return false
  ;(container as Record<string, unknown>)[key] = value
  return true
}

function removeValueByPointer(root: Record<string, unknown>, tokens: string[]): boolean {
  if (tokens.length === 0) return false
  let current: unknown = root
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!
    if (Array.isArray(current)) {
      const arrayIndex = Number(token)
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) return false
      current = current[arrayIndex]
      continue
    }
    if (!current || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[token]
  }
  const container = current as unknown
  const key = tokens[tokens.length - 1]!
  if (Array.isArray(container)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= container.length) return false
    container.splice(index, 1)
    return true
  }
  if (!container || typeof container !== 'object') return false
  const record = container as Record<string, unknown>
  if (!(key in record)) return false
  return delete record[key]
}

// ─────────────────────────── JSON Patch 应用 ───────────────────────────

/** 应用一组 patch 操作到变量表（保护 `_` 前缀键；delta 为数值增量扩展）。 */
export function applyPatchOperations(variableMap: Record<string, unknown>, operations: readonly PatchOperation[]): boolean {
  let changed = false
  for (const operation of operations) {
    const op = operation.op
    const path = String(op === 'move' ? operation.to ?? operation.path : operation.path ?? '').trim()
    if (!op || !path) continue
    const rawTokens = pathTokensFromPointer(path)
    if (containsProtectedToken(rawTokens)) continue
    const resolved = resolveVariableRoot(variableMap, rawTokens)
    if (op === 'replace' || op === 'insert') {
      changed = setValueByPointer(resolved.root, resolved.tokens, operation.value, op === 'insert') || changed
      continue
    }
    if (op === 'remove') {
      changed = removeValueByPointer(resolved.root, resolved.tokens) || changed
      continue
    }
    if (op === 'delta') {
      const currentValue = getValueByPointer(resolved.root, `/${resolved.tokens.join('/')}`)
      const deltaValue = Number(operation.value)
      if (typeof currentValue === 'number' && Number.isFinite(deltaValue)) {
        changed = setValueByPointer(resolved.root, resolved.tokens, currentValue + deltaValue, false) || changed
      }
      continue
    }
    if (op === 'move') {
      const fromPath = String(operation.from ?? '').trim()
      if (!fromPath) continue
      const fromTokens = pathTokensFromPointer(fromPath)
      if (containsProtectedToken(fromTokens)) continue
      const fromResolved = resolveVariableRoot(variableMap, fromTokens)
      const movedValue = getValueByPointer(fromResolved.root, `/${fromResolved.tokens.join('/')}`)
      if (typeof movedValue === 'undefined') continue
      const removed = removeValueByPointer(fromResolved.root, fromTokens)
      const inserted = setValueByPointer(resolved.root, resolved.tokens, movedValue, true)
      changed = removed || inserted || changed
    }
  }
  return changed
}

// ─────────────────────────── <UpdateVariable>/<JSONPatch> 提取 ───────────────────────────

/** 从文本提取 JSON Patch 操作数组（兼容多种包裹形式，夏瑾正则移植）。 */
export function extractJsonPatchOperations(text: string): PatchOperation[] {
  const operations: PatchOperation[] = []
  const normalized = text.replace(/\r/g, '')
  const pattern = /<UpdateVariable>[\s\S]*?<JSONPatch>\s*```(?:json)?\s*([\s\S]*?)\s*```?\s*<\/JSONPatch>[\s\S]*?<\/UpdateVariable>|<UpdateVariable>[\s\S]*?<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>[\s\S]*?<\/UpdateVariable>|<JSONPatch>\s*```(?:json)?\s*([\s\S]*?)\s*```?\s*<\/JSONPatch>|<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalized)) !== null) {
    const candidate = [match[1], match[2], match[3], match[4]].find((item) => !!item)
    if (!candidate) continue
    const cleaned = candidate.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    try {
      const parsed = JSON.parse(cleaned) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') operations.push(item as PatchOperation)
        }
      }
    } catch {
      // 非法 patch 静默跳过（模型输出容错）
    }
  }
  return operations
}

// ─────────────────────────── 宏渲染 ───────────────────────────

function formatScalar(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatObjectLines(value: unknown, indent: number): string[] {
  const padding = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padding}[]`]
    const lines: string[] = []
    for (const item of value) {
      if (item && typeof item === 'object') {
        lines.push(`${padding}-`)
        lines.push(...formatObjectLines(item, indent + 2))
      } else {
        lines.push(`${padding}- ${formatScalar(item)}`)
      }
    }
    return lines
  }
  if (value && typeof value === 'object') {
    const lines: string[] = []
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested && typeof nested === 'object') {
        const inner = formatObjectLines(nested, indent + 2)
        lines.push(`${padding}${key}:${inner.length === 0 ? ' {}' : ''}`)
        if (inner.length > 0) lines.push(...inner)
      } else if (typeof nested === 'string' && nested.includes('\n')) {
        lines.push(`${padding}${key}: |-`)
        for (const line of nested.split('\n')) lines.push(`${' '.repeat(indent + 2)}${line}`)
      } else {
        lines.push(`${padding}${key}: ${formatScalar(nested)}`)
      }
    }
    return lines
  }
  return [`${padding}${formatScalar(value)}`]
}

/** format_* 宏：对象转 YAML-like 文本；get_* 宏：JSON 序列化。 */
function formatVariableValue(value: unknown): string {
  if (value == null) return ''
  return formatObjectLines(value, 0).join('\n')
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) continue
    result[key] = sanitize(nested)
  }
  return result
}

function getByDotPath(root: unknown, path: string): unknown {
  const tokens = path.split('.').map((token) => token.trim()).filter((token) => token.length > 0)
  let current: unknown = root
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

function getScoped(context: VariableContext, scope: string, path: string): unknown {
  if (scope === 'global') return getByDotPath(context.globalVariables, path)
  if (scope === 'character' || scope === 'book') return getByDotPath(context.bookVariables, path)
  return getByDotPath(context.localVariables, path)
}

/** 渲染条目内容中的全部变量宏（夏瑾 renderWorldBookContent 全集移植）。 */
export function renderVariables(content: string, context: VariableContext): string {
  let rendered = String(content ?? '')
  rendered = rendered.replace(/\{\{\s*format_(message|chat|character|global|book)_variable::([^}]+)\}\}/gi, (_match, scope, path) => {
    const value = getScoped(context, String(scope).trim().toLowerCase(), String(path).trim())
    return typeof value === 'undefined' ? '' : formatVariableValue(sanitize(value))
  })
  rendered = rendered.replace(/\{\{\s*get_(message|chat|character|global|book)_variable::([^}]+)\}\}/gi, (_match, scope, path) => {
    const value = getScoped(context, String(scope).trim().toLowerCase(), String(path).trim())
    return typeof value === 'undefined' ? '' : JSON.stringify(sanitize(value))
  })
  rendered = rendered.replace(/\{\{\s*getvar::([^}]+)\}\}/gi, (_match, path) => {
    const value = getByDotPath(context.localVariables, String(path).trim())
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  rendered = rendered.replace(/\{\{\s*getglobalvar::([^}]+)\}\}/gi, (_match, path) => {
    const value = getByDotPath(context.globalVariables, String(path).trim())
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  rendered = rendered.replace(/\{\{\s*\.([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]*)\s*\}\}/g, (_match, path) => {
    const value = getByDotPath(context.localVariables, path)
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  rendered = rendered.replace(/\{\{\s*\$([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]*)\s*\}\}/g, (_match, path) => {
    const value = getByDotPath(context.globalVariables, path)
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  rendered = rendered.replace(/<%=\s*getvar\(\s*['"]([^'"]+)['"]\s*\)\s*%>/gi, (_match, path) => {
    const value = getByDotPath(context.localVariables, path)
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  rendered = rendered.replace(/<%=\s*getglobalvar\(\s*['"]([^'"]+)['"]\s*\)\s*%>/gi, (_match, path) => {
    const value = getByDotPath(context.globalVariables, path)
    return typeof value === 'undefined' ? '' : formatScalar(value)
  })
  return rendered
}

/** {{char}} / {{user}} 名称替换宏。 */
export function renderNameMacros(content: string, charName: string, userName: string): string {
  let rendered = String(content ?? '')
  if (charName.trim()) rendered = rendered.replace(/\{\{\s*char\s*\}\}/gi, charName.trim())
  if (userName.trim()) rendered = rendered.replace(/\{\{\s*user\s*\}\}/gi, userName.trim())
  return rendered
}
