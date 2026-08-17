/**
 * dsh-novel-writer — 抽屉布局尺寸纯函数（P3 布局优化模块）。
 *
 * 目标：小说工坊抽屉不被宿主聊天框条遮挡——展开模式加宽 + 底部按聊天条高度
 * 物理避让（bottom 抬到聊天条之上，内容与交互完全不重叠）。纯函数、零 IO、
 * 零 DOM，可全量单测；DOM 探测逻辑在 client（workshop-drawer.tsx）侧。
 */

export interface DrawerSize {
  /** 抽屉宽度（px）。 */
  width: number
  /** 抽屉底部距视口底部的避让距离（px）。0 = 贴底。 */
  bottom: number
}

/** 收起模式宽度（与既有 380px 一致）。 */
export const DRAWER_COLLAPSED_WIDTH = 380
/** 展开模式宽度上限。 */
export const DRAWER_EXPANDED_MAX = 780
/** 展开模式宽度 = 视口宽度的比例上限。 */
export const DRAWER_EXPANDED_RATIO = 0.92
/** 检测到聊天条后额外留的间距（px）。 */
export const DRAWER_BOTTOM_GAP = 8

/**
 * 计算抽屉展开/收起的尺寸与底部避让。
 * @param expanded 是否展开
 * @param viewportWidth 视口宽度（window.innerWidth）
 * @param bottomBarHeight 检测到的底部固定条（聊天输入条等）高度；0 = 未检测到
 */
export function drawerSize(expanded: boolean, viewportWidth: number, bottomBarHeight: number): DrawerSize {
  const width = expanded
    ? Math.min(DRAWER_EXPANDED_MAX, Math.max(0, Math.round(viewportWidth * DRAWER_EXPANDED_RATIO)))
    : DRAWER_COLLAPSED_WIDTH
  const bottom = bottomBarHeight > 0 ? bottomBarHeight + DRAWER_BOTTOM_GAP : 0
  return { width, bottom }
}
