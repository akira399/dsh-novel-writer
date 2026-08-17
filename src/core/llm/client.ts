/**
 * dsh-novel-writer — LLM 客户端封装（P2-G）。
 * 辅助模型调用（改写/诊断/摘要）：路由捕获（监听主模型 llm/stream）+ complete。
 * 无路由时抛错，由工具层降级（返回"需要模型"提示）。
 */
import type LlmService from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export interface LlmRoute {
  provider: string
  model: string
}

export interface LlmClient {
  /** 一次辅助补全（返回纯文本）。 */
  complete(system: string, user: string, maxTokens?: number): Promise<string>
  /** 是否可用（已捕获路由）。 */
  available(): boolean
}

/** 路由捕获器：监听 llm/stream waterfall 记住最后一次主模型路由。 */
export function captureRoute(ctx: Context): { get(): LlmRoute | null } {
  let route: LlmRoute | null = null
  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    route = { provider: options.provider, model: options.model }
    return next()
  })
  return { get: () => route }
}

export function createLlmClient(llm: LlmService, route: { get(): LlmRoute | null }): LlmClient {
  return {
    available(): boolean {
      return route.get() !== null
    },
    async complete(system, user, maxTokens = 2000): Promise<string> {
      const current = route.get()
      if (!current) throw new Error('无可用 LLM 路由（未捕获到主模型调用）')
      let text = ''
      const stream = llm.stream({
        provider: current.provider,
        model: current.model,
        system,
        messages: [createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: user }],
        })],
        temperature: 0.6,
        reasoningEffort: ReasoningEffortId('off'),
        maxTokens,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text
      }
      return text.trim()
    },
  }
}
