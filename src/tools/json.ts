/**
 * dsh-novel-writer — 工具输出辅助（模块 6）。
 * 统一 JSON 输出契约：作者面 ValueSchemaSpec DSL（`{ type: 'json' }` = 自由 JSON 节点）。
 * 注意：返回类型必须让 TS 推断为字面量（defineTool 依赖泛型推断 value 类型），
 * 不能标注宽类型（如 ToolOutputDefinition），否则推断退化为 never。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'

export function renderJson(_args: unknown, value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** 自由 JSON 输出（结构由实现决定时用）。 */
export function jsonOutput() {
  return { schema: { type: 'json' as const }, render: renderJson }
}
