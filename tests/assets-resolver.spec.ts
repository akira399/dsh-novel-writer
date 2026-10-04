/**
 * resolveAssetsDir 单测 —— 钉住「多级目录布局下 assets 必须能解析」这一回归。
 *
 * 背景：assets 路径此前固定写作 `'..','assets'`，只在 Rspack 打包布局（模块位于
 * 包根下一级）下成立。走 tsc 的构建产物里模块位于 `lib/<dir>/`，到 assets 需要
 * 上两级，于是提示词库/技能/预设/示例书全部解析失败并静默降级为空。
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { resolveAssetsDir } from '../src/core/util.ts'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

describe('resolveAssetsDir — 布局无关的 assets 解析', () => {
  it('从 src/core 布局解析到包根 assets', () => {
    const url = pathToFileURL(join(ROOT, 'src', 'core', 'util.ts')).href
    const dir = resolveAssetsDir(url)
    expect(existsSync(join(dir, 'prompts')), 'prompts 应存在: ' + dir).toBe(true)
    expect(existsSync(join(dir, 'skills'))).toBe(true)
    expect(existsSync(join(dir, 'presets'))).toBe(true)
  })

  it('从构建产物 lib/tools 布局同样解析到包根 assets（原 bug 所在）', () => {
    const url = pathToFileURL(join(ROOT, 'lib', 'tools', 'skill.js')).href
    const dir = resolveAssetsDir(url)
    expect(existsSync(join(dir, 'prompts')), 'lib 布局解析失败: ' + dir).toBe(true)
  })

  it('从包根（打包产物）布局解析到 assets', () => {
    const url = pathToFileURL(join(ROOT, 'lib', 'client.js')).href
    expect(existsSync(resolveAssetsDir(url))).toBe(true)
  })

  it('两种布局解析到同一目录（缓存按模块目录隔离）', () => {
    const a = resolveAssetsDir(pathToFileURL(join(ROOT, 'src', 'tools', 'index.ts')).href)
    const b = resolveAssetsDir(pathToFileURL(join(ROOT, 'lib', 'tools', 'index.js')).href)
    expect(a).toBe(b)
  })
})
