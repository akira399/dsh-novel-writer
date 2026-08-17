/**
 * dsh-novel-writer — 装配控制器（P2-G 扩展）。
 *
 * 职责：settings 门禁的核心逻辑——enabled 开关与配置变更时的
 * 「注册/注销」幂等切换。与 cordis settings 服务解耦（controller 只接受
 * 入参与注册回调），因此可独立单测；src/index.ts 负责把 settings 服务
 * 的 scope.get/watch 接到本控制器。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LoreService } from './core/lorebook/index.ts'
import type { NovelService } from './core/novel/service.ts'
import type { LlmClient } from './core/llm/client.ts'
import { registerNovelTools } from './tools/index.ts'

export interface NovelServices {
  lore: LoreService
  novel: NovelService
  llm: LlmClient | null
  /** 项目目录（按项目隔离的 aux/账本/时间线文件落点）。 */
  bookDirOf(bookId: string): string
}

export interface NovelAssemblyOptions {
  /** 由目录构造服务集合的工厂（目录变化时重建）。 */
  createServices(dir: string): NovelServices
}

export class NovelAssembly {
  private readonly ctx: Context
  private readonly createServices: (dir: string) => NovelServices
  private disposeTools: (() => void) | null = null
  private current: NovelServices | null = null
  private currentDir: string | null = null

  constructor(ctx: Context, options: NovelAssemblyOptions) {
    this.ctx = ctx
    this.createServices = options.createServices
  }

  /** 当前是否已装配（工具已注册）。 */
  get active(): boolean {
    return this.disposeTools !== null
  }

  /**
   * 幂等同步：enabled=true 且未装配 → 注册；enabled=false 且已装配 → 注销。
   * 目录变化（且仍启用）→ 先注销再按新目录重建。
   */
  sync(enabled: boolean, lorebookDir: string): void {
    if (!enabled) {
      this.teardown()
      return
    }
    if (this.disposeTools !== null && this.currentDir === lorebookDir) return
    // 目录变化或首次启用：重建
    this.teardown()
    const services = this.createServices(lorebookDir)
    this.disposeTools = registerNovelTools(this.ctx, services)
    this.current = services
    this.currentDir = lorebookDir
  }

  /** 注销全部（幂等）。 */
  teardown(): void {
    this.disposeTools?.()
    this.disposeTools = null
    this.current = null
    this.currentDir = null
  }

  /** 当前服务实例（供扩展模块消费；未启用时为 null）。 */
  get services(): NovelServices | null {
    return this.current
  }
}
