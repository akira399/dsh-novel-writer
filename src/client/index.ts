/**
 * @dsh-external/dsh-novel-writer — client 半区（DSH 0.2.0-rc.2 适配）。
 *
 * 装配：
 *  - 设置页签：注册进 Plugins 设置区（`settings.plugins.tab`），配置读写走
 *    `ctx.configForms.get(entryId)`。0.1.x 用的 `settings.plugin.item` slot 与
 *    `@deepseek-ai/dsh-client-runtime` 包在 0.2.0 均已不存在。
 *  - 侧边栏入口：优先注册 `sidebar.footer.action` slot；该 slot 在本壳不可用时
 *    回退到 DOM 自愈注入（兼容非标准 web 壳）。
 *  - 工作台抽屉：自成 React 根，挂载到 body。
 *
 * 失败策略：挂载问题只记日志、绝不抛出（web shell boot 安全）。
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NovelSettingsTab } from './settings-tab.tsx'
import { mountWorkshopDrawer, type WorkshopHandle } from './workshop-drawer.tsx'
import { mountSidebarEntry } from './sidebar.ts'
import { readUiHidden, subscribeUiHidden, UI_HIDDEN_KEY } from './ui-hidden.ts'

/**
 * 声明本插件占用的 slot 类型。
 *
 * `settings.plugins.tab` 与 `sidebar.footer.action` 已由官方包通过
 * declaration merging 声明；这里补 `settings.plugins.tab` 的重复声明是
 * 幂等合并（相同 kind/scope/owner），保证即使官方 augment 未加载也能编译。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Plugins 设置区的一个页签（顺序由 order 决定）。 */
    'settings.plugins.tab': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

/** 客户端半区所需服务。configForms 由 dsh-client-ui-settings 提供。 */
export const inject = ['slots', 'configForms']

/** 设置命名空间（= host 侧 profile entry id，见 src/settings.ts）。 */
const ENTRY_ID = 'dsh-novel-writer'

/** 本插件注册的 slot 单元 id。 */
const TAB_ID = '@dsh-external/dsh-novel-writer'
const FOOTER_ID = '@dsh-external/dsh-novel-writer-sidebar'

/** 与 src/settings.ts 的 Config 对应的表单值形状。 */
interface SettingsShape {
  enabled?: boolean
  dataDir?: string
  uiHidden?: boolean
}

/**
 * `ctx.slots` 的最小结构面。
 *
 * 0.2.0 把 slot 服务类型放在 `@deepseek-ai/dsh-client-ui-renderer`（渲染器包），
 * 插件不应把它当编译期依赖；这里只声明本插件真正使用的三个成员，运行时缺任何
 * 一个都会降级而不是抛出。
 */
interface SlotsFace {
  register(options: Record<string, unknown>, component: () => React.ReactNode): () => void
  inject(key: string, callback: () => () => void): () => void
  entries?(key: string): readonly unknown[]
}

/** 取 slots 服务（不可用时 undefined）。 */
function slotsOf(ctx: Context): SlotsFace | undefined {
  try {
    const slots = ctx.get('slots') as Partial<SlotsFace> | undefined
    if (typeof slots?.register === 'function' && typeof slots.inject === 'function') {
      return slots as SlotsFace
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 只读地取 configForms（未装配时为 undefined，不抛出）。 */
function configFormOf(ctx: Context): ConfigForm<SettingsShape> | undefined {
  try {
    const forms = ctx.get('configForms') as { get<T>(id: string): ConfigForm<T> } | undefined
    return forms?.get<SettingsShape>(ENTRY_ID)
  } catch {
    return undefined
  }
}

/** sidebar.footer.action slot 当前是否有活跃占用者。 */
function footerSlotOccupied(slots: SlotsFace): boolean {
  try {
    return (slots.entries?.('sidebar.footer.action')?.length ?? 0) > 0
  } catch {
    return false
  }
}

export function apply(ctx: Context): void {
  const form = configFormOf(ctx)
  const slots = slotsOf(ctx)

  // ── 设置页签（Plugins 设置区）───────────────────────────────
  if (slots) {
    try {
      ctx.effect(
        () =>
          slots.inject('settings.plugins.tab', () =>
            slots.register(
              {
                name: 'settings.plugins.tab',
                id: TAB_ID,
                order: 110,
                label: () => '大肥鱼的小说工坊',
              },
              () => React.createElement(NovelSettingsTab, { form }),
            ),
          ),
        TAB_ID + ': settings tab',
      )
    } catch (error) {
      console.warn('[' + TAB_ID + '] 设置页签注册失败', error)
    }
  } else {
    console.warn('[' + TAB_ID + '] slots 服务不可用：设置页签未注册')
  }

  // ── 侧边栏入口 + 工作台抽屉 ─────────────────────────────────
  let workshop: WorkshopHandle | null = null
  let slotDisposer: (() => void) | null = null
  let sidebarDisposer: (() => void) | null = null

  const ensureWorkshop = (): WorkshopHandle => {
    if (!workshop) workshop = mountWorkshopDrawer({ api: '/api/novel-writer', fenceHeader: 'x-dsh-novel-writer' })
    return workshop
  }

  const openWorkshop = (): void => {
    ensureWorkshop().toggle()
  }

  /** 注册 slot 入口；slot 不可用时返回 false（由调用方回退 DOM 注入）。 */
  const ensureSlotEntry = (): boolean => {
    if (slotDisposer) return true
    if (!slots) return false
    let dispose: (() => void) | null = null
    try {
      dispose = slots.inject('sidebar.footer.action', () =>
        slots.register(
          { name: 'sidebar.footer.action', id: FOOTER_ID, order: 110, label: () => '大肥鱼的小说工坊' },
          () => React.createElement(NovelSidebarAction, { onClick: openWorkshop }),
        ),
      )
      // slot 未声明时 inject 只挂起回调、不会真正注册；用占用者数量确认生效。
      if (footerSlotOccupied(slots)) {
        slotDisposer = dispose
        return true
      }
      dispose()
      return false
    } catch {
      dispose?.()
      return false
    }
  }

  /** 按当前 uiHidden 增删侧边栏入口（幂等）。 */
  const ensureEntry = (): void => {
    if (readUiHidden()) {
      slotDisposer?.()
      slotDisposer = null
      sidebarDisposer?.()
      sidebarDisposer = null
      return
    }
    // 工作台抽屉按需创建（首次点击时）
    if (ensureSlotEntry()) return
    if (!sidebarDisposer) sidebarDisposer = mountSidebarEntry(openWorkshop, () => ensureWorkshop())
  }

  ensureEntry()
  const unsubUi = subscribeUiHidden(() => ensureEntry())

  // host settings 里的 uiHidden 同步到 localStorage 后触发 ensureEntry
  const unsubForm = form?.subscribe(() => {
    const snapshot = form.getSnapshot()
    if (snapshot.status === 'ready' && snapshot.value?.uiHidden !== undefined) {
      try {
        localStorage.setItem(UI_HIDDEN_KEY, snapshot.value.uiHidden ? '1' : '0')
      } catch {
        // localStorage 不可用时忽略
      }
    }
    ensureEntry()
  })

  ctx.effect(
    () => () => {
      unsubUi()
      unsubForm?.()
      slotDisposer?.()
      slotDisposer = null
      sidebarDisposer?.()
      sidebarDisposer = null
      workshop?.dispose()
      workshop = null
    },
    TAB_ID + ': sidebar + drawer',
  )
}

/** 侧边栏底部入口（slot 版）。 */
function NovelSidebarAction({ onClick }: { onClick: () => void }): React.ReactNode {
  return React.createElement(
    'button',
    {
      type: 'button',
      title: '大肥鱼的小说工坊',
      'aria-label': '大肥鱼的小说工坊',
      onClick,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '6px 8px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '13px',
        color: 'inherit',
      },
    },
    React.createElement('span', { style: { display: 'flex' } }, '🐟'),
    React.createElement('span', null, '大肥鱼的小说工坊'),
  )
}
