/**
 * dsh-novel-writer — client 侧一键写章驱动（P2-H，P3 修复）。
 * 按真实 client runtime 契约适配（dsh-client-runtime 实测）：
 *  - workspaces.list.getSnapshot() → { items: WorkspaceView[], recentWorkspaceId? }
 *  - workspaces.connectWorkspace(id) → Promise<SessionId>
 *  - sessions.list.getSnapshot() → { ids, byId, current }
 * 流程：优先当前活跃会话 → 否则连接最近/首个工作区取空白会话 → prompt → 等待正文稳定。
 */

/** client runtime 会话面（真实契约子集）。 */
export interface WriterSessions {
  binding(id: string): { session: WriterSession } | undefined
  list: { getSnapshot(): { ids: string[]; byId: Record<string, { id: string }>; current?: string } }
}

export interface WriterSession {
  prompt(messages: Array<{ type: 'text'; text: string }>, mode: 'queue'): Promise<unknown>
}

/** client runtime 工作区面（真实契约子集：WorkspaceView = { workspaceId, sessionIds, ... }）。 */
export interface WriterWorkspaces {
  list: { getSnapshot(): { items: ReadonlyArray<{ workspaceId: string; sessionIds: string[] }>; recentWorkspaceId?: string; state?: string } }
  connectWorkspace(workspaceId: string): Promise<string>
}

export interface ChapterWriterDeps {
  sessions: WriterSessions
  workspaces: WriterWorkspaces
  /** 会话快照读取（真实实现：订阅 client runtime 会话快照；缺失返回 {} 则正文需手动粘贴）。 */
  snapshotOf(sessionId: string): unknown
}

export interface ChapterWriteResult {
  sessionId: string
  /** 取回的正文（最后一段助手文本；快照不可用时为空，需手动粘贴）。 */
  text: string
}

/** 从快照提取最终助手文本（快照形状：{ messages: [{role, content}] } 或类似）。 */
export function extractAssistantText(snapshot: unknown): string {
  const record = snapshot as { messages?: Array<{ role?: string; content?: string }> } | undefined
  const messages = record?.messages ?? []
  let text = ''
  for (const message of messages) {
    if (message?.role === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
      text = message.content.trim()
    }
  }
  return text
}

/** 等待正文稳定：文本非空且连续两轮（间隔 800ms）不增长。 */
async function waitForStableText(read: () => string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let previous = ''
  let stableRounds = 0
  for (;;) {
    const current = read()
    if (current && current !== previous) {
      stableRounds = 0
      previous = current
    } else if (current && current === previous) {
      stableRounds += 1
      if (stableRounds >= 2) return current
    }
    if (Date.now() > deadline) return previous
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
}

export class ChapterWriter {
  constructor(private readonly deps: ChapterWriterDeps) {}

  /** 驱动一次写章：定位会话 → prompt → 等待正文稳定 → 返回。 */
  async writeChapter(promptText: string, options: { timeoutMs?: number; workspaceId?: string } = {}): Promise<ChapterWriteResult> {
    const timeoutMs = options.timeoutMs ?? 120000
    // 1) 定位会话：优先当前活跃会话，否则连接工作区创建空白会话
    let sessionId: string | undefined
    const sessionsSnapshot = this.deps.sessions.list.getSnapshot()
    if (sessionsSnapshot.current) {
      sessionId = sessionsSnapshot.current
    }
    if (!sessionId) {
      const workspacesSnapshot = this.deps.workspaces.list.getSnapshot()
      const target = options.workspaceId
        ? workspacesSnapshot.items.find((workspace) => workspace.workspaceId === options.workspaceId)
        : workspacesSnapshot.items.find((workspace) => workspace.workspaceId === workspacesSnapshot.recentWorkspaceId)
          ?? workspacesSnapshot.items[0]
      if (!target) throw new Error('没有可用工作区（请先打开一个会话/工作区）')
      sessionId = await this.deps.workspaces.connectWorkspace(target.workspaceId)
    }
    if (!sessionId) throw new Error('无法取得写章会话')

    // 2) prompt（排队模式，不打断当前回合）
    const binding = this.deps.sessions.binding(sessionId)
    if (!binding) throw new Error('写章会话不可用')
    await binding.session.prompt([{ type: 'text', text: promptText }], 'queue')

    // 3) 等待正文稳定并提取（快照不可用则返回空，由调用方引导粘贴）
    const read = (): string => extractAssistantText(this.deps.snapshotOf(sessionId!))
    const text = await waitForStableText(read, timeoutMs)
    return { sessionId, text }
  }
}
