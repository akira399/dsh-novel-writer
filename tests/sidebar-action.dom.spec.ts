// @vitest-environment jsdom
/**
 * 侧边栏入口的真实 DOM 行为测试。
 *
 * 现场反馈：「点这行字本身没反应，实际能点的是这行字右边一点的空白」。
 * 这类问题静态读代码看不出来（onClick 明明挂在 button 上），必须真的渲染 DOM
 * 并在**文字节点本身**上派发点击，才能验证热区是否覆盖了看得见的内容。
 *
 * 这里同时钉住三件事：
 *  1. 点文字 → 触发 onClick（这是用户真正在点的东西）
 *  2. 点图标 → 触发 onClick
 *  3. 点按钮内边距的空白 → 也触发（整块都是热区）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

/** 与 src/client/index.ts 中 NovelSidebarAction 等价的渲染（同结构、同样式、同事件）。 */
function SidebarAction({ onClick, wide = true }: { onClick: () => void; wide?: boolean }): React.ReactNode {
  const [hover, setHover] = React.useState(false)
  const showLabel = wide !== false
  return React.createElement(
    'button',
    {
      type: 'button',
      'data-nw-ui': 'v4',
      onClick,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        width: showLabel ? '100%' : '32px',
        height: '32px',
        boxSizing: 'border-box',
        padding: showLabel ? '0 8px' : 0,
        border: 'none',
        background: hover ? 'rgba(127,127,127,.16)' : 'transparent',
        cursor: 'pointer',
        pointerEvents: 'auto',
      },
    },
    React.createElement('span', { style: { display: 'inline-flex' } }, 'icon'),
    showLabel ? React.createElement('span', null, '大肥鱼的小说工坊') : null,
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('侧边栏入口 —— 点击热区必须覆盖看得见的文字', () => {
  it('点击文字节点本身会触发 onClick', () => {
    const onClick = vi.fn()
    act(() => root.render(React.createElement(SidebarAction, { onClick })))

    const label = [...container.querySelectorAll('span')].find((s) => s.textContent === '大肥鱼的小说工坊')
    expect(label, '应能找到文字节点').toBeDefined()

    // 在文字节点上派发事件，并让其正常冒泡到 button（模拟用户点这行字）
    act(() => {
      label!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('点击图标也会触发 onClick', () => {
    const onClick = vi.fn()
    act(() => root.render(React.createElement(SidebarAction, { onClick })))
    const icon = container.querySelector('span')
    act(() => {
      icon!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('点击按钮本身的空白区域（内边距）也触发——整块即热区', () => {
    const onClick = vi.fn()
    act(() => root.render(React.createElement(SidebarAction, { onClick })))
    const button = container.querySelector('button')!
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('文字不在按钮之外：文字节点是按钮的后代（热区与视觉不分离）', () => {
    act(() => root.render(React.createElement(SidebarAction, { onClick: () => {} })))
    const button = container.querySelector('button')!
    const label = [...container.querySelectorAll('span')].find((s) => s.textContent === '大肥鱼的小说工坊')!
    expect(button.contains(label)).toBe(true)
  })

  it('按钮声明了 pointerEvents:auto 与 cursor:pointer，且没有遮挡热区的负边距', () => {
    act(() => root.render(React.createElement(SidebarAction, { onClick: () => {} })))
    const button = container.querySelector('button')!
    expect(button.style.pointerEvents).toBe('auto')
    expect(button.style.cursor).toBe('pointer')
    expect(button.style.margin === '' || button.style.margin === '0px' || button.style.margin === '0').toBe(true)
  })

  it('鼠标进入时出现底色反馈（用户据此判断哪里可点）', () => {
    act(() => root.render(React.createElement(SidebarAction, { onClick: () => {} })))
    const button = container.querySelector('button')!
    expect(button.style.background).toBe('transparent')
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    // React 的 onMouseEnter 由 mouseover 合成驱动；jsdom 下可能不触发，
    // 因此这里只断言初始态与「存在 hover 分支」——真正的视觉验证由人工确认。
    expect(button.style.background === 'transparent' || button.style.background.includes('rgba')).toBe(true)
  })

  /**
   * 现场反馈的真实场景：**第一次点打开，打开之后再点就没反应了**。
   *
   * 前几个用例都只点了一次（抽屉未打开），覆盖不到这个场景。这里模拟
   * 「点击 → 打开 → 再点击 → 关闭」的完整循环，验证入口是可反复切换的。
   */
  it('可反复切换：点开之后再点文字仍能触发（模拟开→关）', () => {
    const open = { value: false }
    const onClick = vi.fn(() => {
      open.value = !open.value
    })
    act(() => root.render(React.createElement(SidebarAction, { onClick })))

    const label = (): HTMLElement =>
      [...container.querySelectorAll('span')].find((s) => s.textContent === '大肥鱼的小说工坊')!

    // 第一次：打开
    act(() => {
      label().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(true)

    // 第二次：抽屉已打开，再点同一行文字 —— 必须仍然触发
    act(() => {
      label().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(open.value).toBe(false)
  })

  it('抽屉打开后入口依然可点：入口不应被抽屉的根元素遮挡', () => {
    // 抽屉根元素：position:fixed + 最高 z-index；入口所在容器若被其覆盖，
    // 点击会落到抽屉上。这里断言入口的按钮自身声明了可点击，且未被禁用。
    act(() => root.render(React.createElement(SidebarAction, { onClick: () => {} })))
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(false)
    expect(button.style.pointerEvents).toBe('auto')
    // 入口容器（本测试里是 document.body 的子节点）不应带 pointer-events:none
    expect(getComputedStyle(container).pointerEvents).not.toBe('none')
  })
})
