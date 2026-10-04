/**
 * dsh-novel-writer — 核心纯函数工具（模块 1 配套）。
 *
 * 职责：无状态、无 IO 的通用工具；所有函数可独立单测。
 * 命名/语义对齐夏瑾工坊原实现（splitKeywords / generateId），便于移植对照。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** 生成稳定唯一 id（夏瑾 generateId 语义：`<prefix>_<ts36>_<rand6>`）。 */
export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/** 当前 ISO 时间戳（存储层统一使用，保证可排序、可比较）。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 关键词规范化：按中英文逗号切分、去空白、去空项（夏瑾 splitKeywords 语义）。
 * 不去重（保留作者顺序；去重由调用方按需处理）。
 */
export function normalizeKeywords(raw: string | readonly string[] | undefined | null): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
  }
  return String(raw)
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
}

/** 数值归一化：非法/NaN 回退到 fallback（夏瑾 normalizeNumber 语义）。 */
export function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

/** 整数夹取（用于 priority/scan_depth/insertion_depth 等非负整数字段）。 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** 估算文本 token 数：中文近似 1 token/字（按 CJK 计），非 CJK 按 4 字符/token。 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 解析随包分发的 `assets/` 目录。
 *
 * 两种运行布局下的模块位置不同，必须都支持：
 *  - 源码/测试（vitest 直跑 TS）：`<root>/src/<dir>/x.ts` → `assets` 在 `../../assets`
 *  - 构建产物（tsc → lib/）：`<root>/lib/<dir>/x.js` → `assets` 在 `../../assets`
 *  - Rspack 打包（import.meta.url 被重写为 `<root>/lib/client.js` 之类）→ `../assets`
 *
 * 之前固定用 `'..','assets'`（只对打包布局成立），导致构建产物里提示词库、
 * 技能、预设、示例书籍全部解析到不存在的 `lib/assets/**` 而静默降级为空。
 * 这里按「候选路径 + 目录存在性」解析，并缓存结果。
 */
export function resolveAssetsDir(fromModuleUrl: string): string {
  const here = fileURLToPath(new URL('.', fromModuleUrl))
  const cached = assetsDirCache.get(here)
  if (cached !== undefined) return cached

  for (const candidate of ['../../assets', '../assets', './assets']) {
    const dir = resolve(here, candidate)
    if (existsSync(dir)) {
      assetsDirCache.set(here, dir)
      return dir
    }
  }
  // 都没命中时回退到「上两级」布局，让调用方拿到一个可诊断的路径
  const fallback = resolve(here, '../../assets')
  assetsDirCache.set(here, fallback)
  return fallback
}

/** 解析缓存（按模块目录）。 */
const assetsDirCache = new Map<string, string>()
