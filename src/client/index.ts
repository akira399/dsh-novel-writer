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
}

export function apply(ctx: ClientContext): void {
  // 设置卡：绑定命名空间，注入到 Web UI 插件组
  const scope = ctx.settingsScope.bind<SettingsShape>({ namespace: NS } satisfies SettingsScopeSpec<SettingsShape>)
  ctx.effect(() => ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      id: '@dsh-external/dsh-novel-writer',
      order: 110,
      label: () => '大肥鱼的小说工坊',
    }, () => React.createElement(NovelSettingsCard, { scope })),
  ), '@dsh-external/dsh-novel-writer: settings card')

  // 侧边栏入口 + 工作台抽屉（DOM 级，自愈注入；一键写章走 host LLM 直写自动保存）
  let workshop: WorkshopHandle | null = null
  const disposeSidebar = mountSidebarEntry(() => {
    workshop?.toggle()
  }, () => {
    workshop = mountWorkshopDrawer({ api: '/api/novel-writer', fenceHeader: 'x-dsh-novel-writer' })
  })
  ctx.effect(() => () => {
    disposeSidebar()
    workshop?.dispose()
  }, '@dsh-external/dsh-novel-writer: sidebar + drawer')
}

export type { SettingsScope }
