/**
 * dsh-novel-writer — 书籍题材（genre）统一清单（P3 题材扩充）。
 *
 * 网文全类型题材枚举：id 为持久化值（英文小写），label 为中文显示名，
 * group 为客户端下拉分组。host 与 client 共用（纯常量 + 纯函数，零依赖）。
 * 已有书籍的 genre 值不受影响（旧 id 全部保留在清单内）。
 */

export interface GenreOption {
  id: string
  label: string
  group: string
}

export const GENRES: GenreOption[] = [
  // 奇幻武侠
  { id: 'fantasy', label: '玄幻', group: '奇幻武侠' },
  { id: 'xianxia', label: '仙侠', group: '奇幻武侠' },
  { id: 'wuxia', label: '武侠', group: '奇幻武侠' },
  { id: 'western', label: '西幻', group: '奇幻武侠' },
  // 都市现实
  { id: 'urban', label: '都市', group: '都市现实' },
  { id: 'realistic', label: '现实生活', group: '都市现实' },
  { id: 'campus', label: '青春校园', group: '都市现实' },
  { id: 'business', label: '商战职场', group: '都市现实' },
  { id: 'strategy', label: '权谋智斗', group: '都市现实' },
  // 历史军事
  { id: 'history', label: '历史架空', group: '历史军事' },
  { id: 'military', label: '军事战争', group: '历史军事' },
  // 科幻灵异
  { id: 'scifi', label: '科幻', group: '科幻灵异' },
  { id: 'mystery', label: '悬疑推理', group: '科幻灵异' },
  { id: 'horror', label: '灵异惊悚', group: '科幻灵异' },
  { id: 'apocalypse', label: '末世危机', group: '科幻灵异' },
  // 情感
  { id: 'romance', label: '现代言情', group: '情感' },
  { id: 'ancient-romance', label: '古代言情', group: '情感' },
  // 竞技
  { id: 'game', label: '游戏', group: '竞技' },
  { id: 'sports', label: '体育竞技', group: '竞技' },
  // 轻小说二次元
  { id: 'light-novel', label: '轻小说', group: '轻小说二次元' },
  { id: 'anime', label: '二次元', group: '轻小说二次元' },
  { id: 'fanfiction', label: '同人衍生', group: '轻小说二次元' },
  // 流派向
  { id: 'honghuang', label: '洪荒封神', group: '流派向' },
  { id: 'farming', label: '种田文', group: '流派向' },
  { id: 'system', label: '系统流', group: '流派向' },
  { id: 'infinite', label: '无限流', group: '流派向' },
  { id: 'multiverse', label: '诸天万界', group: '流派向' },
]

const GENRE_LABEL_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.label]))
const GENRE_ID_BY_LABEL = new Map(GENRES.map((genre) => [genre.label.toLowerCase(), genre.id]))

/** id → 中文标签（未知 id 原样返回，兼容旧数据）。 */
export function genreLabel(id: string): string {
  return GENRE_LABEL_BY_ID.get(String(id ?? '')) ?? String(id ?? '')
}

/** 中文标签 → id（大小写不敏感；非已知标签返回 undefined）。 */
export function genreIdFromLabel(label: string): string | undefined {
  return GENRE_ID_BY_LABEL.get(String(label ?? '').trim().toLowerCase())
}

/** 是否为合法题材 id。 */
export function isGenreId(id: string): boolean {
  return GENRE_LABEL_BY_ID.has(String(id ?? ''))
}
