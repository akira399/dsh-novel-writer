/**
 * dsh-novel-writer — 创作流程 agent 工具注册（P1-F3）。
 *
 * 工具集：novel_projects / novel_phase / novel_commit / novel_override /
 * novel_write_chapter / novel_commit_chapter / novel_audit / novel_stats。
 * 写章采用两段式（工具返回上下文包 → 模型在对话流输出正文 →
 * novel_commit_chapter 落盘校验），不依赖独立会话驱动
 * （client 侧「一键写章」会话驱动在 P1-I 与 GUI 一起落地）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { asResult } from '../core/lorebook/service.ts'
import type { NovelService } from '../core/novel/service.ts'
import type { PhaseId } from '../core/workflow/index.ts'
import { jsonOutput } from './json.ts'

export interface NovelToolDeps {
  novel: NovelService
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerNovelDomainTools(ctx: Context, deps: NovelToolDeps): Array<() => void> {
  const { novel } = deps
  return [
    ctx.tools.register(defineTool({
      name: 'novel_create_project',
      description: '创建小说项目（进入 topic 选题阶段）。触发：创建项目/新书/开新书/新建小说。',
      parameters: {
        title: { type: 'string', required: true, description: '书名' },
        genre: { type: 'string', description: '题材 id（默认 fantasy；可选：fantasy/xianxia/wuxia/western/urban/realistic/campus/business/strategy/history/military/scifi/mystery/horror/apocalypse/romance/ancient-romance/game/sports/light-novel/anime/fanfiction/honghuang/farming/system/infinite/multiverse）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { title: string; genre?: string }
        return asJson(await asResult(() => novel.createProject(String(args.title ?? '').trim(), String(args.genre ?? 'fantasy').trim() || 'fantasy')))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_clone_project',
      description: '以一本已有项目为模板克隆新项目（模板复制）：复制字数目标/风格/禁用词 + 已完成的阶段设定文档（选题/设定/人设/大纲/分卷/细纲），正文不复制，状态机重置。触发：克隆/复制/套用模板/参照这本书写一本新的。',
      parameters: {
        sourceId: { type: 'string', required: true, description: '源项目 ID（作为模板的书）' },
        title: { type: 'string', description: '新书名（缺省为「源书名（模板）」）' },
        genre: { type: 'string', description: '新题材 id（缺省沿用源题材）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { sourceId: string; title?: string; genre?: string }
        return asJson(await asResult(() => novel.cloneProject(args.sourceId, { title: args.title, genre: args.genre })))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_projects',
      description: '列出全部小说项目（含当前阶段/章节数/总字数）。触发：项目/小说/我的书。',
      parameters: {},
      output: jsonOutput(),
      execute: async () => asJson(await asResult(() => novel.listProjects())),
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_phase',
      description: '查看项目当前阶段与门禁状态；带 phase 参数时进入该阶段（前置阶段需 approved/skipped）。' +
        '阶段：topic选题/setting设定/character人设/outline大纲/volume分卷/chapter细纲/writing正文/revision修订/done完本。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', description: '要进入的阶段（省略=仅查看）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase?: string }
        return asJson(await asResult(async () => {
          if (args.phase) {
            const book = await novel.enterPhase(args.projectId, args.phase as PhaseId)
            return { book, entered: args.phase }
          }
          const book = await novel.load(args.projectId)
          return { book }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_commit',
      description: '提交阶段产物（唯一推进入口）：写入 docs/<phase>.md + 版本快照，按校验报告推进状态机。' +
        'passed=true 且 errorCount=0 → approved 解锁下一阶段；errorCount>0 → review 挂起。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', required: true, description: '阶段 id' },
        artifact: { type: 'string', required: true, description: '产物全文（markdown）' },
        errorCount: { type: 'number', description: 'error 级校验问题数（默认 0）' },
        warningCount: { type: 'number', description: 'warning 级问题数（默认 0）' },
        passed: { type: 'boolean', description: '是否通过校验（默认按 errorCount=0 判定）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase: string; artifact: string; errorCount?: number; warningCount?: number; passed?: boolean }
        const errorCount = args.errorCount ?? 0
        return asJson(await asResult(() => novel.commitPhase(
          args.projectId,
          args.phase as PhaseId,
          args.artifact,
          { passed: args.passed ?? errorCount === 0, errorCount, warningCount: args.warningCount ?? 0 },
        )))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_override',
      description: '用户级阶段覆盖：force（review 强制放行）/ reopen（驳回回修改）/ skip（跳过）/ rollback（revision/done 回退到已批准阶段）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        phase: { type: 'string', required: true, description: '目标阶段 id' },
        action: { type: 'string', required: true, description: 'force|reopen|skip|rollback' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; phase: string; action: 'force' | 'reopen' | 'skip' | 'rollback' }
        return asJson(await asResult(() => novel.overridePhase(args.projectId, args.phase as PhaseId, args.action)))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_write_chapter',
      description: '组装写章上下文包（L1 全书设定 + L2 卷章细纲与邻近章节 + L3 摘要/变量/世界书命中 + 硬约束），' +
        '模型据此在回复中直接输出本章正文，随后调用 novel_commit_chapter 落盘。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '章节号' },
        brief: { type: 'string', description: '本章细纲（缺省用 chapter 阶段产物）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; brief?: string }
        return asJson(await asResult(() => novel.assemble(args.projectId, args.chapterNo, args.brief)))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_commit_chapter',
      description: '提交章节正文：自动统计字数/对话占比/达标判定，落盘 chapters/ch<no>.md，更新项目统计，' +
        '提取正文中的 <JSONPatch> 更新变量。返回章节元数据与达标状态。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
        chapterNo: { type: 'number', required: true, description: '章节号' },
        title: { type: 'string', required: true, description: '章节标题' },
        text: { type: 'string', required: true, description: '章节正文' },
        brief: { type: 'string', description: '一句话梗概（细纲对照用）' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const args = rawArgs as { projectId: string; chapterNo: number; title: string; text: string; brief?: string }
        return asJson(await asResult(async () => {
          const chapter = await novel.saveChapter(args.projectId, args.chapterNo, args.title, args.text, args.brief)
          const stats = await novel.chapterStats(args.projectId, args.chapterNo)
          return { chapter, stats }
        }))
      },
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_audit',
      description: '查看项目审计日志（阶段流转/提交/覆盖/写章事件）。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => asJson(await asResult(() => novel.audit((rawArgs as { projectId: string }).projectId))),
      isConcurrencySafe: () => true,
    })),

    ctx.tools.register(defineTool({
      name: 'novel_stats',
      description: '查看项目统计：总字数/章节数/最近写入/各阶段状态。',
      parameters: {
        projectId: { type: 'string', required: true, description: '项目 ID' },
      },
      output: jsonOutput(),
      execute: async (rawArgs) => {
        const projectId = (rawArgs as { projectId: string }).projectId
        return asJson(await asResult(async () => {
          const book = await novel.load(projectId)
          return {
            id: book.id,
            title: book.title,
            genre: book.genre,
            status: book.status,
            currentPhase: book.currentPhase,
            stats: book.stats,
            phases: book.phases,
          }
        }))
      },
      isConcurrencySafe: () => true,
    })),
  ]
}
