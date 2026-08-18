/**
 * @dsh-external/dsh-novel-writer — client 半区（P1-I）。
 * 装配：设置卡（settings.plugin.item，读写 dsh-novel-writer 命名空间）+
 * 侧边栏入口（DOM 注入，自愈模式）+ 工作台抽屉（React 根）。
 * 失败策略：挂载问题只记日志、绝不抛出（web shell boot 安全）。
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NovelSettingsCard } from './settings-card.tsx'
import { mountWorkshopDrawer, type WorkshopHandle } from './workshop-drawer.tsx'
import { mountSidebarEntry } from './sidebar.ts'

/** 本插件注册的 Web UI 插件组卡片槽位（task-board 同款声明模式）。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

export const inject = ['slots', 'settingsScope', 'sessions', 'workspaces']

/** 设置命名空间（与 host 端一致）。 */
const NS = 'dsh-novel-writer'

interface SettingsShape {
  enabled: boolean
  dataDir: string
  uiHidden: boolean
}

export function apply(ctx: ClientContext): void {
  // 设置卡：绑定命名空间，注入到 Web UI 插件组
  const scope = ctx.settingsScope.bind<SettingsShape>({ namespace: NS } satisfies SettingsScopeSpec<SettingsShape>)
  ctx.effect(() => ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      // 同时提供 id 与 key：不同宿主版本把该 slot 声明为 "list"（用 id）或 "keyed"（用 key），
      // 带两者可兼容两种环境，避免 "keyed slot requires options.key" 加载报错。
      // （类型按本机 list 声明走；运行时额外的 key 由 cast 绕过 list-only 类型约束）
      id: '@dsh-external/dsh-novel-writer',
      key: '@dsh-external/dsh-novel-writer',
      order: 110,
      label: () => '大肥鱼的小说工坊',
    } as never, () => React.createElement(NovelSettingsCard, { scope })),
  ), '@dsh-external/dsh-novel-writer: settings card')

  // 侧边栏入口 + 工作台抽屉（DOM 级，自愈注入；一键写章走 host LLM 直写自动保存）
  // 摸鱼模式：uiHidden=true 即时隐藏侧边栏入口（不需重启/刷新，回设置页取消勾选即恢复）
  let workshop: WorkshopHandle | null = null
  let sidebarDisposer: (() => void) | null = null

  const ensureWorkshop = (): WorkshopHandle => {
    if (!workshop) workshop = mountWorkshopDrawer({ api: '/api/novel-writer', fenceHeader: 'x-dsh-novel-writer' })
    return workshop
  }

  /** 按当前 uiHidden 增删侧边栏入口（幂等）。 */
  const ensureEntry = (): void => {
    const hidden = scope.getSnapshot().status === 'ready'
      ? scope.getSnapshot().value?.uiHidden === true
      : false
    if (hidden) {
      sidebarDisposer?.()
      sidebarDisposer = null
    } else if (!sidebarDisposer) {
      sidebarDisposer = mountSidebarEntry(() => {
        ensureWorkshop().toggle()
      }, () => {
        ensureWorkshop()
      })
    }
  }

  // 初始注入 + 监听 uiHidden 即时切换
  ensureEntry()
  const unsub = scope.subscribe(() => ensureEntry())
  ctx.effect(() => () => {
    unsub()
    sidebarDisposer?.()
    sidebarDisposer = null
    workshop?.dispose()
    workshop = null
  }, '@dsh-external/dsh-novel-writer: sidebar + drawer')
}

export type { SettingsScope }
