import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  drawerSize,
  DRAWER_COLLAPSED_WIDTH,
  DRAWER_EXPANDED_MAX,
  DRAWER_BOTTOM_GAP,
} from '../src/core/drawer-size.ts'

const DRAWER_SRC = readFileSync(
  join(fileURLToPath(import.meta.url), '..', '..', 'src', 'client', 'workshop-drawer.tsx'),
  'utf8',
)

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

/**
 * 现场反馈：抽屉打开后，再点侧边栏入口想收起却没有反应，用户没有任何
 * 可见的关闭途径。这里钉住「抽屉自身必须有常驻关闭按钮」这条契约。
 */
describe('抽屉关闭途径', () => {
  it('头部有常驻关闭按钮（data-action="close"）', () => {
    expect(DRAWER_SRC).toContain("'data-action': 'close'")
    expect(DRAWER_SRC).toContain('关闭工作台')
  })

  it('关闭动作接到 close()，且是幂等收起（不依赖再次点击侧边栏入口）', () => {
    expect(DRAWER_SRC).toContain("case 'close': close(); break")
    expect(DRAWER_SRC).toContain('const close = (): void => {')
    // 幂等：已关闭时直接返回
    expect(DRAWER_SRC).toMatch(/const close = \(\): void => \{\s*\n\s*if \(!open\) return/)
  })

  it('WorkshopHandle 暴露 close()，供外部与测试调用', () => {
    expect(DRAWER_SRC).toMatch(/export interface WorkshopHandle \{[\s\S]*?close\(\): void/)
  })
})
