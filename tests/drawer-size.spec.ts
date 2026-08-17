import { describe, expect, it } from 'vitest'
import {
  drawerSize,
  DRAWER_COLLAPSED_WIDTH,
  DRAWER_EXPANDED_MAX,
  DRAWER_BOTTOM_GAP,
} from '../src/core/drawer-size.ts'

describe('drawerSize — 展开/收起宽度', () => {
  it('收起 = 固定 380px', () => {
    expect(drawerSize(false, 1920, 0)).toEqual({ width: DRAWER_COLLAPSED_WIDTH, bottom: 0 })
    expect(drawerSize(false, 800, 0).width).toBe(DRAWER_COLLAPSED_WIDTH)
  })

  it('展开 = 视口 92% 但不超过 780px', () => {
    expect(drawerSize(true, 1920, 0).width).toBe(780)
    expect(drawerSize(true, 800, 0).width).toBe(Math.round(800 * 0.92))
    expect(drawerSize(true, 400, 0).width).toBe(Math.round(400 * 0.92))
  })

  it('展开宽度恒不超上限', () => {
    expect(drawerSize(true, 10000, 0).width).toBe(DRAWER_EXPANDED_MAX)
  })
})

describe('drawerSize — 底部聊天条避让', () => {
  it('检测到聊天条 → bottom = 条高 + 间距', () => {
    expect(drawerSize(false, 1280, 60).bottom).toBe(60 + DRAWER_BOTTOM_GAP)
    expect(drawerSize(true, 1280, 60).bottom).toBe(60 + DRAWER_BOTTOM_GAP)
  })

  it('未检测到（0）→ 贴底', () => {
    expect(drawerSize(false, 1280, 0).bottom).toBe(0)
    expect(drawerSize(true, 1280, 0).bottom).toBe(0)
  })

  it('负数/异常值按未检测到处理', () => {
    expect(drawerSize(true, 1280, -5).bottom).toBe(0)
  })
})
