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
import React, { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NovelSettingsTab } from './settings-tab.tsx'
import { mountWorkshopDrawer, type WorkshopHandle } from './workshop-drawer.tsx'
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

/**
 * 侧边栏入口的 UI 版本戳（渲染到 `data-nw-ui`）。
 *
 * 用途：客户端 bundle 由宿主按 rev 缓存，改版后难以判断浏览器到底加载了哪一版。
 * 排查时在侧边栏入口上「检查元素」，看 `data-nw-ui` 即可确认。
 * - v2：去掉 emoji（点击热区与视觉对齐）、加 hover 反馈、消费 owner props `wide`。
 * - v3：修掉 `font: 'inherit'` 简写覆盖 fontSize 的问题，抽屉补 border-box 描边。
 * - v4：删除 DOM 兜底入口（它曾与 slot 同时生效，造成两个同名入口）。
 */
const SIDEBAR_UI_VERSION = 'v4'

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
 * 插件不应把它当编译期依赖；这里只声明本插件真正使用的两个成员。
 *
 * 注意：不要再依赖 `slots.entries`——真实服务上的方法是 `entriesOf`，
 * 写错名字会静默返回 undefined（曾因此导致 DOM 兜底与 slot 同时生效、出现重复入口）。
 */
interface SlotsFace {
  register(options: Record<string, unknown>, component: (props?: { wide?: boolean }) => React.ReactNode): () => void
  inject(key: string, callback: () => () => void): () => void
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

  const ensureWorkshop = (): WorkshopHandle => {
    if (!workshop) workshop = mountWorkshopDrawer({ api: '/api/novel-writer', fenceHeader: 'x-dsh-novel-writer' })
    return workshop
  }

  const openWorkshop = (): void => {
    ensureWorkshop().toggle()
  }

  /**
   * 注册侧边栏入口。
   *
   * 只用官方 `sidebar.footer.action` slot，**不再有 DOM 兜底**。
   *
   * 历史教训：0.2.0 之前靠 MutationObserver 往侧边栏 DOM 里插一行（见已删除的
   * sidebar.ts）。迁移到 slot 后我保留它作为「非标准 web 壳」的兜底，并以
   * `slots.entries(...)` 判断 slot 是否已生效——但运行时该方法名是 `entriesOf`，
   * 于是判断恒为 false，**兜底与 slot 同时生效，侧边栏出现两个同名入口**；
   * 而用户点到的恰好是带 🐟 emoji 的那个旧 DOM 行，所以「改了却看不出变化」。
   *
   * 现在单一来源（slot）。若 slots 服务不可用，只告警不注入 DOM——宁可不显示，
   * 也不再制造重复入口与不可控 DOM。
   */
  const ensureSlotEntry = (): boolean => {
    if (slotDisposer) return true
    if (!slots) return false
    try {
      slotDisposer = slots.inject('sidebar.footer.action', () =>
        slots!.register(
          { name: 'sidebar.footer.action', id: FOOTER_ID, order: 110, label: () => '大肥鱼的小说工坊' },
          // owner 只传 { wide }（false = 56px 收起栏），据此切换图标/文字形态。
          // 参数可选：既能接住真实渲染器传入的 owner props，也满足 SlotsFace 的零参签名。
          (props?: { wide?: boolean }) => React.createElement(NovelSidebarAction, { onClick: openWorkshop, wide: props?.wide }),
        ),
      )
      return true
    } catch (error) {
      console.warn('[' + TAB_ID + '] 侧边栏入口注册失败', error)
      return false
    }
  }

  /** 清理历史版本注入的 DOM 入口（含 MutationObserver 残留元素）。 */
  const sweepLegacyDomEntries = (): void => {
    try {
      for (const el of document.querySelectorAll('[data-dsh-novel-writer-entry]')) el.remove()
    } catch {
      // 无 DOM 环境忽略
    }
  }

  /** 按当前 uiHidden 增删侧边栏入口（幂等）。 */
  const ensureEntry = (): void => {
    sweepLegacyDomEntries()
    if (readUiHidden()) {
      slotDisposer?.()
      slotDisposer = null
      return
    }
    ensureSlotEntry()
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
      sweepLegacyDomEntries()
      workshop?.dispose()
      workshop = null
    },
    TAB_ID + ': sidebar + drawer',
  )
}

/**
 * 侧边栏底部入口（slot 版）。
 *
 * 契约：`sidebar.footer.action` 的 owner props 只有 `{ wide }`（false = 56px 收起栏）。
 * 渲染成一个**自足**的按钮，整块都是点击热区：
 *  - 过去用 `🐟` emoji 打头：emoji 在不同平台的字形宽度/基线不一致，会把文字挤离
 *    按钮左缘，视觉上的「文字」与实际 hit area 错位；现在改用内联 SVG 图标并固定尺寸。
 *  - 过去没有 hover 反馈，用户不知道哪儿能点；现在整个 footer 行都有 hover/active 底色。
 *  - 收起态只显示图标（不塞窄文字）。
 */
function NovelSidebarAction({ onClick, wide = true }: { onClick: () => void; wide?: boolean }): React.ReactNode {
  const [hover, setHover] = useState(false)
  const showLabel = wide !== false

  return React.createElement(
    'button',
    {
      type: 'button',
      title: '大肥鱼的小说工坊',
      'aria-label': '大肥鱼的小说工坊',
      // 版本戳：便于确认浏览器是否已加载新构建（右键检查元素可见 data-nw-ui）
      'data-nw-ui': SIDEBAR_UI_VERSION,
      onClick,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setHover(true),
      onBlur: () => setHover(false),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: showLabel ? 'flex-start' : 'center',
        gap: showLabel ? '8px' : 0,
        flex: '0 0 auto',
        // 收起时给一个正方形容器，展开时铺满 footer 行
        width: showLabel ? '100%' : '32px',
        height: '32px',
        boxSizing: 'border-box',
        padding: showLabel ? '0 8px' : 0,
        margin: 0,
        border: 'none',
        borderRadius: '6px',
        background: hover ? 'rgba(127,127,127,.16)' : 'transparent',
        cursor: 'pointer',
        // 注意：不要用 `font` 简写——它会重置 fontSize/lineHeight（此前因此文字尺寸不受控）
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '1',
        color: 'inherit',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        pointerEvents: 'auto',
        transition: 'background-color .12s ease',
      },
    },
    React.createElement(
      'span',
      { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', width: '16px', height: '16px' } },
      React.createElement(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        // 书本 + 笔：与「小说工坊」语义一致
        React.createElement('path', { d: 'M2.5 3.2h6a1.8 1.8 0 0 1 1.8 1.8v7.8H4.3A1.8 1.8 0 0 1 2.5 11z' }),
        React.createElement('path', { d: 'M10.3 5h1.4a1.8 1.8 0 0 1 1.8 1.8v6h-3.2' }),
        React.createElement('path', { d: 'M11.9 1.6l1.4 1.4-3.1 3.1-1.8.4.4-1.8z' }),
      ),
    ),
    showLabel ? React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, '大肥鱼的小说工坊') : null,
  )
}
