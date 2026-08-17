/**
 * dsh-novel-writer — 向导与助手工具（P1-I）。
 * novel_wizard：五步创作向导（状态持久化到项目目录 wizard.json）；
 * novel_guide：工坊助手意图解析入口（返回结构化动作，由用户/模型执行）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { asResult } from '../core/lorebook/service.ts'
import { createWizard, parseIntent, wizardCommit, wizardNext, wizardSkip, type WizardState } from '../core/guide/index.ts'
import type { NovelService } from '../core/novel/service.ts'
import { atomicWriteFile, readOptional } from '../core/atomic-file.ts'
import { jsonOutput } from './json.ts'

export interface GuideToolDeps {
  novel: NovelService
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerGuideTools(ctx: Context, deps: GuideToolDeps): Array<() => void> {
  const { novel } = deps
  return [
    ctx.tools.register(defineTool({
      name: 'novel_wizard',
      description: '创作向导：五步引导（genre→title→setting→outline→start）。' +
        'action=status 查看进度；action=commit 提交当前步骤产物；action=next 推进；action=skip 跳过。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        action: { type: 'string', required: true, description: 'status | commit | next | skip' },
        step: { type: 'string', description: 'commit/skip 的目标步骤' },
        artifact: { type: 'string', description: 'commit 的步骤产物（书名/设定/大纲文本）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; action: 'status' | 'commit' | 'next' | 'skip'; step?: string; artifact?: string }
        return asJson(await asResult(async () => {
          const projectDir = novel.projectDir(args.projectId)
          const now = new Date().toISOString()
          const read = async (): Promise<WizardState> => {
            const text = await readOptional(join(projectDir, 'wizard.json'))
            return text ? JSON.parse(text) as WizardState : createWizard(now)
          }
          const write = async (state: WizardState): Promise<WizardState> => {
            await atomicWriteFile(join(projectDir, 'wizard.json'), `${JSON.stringify(state, null, 2)}\n`)
            return state
          }
          const current = await read()
          if (args.action === 'status') return { wizard: current }
          if (args.action === 'skip') {
            const result = wizardSkip(current, args.step as never, now)
            if (!result.ok) throw result.error
            return { wizard: await write(result.value) }
          }
          if (args.action === 'commit') {
            const result = wizardCommit(current, args.step as never, args.artifact ?? '', now)
            if (!result.ok) throw result.error
            return { wizard: await write(result.value) }
          }
          const result = wizardNext(current, now)
          if (!result.ok) throw result.error
          return { wizard: await write(result.value.state), nextStep: result.value.step }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_guide',
      description: '工坊助手意图解析：把用户自然语言指令映射为结构化动作（工具名+参数+置信度）。' +
        '命中后由用户确认（写操作）或直接执行；未命中返回 null（自由对话）。',
      parameters: {
        text: { type: 'string', required: true, description: '用户指令原文' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const text = (rawArgs as { text: string }).text
        return asJson({ ok: true, value: parseIntent(text) })
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
