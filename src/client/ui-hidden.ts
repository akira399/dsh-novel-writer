/**
 * dsh-novel-writer — 侧边栏入口隐藏开关（浏览器端本地存储）。
 *
 * 与 host settings 解耦：无论 host 的 settings 命名空间是否对该 client 暴露
 * （部分宿主/连接模式下 `settingsScope` 会标记为 `unavailable`），
 * 「隐藏侧边栏入口（摸鱼模式）」都可用——存 localStorage，切换通过
 * 自定义事件即时通知入口增删。host settings 可用时由设置卡同步写一份。
 */

/** localStorage 键。 */
export const UI_HIDDEN_KEY = 'dsh-novel-writer:uiHidden'
/** 设置卡切换时派发，通知侧边栏入口即时增删（不依赖 host settings 可达性）。 */
export const UI_HIDDEN_EVENT = 'dsh-novel-writer:ui-hidden-change'

/** 读取当前是否隐藏侧边栏入口。 */
export function readUiHidden(): boolean {
  try {
    return localStorage.getItem(UI_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

/** 写入隐藏开关（true=隐藏），并派发事件通知入口即时生效。 */
export function writeUiHidden(hidden: boolean): void {
  try {
    localStorage.setItem(UI_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    // localStorage 不可用时尽力而为（降级为仅本次会话不起作用）
  }
  try {
    window.dispatchEvent(new Event(UI_HIDDEN_EVENT))
  } catch {
    // 无窗口环境（SSR/测试）忽略
  }
}

/** 订阅隐藏开关变化（返回取消订阅函数）。 */
export function subscribeUiHidden(listener: () => void): () => void {
  window.addEventListener(UI_HIDDEN_EVENT, listener)
  return () => window.removeEventListener(UI_HIDDEN_EVENT, listener)
}
