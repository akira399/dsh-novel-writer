import { describe, expect, it } from 'vitest'
import {
  GENRES,
  genreIdFromLabel,
  genreLabel,
  isGenreId,
} from '../src/core/genres.ts'
import { mapGenre } from '../src/core/importer/index.ts'

describe('genres — 清单完整性', () => {
  it('id 与 label 各自唯一', () => {
    const ids = GENRES.map((g) => g.id)
    const labels = GENRES.map((g) => g.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('覆盖网文全类型（关键题材齐全）', () => {
    const ids = new Set(GENRES.map((g) => g.id))
    for (const expected of [
      'fantasy', 'xianxia', 'wuxia', 'western', 'urban', 'realistic', 'campus', 'business', 'strategy',
      'history', 'military', 'scifi', 'mystery', 'horror', 'apocalypse',
      'romance', 'ancient-romance', 'game', 'sports',
      'light-novel', 'anime', 'fanfiction', 'honghuang', 'farming', 'system', 'infinite', 'multiverse',
    ]) {
      expect(ids.has(expected), `缺少题材 ${expected}`).toBe(true)
    }
    expect(GENRES.length).toBeGreaterThanOrEqual(27)
  })

  it('全部条目都有分组', () => {
    for (const g of GENRES) {
      expect(g.group.length).toBeGreaterThan(0)
    }
  })
})

describe('genres — 标签转换', () => {
  it('genreLabel：id → 中文；未知原样返回', () => {
    expect(genreLabel('fantasy')).toBe('玄幻')
    expect(genreLabel('infinite')).toBe('无限流')
    expect(genreLabel('legacy-unknown')).toBe('legacy-unknown')
    expect(genreLabel('')).toBe('')
  })

  it('genreIdFromLabel：中文 → id；未知返回 undefined', () => {
    expect(genreIdFromLabel('玄幻')).toBe('fantasy')
    expect(genreIdFromLabel('古代言情')).toBe('ancient-romance')
    expect(genreIdFromLabel('不存在的类型')).toBeUndefined()
    expect(genreIdFromLabel('')).toBeUndefined()
  })

  it('isGenreId：合法 id true，其他 false', () => {
    expect(isGenreId('scifi')).toBe(true)
    expect(isGenreId('SCI-FI')).toBe(false)
    expect(isGenreId('小说')).toBe(false)
  })
})

describe('mapGenre — 导入题材归一化', () => {
  it('全部内置 id 直通', () => {
    for (const g of GENRES) {
      expect(mapGenre(g.id)).toBe(g.id)
    }
  })

  it('全部中文标签映射到对应 id', () => {
    for (const g of GENRES) {
      expect(mapGenre(g.label), `${g.label} 应映射到 ${g.id}`).toBe(g.id)
    }
  })

  it('常见变体别名（含旧版兼容）', () => {
    expect(mapGenre('修真')).toBe('xianxia')
    expect(mapGenre('奇幻')).toBe('fantasy')
    expect(mapGenre('魔法')).toBe('western')
    expect(mapGenre('推理')).toBe('mystery')
    expect(mapGenre('末世')).toBe('apocalypse')
    expect(mapGenre('电竞')).toBe('sports')
    expect(mapGenre('同人')).toBe('fanfiction')
    expect(mapGenre('古言')).toBe('ancient-romance')
  })

  it('大小写不敏感 + 未知回退 fantasy', () => {
    expect(mapGenre('SCIFI')).toBe('scifi')
    expect(mapGenre('Fantasy')).toBe('fantasy')
    expect(mapGenre('未知类型')).toBe('fantasy')
    expect(mapGenre('')).toBe('fantasy')
  })
})
