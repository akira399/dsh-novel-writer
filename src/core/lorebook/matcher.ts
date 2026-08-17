/**
 * dsh-novel-writer — lorebook 匹配引擎（模块 4）。
 *
 * 职责：关键词/正则命中判定，带预编译缓存与倒排索引（修复夏瑾 P3/P4：
 * 正则每轮重建、全量线性匹配）。
 *  - 普通关键词：小写化 + 倒排索引（token → entryId 集合），命中判定用 includes；
 *  - 正则条目：预编译 RegExp 缓存（写时失效），非法正则容错（跳过该条目）；
 *  - 大小写敏感性按条目字段；
 *  - 本引擎只做「关键词命中」，常驻（always_active）与注入位置/预算由注入组装器（P1）处理。
 * 纯逻辑，无 IO；条目集由调用方（service/组装器）喂入。
 */
import type { LoreEntry } from '../types.ts'

/** 一次命中的结果（含命中的关键词/正则）。 */
export interface MatchHit {
  entry: LoreEntry
  /** 命中的普通关键词（正则命中时为 undefined）。 */
  hitKeyword?: string
  /** 命中方式。 */
  via: 'keyword' | 'regex'
}

export interface MatchOptions {
  /** 大小写敏感全局覆盖（条目自身字段优先）。 */
  caseSensitive?: boolean
  /** 只在这些条目 id 内匹配（调用方已按分组/项目过滤）。 */
  entryIds?: ReadonlySet<string>
}

export class LoreMatcher {
  /** 普通关键词倒排索引：小写 token → 条目 id 集合。 */
  private index = new Map<string, Set<string>>()
  /** 正则条目（id → entry）。 */
  private regexEntries = new Map<string, LoreEntry>()
  /** 预编译正则缓存（id → RegExp[]；null = 存在非法正则，该条目跳过）。 */
  private regexCache = new Map<string, RegExp[] | null>()
  /** 全部条目（id → entry），供命中回读。 */
  private byId = new Map<string, LoreEntry>()

  /** 全量重建（条目集变更后的粗粒度入口）。 */
  rebuild(entries: readonly LoreEntry[]): void {
    this.index.clear()
    this.regexEntries.clear()
    this.regexCache.clear()
    this.byId.clear()
    for (const entry of entries) {
      this.byId.set(entry.id, entry)
      if (!entry.enabled || entry.keywords.length === 0) continue
      if (entry.is_regex) {
        this.regexEntries.set(entry.id, entry)
        this.compileRegex(entry)
      } else {
        for (const keyword of entry.keywords) {
          const key = keyword.toLowerCase()
          const bucket = this.index.get(key)
          if (bucket) bucket.add(entry.id)
          else this.index.set(key, new Set([entry.id]))
        }
      }
    }
  }

  /** 单条目增量更新（写入/修改/删除后调用；O(条目关键词数)）。 */
  upsert(entry: LoreEntry): void {
    this.remove(entry.id)
    this.byId.set(entry.id, entry)
    if (!entry.enabled || entry.keywords.length === 0) return
    if (entry.is_regex) {
      this.regexEntries.set(entry.id, entry)
      this.compileRegex(entry)
    } else {
      for (const keyword of entry.keywords) {
        const key = keyword.toLowerCase()
        const bucket = this.index.get(key)
        if (bucket) bucket.add(entry.id)
        else this.index.set(key, new Set([entry.id]))
      }
    }
  }

  /** 删除条目（索引与缓存同步清理）。 */
  remove(entryId: string): void {
    this.byId.delete(entryId)
    this.regexEntries.delete(entryId)
    this.regexCache.delete(entryId)
    for (const bucket of this.index.values()) {
      bucket.delete(entryId)
    }
  }

  /** 命中判定：扫描文本，返回命中的条目（保持条目集顺序）。 */
  match(text: string, options: MatchOptions = {}): MatchHit[] {
    if (!text) return []
    const hits: MatchHit[] = []
    const seen = new Set<string>()
    const lowerText = text.toLowerCase()
    // 普通关键词：按索引 token 精确匹配文本片段
    for (const [token, entryIds] of this.index) {
      if (!lowerText.includes(token)) continue
      for (const entryId of entryIds) {
        if (seen.has(entryId)) continue
        if (options.entryIds && !options.entryIds.has(entryId)) continue
        const entry = this.byId.get(entryId)
        if (!entry) continue
        // 大小写敏感条目：原文必须包含任一原词（不能用小写 token 比对原文）
        const sensitive = entry.case_sensitive || options.caseSensitive
        const hitKeyword = entry.keywords.find((kw) =>
          sensitive ? text.includes(kw) : lowerText.includes(kw.toLowerCase()),
        )
        if (sensitive && hitKeyword === undefined) continue
        seen.add(entryId)
        hits.push({ entry, hitKeyword, via: 'keyword' })
      }
    }
    // 正则条目：预编译缓存逐个 test（任一正则命中即命中，对齐夏瑾语义）
    for (const [entryId, entry] of this.regexEntries) {
      if (seen.has(entryId)) continue
      if (options.entryIds && !options.entryIds.has(entryId)) continue
      const regexes = this.regexCache.get(entryId)
      if (!regexes) continue
      let matched = false
      for (const regex of regexes) {
        regex.lastIndex = 0
        if (regex.test(text)) {
          matched = true
          break
        }
      }
      if (matched) {
        seen.add(entryId)
        hits.push({ entry, via: 'regex' })
      }
    }
    return hits
  }

  /** 统计（调试/测试用）：索引规模。 */
  stats(): { keywordTokens: number; regexEntries: number; totalEntries: number } {
    return { keywordTokens: this.index.size, regexEntries: this.regexEntries.size, totalEntries: this.byId.size }
  }

  /** 预编译条目全部正则关键词；任一条非法 → 整条跳过（缓存 null）。 */
  private compileRegex(entry: LoreEntry): void {
    const compiled: RegExp[] = []
    for (const keyword of entry.keywords) {
      try {
        const flags = entry.case_sensitive ? 'g' : 'gi'
        compiled.push(new RegExp(keyword, flags))
      } catch {
        this.regexCache.set(entry.id, null)
        return
      }
    }
    this.regexCache.set(entry.id, compiled.length > 0 ? compiled : null)
  }
}
