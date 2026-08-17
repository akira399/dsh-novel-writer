/**
 * dsh-novel-writer — 侧边栏入口（P1-I）。
 * DOM 级注入 + MutationObserver 自愈（task-board sidebar-entry 模式）：
 * 侧边栏无第三方 slot，入口行插在 New Session 按钮之后。
 */

/** 稳定选择器标识本插件注入的入口行。 */
export const ENTRY_SELECTOR = '[data-dsh-novel-writer-entry]'

const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h7"/><circle cx="12" cy="12.5" r="1.8"/></svg>`

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

function createEntry(onClick: () => void): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshNovelWriterEntry = ''
  entry.title = '大肥鱼的小说工坊'
  entry.setAttribute('aria-label', '大肥鱼的小说工坊')
  entry.style.cssText = [
    'display:flex', 'alignItems:center', 'gap:8px', 'width:100%',
    'padding:8px 12px', 'border:none', 'background:transparent',
    'cursor:pointer', 'fontSize:13px', 'color:inherit',
  ].join(';')
  entry.innerHTML = `<span style="display:flex">${ICON}</span><span>大肥鱼的小说工坊</span>`
  entry.addEventListener('click', onClick)
  return entry
}

/** 入口行插到 New Session 按钮之后；返回 disposer（含 observer 清理）。 */
export function mountSidebarEntry(onClick: () => void, onFirstMount?: () => void): () => void {
  let placed = false
  let observer: MutationObserver | null = null

  const place = (): void => {
    if (document.querySelector(ENTRY_SELECTOR)) return
    const root = sidebarRoot()
    const button = newSessionButton(root ?? document.body)
    if (!root || !button) return
    const existing = document.querySelector<HTMLButtonElement>(ENTRY_SELECTOR)
    if (existing) existing.remove()
    const entry = createEntry(onClick)
    button.insertAdjacentElement('afterend', entry)
    placed = true
    onFirstMount?.()
  }

  const tryPlace = (): void => {
    try {
      if (!placed) place()
    } catch {
      // 挂载失败不抛出（web shell boot 安全）
    }
  }

  // 立即尝试 + 自愈观察
  tryPlace()
  if (!placed) {
    observer = new MutationObserver(() => tryPlace())
    observer.observe(document.body, { childList: true, subtree: true })
  }

  return () => {
    observer?.disconnect()
    document.querySelector(ENTRY_SELECTOR)?.remove()
  }
}
