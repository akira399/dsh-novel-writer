import { describe, expect, it } from 'vitest'
import { ChapterWriter, extractAssistantText } from '../src/core/client-writer.ts'
import type { ChapterWriterDeps } from '../src/core/client-writer.ts'

/** 构造可测 deps：mock sessions/workspaces（真实契约形状）+ 可变快照。 */
function mockDeps(): { deps: ChapterWriterDeps; snapshot: { value: unknown }; prompts: string[]; connected: string[] } {
  const snapshot = { value: { messages: [] } }
  const prompts: string[] = []
  const connected: string[] = []
  const sessions = {
    binding: (id: string) => (id === 's1' ? {
      session: {
        prompt: async (messages: Array<{ type: 'text'; text: string }>): Promise<unknown> => {
          prompts.push(messages[0]?.text ?? '')
          return undefined
        },
      },
    } : undefined),
    list: { getSnapshot: () => ({ ids: ['s1'], byId: { s1: { id: 's1' } }, current: 's1' }) },
  }
  const workspaces = {
    list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }], recentWorkspaceId: 'w1' }) },
    connectWorkspace: async (id: string): Promise<string> => {
      connected.push(id)
      return 's-new'
    },
  }
  return {
    deps: { sessions, workspaces, snapshotOf: () => snapshot.value },
    snapshot,
    prompts,
    connected,
  }
}

describe('ChapterWriter — session driving', () => {
  it('prompts the current session and returns stable assistant text', async () => {
    const { deps, snapshot, prompts } = mockDeps()
    const writer = new ChapterWriter(deps)
    const run = writer.writeChapter('写第一章', { timeoutMs: 5000 })
    setTimeout(() => { snapshot.value = { messages: [{ role: 'user', content: '写第一章' }, { role: 'assistant', content: '第一章正文……' }] } }, 100)
    const result = await run
    expect(prompts[0]).toBe('写第一章')
    expect(result.sessionId).toBe('s1') // 优先当前活跃会话
    expect(result.text).toContain('第一章正文')
  })

  it('connects a workspace when there is no current session', async () => {
    const { deps, connected } = mockDeps()
    const writer = new ChapterWriter({
      ...deps,
      sessions: { ...deps.sessions, list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    })
    // 无当前会话 → connectWorkspace('w1') → 返回 's-new'；s-new 无 binding → 报"写章会话不可用"
    await expect(writer.writeChapter('x')).rejects.toThrow('写章会话不可用')
    expect(connected).toEqual(['w1'])
  })

  it('throws a friendly error when no workspace is available', async () => {
    const { deps } = mockDeps()
    const writer = new ChapterWriter({
      ...deps,
      sessions: { ...deps.sessions, list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
      workspaces: { list: { getSnapshot: () => ({ items: [], state: 'error' }) }, connectWorkspace: async () => { throw new Error('no ws') } },
    })
    await expect(writer.writeChapter('x')).rejects.toThrow('没有可用工作区')
  })

  it('throws when the session binding is missing', async () => {
    const { deps } = mockDeps()
    const writer = new ChapterWriter({
      ...deps,
      sessions: { binding: () => undefined, list: { getSnapshot: () => ({ ids: ['s1'], byId: { s1: { id: 's1' } }, current: 's1' }) } },
    })
    await expect(writer.writeChapter('x')).rejects.toThrow('写章会话不可用')
  })
})

describe('ChapterWriter — text extraction', () => {
  it('extracts the last assistant message', () => {
    const snapshot = {
      messages: [
        { role: 'user', content: '写' },
        { role: 'assistant', content: '第一版' },
        { role: 'assistant', content: '第二版正文' },
      ],
    }
    expect(extractAssistantText(snapshot)).toBe('第二版正文')
  })

  it('returns empty for no assistant text', () => {
    expect(extractAssistantText({ messages: [{ role: 'user', content: 'x' }] })).toBe('')
    expect(extractAssistantText({})).toBe('')
  })
})
