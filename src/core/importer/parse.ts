/**
 * dsh-novel-writer — 本地书籍文件导入解析器（P3 导入模块）。
 *
 * 纯函数：txt/md 文本 → 结构化书籍（书名 / 题材 / 章节数组）。零 IO、零 cordis
 * 依赖，可全量单测。配套引擎见 engine.ts（BookImporter 负责建书 + 逐章写入）。
 *
 * 章节标题识别策略（面向网文导出文件实测格式）：
 *  - 严格标题：`第X章 标题`（带分隔符）、`第X章`（裸）、`楔子/序章/番外/…`、
 *    `Chapter N`（英文）；md 的 `# 标题` 行一律算标题。
 *  - 粘连标题：`第X章标题`（无分隔符）只在全文件出现 ≥3 处时才整体提升为标题
 *    （统计确认，避免把正文中"第二章我们终于见面了"这类句子误判）。
 *  - 无任何标题 → 数字行（`1、标题`）≥3 处则按数字行切分；否则按段落分块兜底
 *    （约 2500 字一章，保证正文完整同步）。
 *  - 正文行与标题行的区分：分隔符仅限 空格/全角空格/冒号/顿号/点/破折号/·，
 *    不含逗号（正文"第三章，我们走了"不会误判）；粘连候选行须 ≤40 字且不以句末
 *    标点结尾。
 *
 * 书名来源优先级：md frontmatter `title:` → 首行书名启发式（首行短且下一非空行
 * 是标题）→ 文件名去扩展名。
 */
import type { PluginError } from '../types.ts'
import { genreIdFromLabel, isGenreId } from '../genres.ts'

export interface ParsedChapter {
  title: string
  content: string
}

export interface ParsedBook {
  title: string
  genre: string
  chapters: ParsedChapter[]
}

// ── 标题正则 ──────────────────────────────────────────────────────────────

const NUM = '(?:\\d{1,4}|[零〇一二三四五六七八九十百千万两]+)'
const UNIT = '[章节回卷部篇集]'
const SPEC_WORDS = '(楔子|序章|序言|引子|前言|后记|尾声|番外|外传|终章|最终章|大结局)'
/** 标题与正文的分隔符（不含逗号：正文"第三章，…"不误判）。 */
const SEP = '[ \\u3000:：、.．·\\-—]'

const CN_SEP = new RegExp(`^第\\s*${NUM}\\s*${UNIT}${SEP}+(.+)$`)
const CN_BARE = new RegExp(`^第\\s*${NUM}\\s*${UNIT}$`)
// 粘连标题：后缀首字符不得为标点（"第三章，我们走了" 是正文，不是标题）
const CN_GLUED = new RegExp(`^第\\s*${NUM}\\s*${UNIT}([^，,。．.！？!?；;：:\\s].*)$`)
const SPEC_SEP = new RegExp(`^${SPEC_WORDS}${SEP}+(.+)$`)
const SPEC_BARE = new RegExp(`^${SPEC_WORDS}$`)
const SPEC_GLUED = new RegExp(`^${SPEC_WORDS}([^，,。．.！？!?；;：:\\s].*)$`)
const EN_BARE = /^chapter\s+\d{1,4}[.．]?\s*$/i
const EN_SEP = /^chapter\s+\d{1,4}\s*[:：.\-—·]\s*(.+)$/i
const NUM_HEADING = new RegExp(`^(${NUM})\\s*[、.．:：]\\s*(.+)$`)
const MD_HEADING = /^#{1,6}\s+/
const SENTENCE_END = /[。！？!?；;]$/

const MAX_GLUED_LEN = 40
const MAX_SPEC_GLUED_LEN = 20
const MAX_NUMERIC_LEN = 30

/** 数字行兜底：要求 ≥3 处才启用；排除 "12.5 万" 这类（分隔符后紧跟数字）。 */
function isNumericHeading(line: string): boolean {
  if (line.length > MAX_NUMERIC_LEN) return false
  const match = NUM_HEADING.exec(line)
  if (!match) return false
  return !/^\d/.test(match[2] ?? '')
}

type Line =
  | { kind: 'heading'; title: string; raw: string }
  | { kind: 'glued'; title: string; raw: string }
  | { kind: 'numeric'; title: string; raw: string }
  | { kind: 'body'; text: string }

/** md 行：去 # 前缀与可选加粗记号后提取内嵌标题。 */
function mdInnerTitle(trimmed: string): string {
  return trimmed
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*?/, '')
    .replace(/\*\*?$/, '')
    .trim()
}

/** 从已去 # 的文本提取干净的章节标题（用于 md 标题行）。 */
function extractInnerTitle(text: string): string {
  const value = text.trim()
  const cnSep = CN_SEP.exec(value)
  if (cnSep) return cnSep[1]!.trim()
  if (CN_BARE.test(value)) return value
  const specSep = SPEC_SEP.exec(value)
  if (specSep) return specSep[2]!.trim()
  if (SPEC_BARE.test(value)) return value
  const enSep = EN_SEP.exec(value)
  if (enSep) return enSep[1]!.trim()
  if (EN_BARE.test(value)) return value
  return value
}

/** 分类一行（trimmed）。glued/numeric 是否最终提升由 parseBookFile 统计决定。 */
function classify(trimmed: string): Line {
  if (trimmed.length === 0) return { kind: 'body', text: '' }
  if (MD_HEADING.test(trimmed)) {
    const inner = mdInnerTitle(trimmed)
    return { kind: 'heading', title: extractInnerTitle(inner), raw: trimmed }
  }
  const cnSep = CN_SEP.exec(trimmed)
  if (cnSep) return { kind: 'heading', title: cnSep[1]!.trim(), raw: trimmed }
  if (CN_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const specSep = SPEC_SEP.exec(trimmed)
  if (specSep) return { kind: 'heading', title: specSep[2]!.trim(), raw: trimmed }
  if (SPEC_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const enSep = EN_SEP.exec(trimmed)
  if (enSep && trimmed.length <= 60) return { kind: 'heading', title: enSep[1]!.trim(), raw: trimmed }
  if (EN_BARE.test(trimmed)) return { kind: 'heading', title: trimmed, raw: trimmed }
  const cnGlued = CN_GLUED.exec(trimmed)
  if (cnGlued && trimmed.length <= MAX_GLUED_LEN && !SENTENCE_END.test(trimmed)) {
    return { kind: 'glued', title: cnGlued[1]!.trim(), raw: trimmed }
  }
  const specGlued = SPEC_GLUED.exec(trimmed)
  if (specGlued && trimmed.length <= MAX_SPEC_GLUED_LEN && !SENTENCE_END.test(trimmed)) {
    return { kind: 'glued', title: specGlued[1]!.trim(), raw: trimmed }
  }
  if (isNumericHeading(trimmed)) return { kind: 'numeric', title: NUM_HEADING.exec(trimmed)![2]!.trim(), raw: trimmed }
  return { kind: 'body', text: trimmed }
}

/** 是否"明显是标题行"（严格模式，用于首行书名启发式）。 */
function looksLikeHeading(trimmed: string): boolean {
  if (trimmed.length === 0) return false
  return MD_HEADING.test(trimmed)
    || CN_SEP.test(trimmed) || CN_BARE.test(trimmed)
    || SPEC_SEP.test(trimmed) || SPEC_BARE.test(trimmed)
    || EN_SEP.test(trimmed) || EN_BARE.test(trimmed)
    || isNumericHeading(trimmed)
}

/** 章节正文装配：去首尾空行、压缩 3+ 连续空行为 1 个空行。 */
function assemble(lines: string[]): string {
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{3,}/g, '\n\n')
}

/** 无标题文件的段落分块兜底：单段超长先按句号切，再按 ~targetChars 聚块。 */
export function chunkParagraphs(text: string, targetChars = 2500): ParsedChapter[] {
  const pieces: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    if (trimmed.length > targetChars * 2) {
      // 长段落按句号切（保留标点），避免单章过大
      let current = ''
      for (const sentence of trimmed.split(/(?<=[。！？!?])/)) {
        if (!sentence) continue
        if (current && current.length + sentence.length > targetChars) {
          pieces.push(current)
          current = sentence
        } else {
          current += sentence
        }
      }
      if (current) pieces.push(current)
    } else {
      pieces.push(trimmed)
    }
  }
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > targetChars) {
      chunks.push(current)
      current = piece
    } else {
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) chunks.push(current)
  return chunks.map((content, index) => ({ title: `第 ${index + 1} 节`, content }))
}

/** md frontmatter（`---` 块：title / genre）。非 frontmatter 开头返回 null。 */
function tryParseFrontmatter(text: string): { title?: string; genre?: string; body: string } | null {
  if (!text.startsWith('---\n')) return null
  const rest = text.slice(4)
  const close = /^---[ \t]*$/m.exec(rest)
  if (!close) return null
  const block = rest.slice(0, close.index)
  const body = rest.slice(close.index + close[0].length).replace(/^\n/, '')
  const pick = (key: string): string | undefined => {
    const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(block)
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
    return value || undefined
  }
  return { title: pick('title'), genre: pick('genre'), body }
}

/** 文件名 → 书名（去目录、去扩展名）。 */
function stem(fileName: string): string {
  const base = String(fileName ?? '').split(/[\\/]/).at(-1) ?? ''
  const cleaned = base.replace(/\.[^.]+$/, '').trim()
  return cleaned || '未命名书籍'
}

/** 题材归一化（frontmatter genre / 中文标签 / 常见变体 → 内置题材 id；未知回退 fantasy）。 */
export function mapGenre(raw: string): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'fantasy'
  // 已是合法题材 id → 直通
  if (isGenreId(value)) return value
  // 中文标签（如「玄幻」「仙侠」）→ id
  const fromLabel = genreIdFromLabel(value)
  if (fromLabel) return fromLabel
  // 常见变体别名（兼容旧版映射 + 网文口语）
  const aliases: Record<string, string> = {
    '奇幻': 'fantasy', '魔法': 'western', '西幻': 'western',
    '修真': 'xianxia', '修仙': 'xianxia',
    '现代': 'urban', '都市言情': 'romance',
    '现实': 'realistic', '生活': 'realistic',
    '古代': 'history', '穿越古代': 'history', '古言': 'ancient-romance',
    '未来': 'scifi', '星际': 'scifi', '末世': 'apocalypse', '末日': 'apocalypse', '废土': 'apocalypse',
    '推理': 'mystery', '恐怖': 'horror', '惊悚': 'horror',
    '网游': 'game', '电竞': 'sports', '竞技': 'sports',
    '校园': 'campus', '职场': 'business', '商战': 'business', '权谋': 'strategy',
    '同人': 'fanfiction', '动漫同人': 'anime',
    '洪荒': 'honghuang', '种田': 'farming', '系统': 'system', '无限流': 'infinite', '诸天': 'multiverse',
  }
  return aliases[value] ?? 'fantasy'
}

/** 解析书籍文件（txt / md）。失败抛 PluginError（IMPORT_FILE_EMPTY / NO_IMPORTABLE_ENTRIES）。 */
export function parseBookFile(fileName: string, content: string): ParsedBook {
  let text = String(content ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) {
    throw { code: 'IMPORT_FILE_EMPTY', message: '文件内容为空' } as PluginError
  }

  // md frontmatter
  let metaTitle: string | undefined
  let metaGenre: string | undefined
  const fm = tryParseFrontmatter(text)
  if (fm) {
    metaTitle = fm.title
    metaGenre = fm.genre
    text = fm.body
  }

  // 分类所有行
  const lines: Line[] = text.split('\n').map((line) => classify(line.trim()))

  // 统计与提升：粘连标题 ≥3 处才提升；无严格标题时数字行 ≥3 处才启用
  const strictCount = lines.filter((line) => line.kind === 'heading').length
  const gluedCount = lines.filter((line) => line.kind === 'glued').length
  const gluePromoted = gluedCount >= 3
  const numericCount = lines.filter((line) => line.kind === 'numeric').length
  const numericPromoted = strictCount === 0 && !gluePromoted && numericCount >= 3
  const isHeading = (line: Line): line is Extract<Line, { kind: 'heading' } | { kind: 'glued' } | { kind: 'numeric' }> =>
    line.kind === 'heading'
    || (line.kind === 'glued' && gluePromoted)
    || (line.kind === 'numeric' && numericPromoted)

  // 切分章节
  const chapters: Array<{ title: string; lines: string[] }> = []
  const preamble: string[] = []
  for (const line of lines) {
    if (isHeading(line)) {
      chapters.push({ title: line.title, lines: [] })
    } else {
      // 未提升的 glued/numeric 候选行必须保留原始文本（否则正文数据丢失）
      const text = line.kind === 'body' ? line.text : String((line as Extract<Line, { kind: 'glued' | 'numeric' }>).raw ?? '')
      if (chapters.length === 0) {
        preamble.push(text)
      } else {
        const last = chapters[chapters.length - 1]!
        last.lines.push(text)
      }
    }
  }

  // 无任何标题 → 段落分块兜底（完整保留正文）
  if (chapters.length === 0) {
    const chunks = chunkParagraphs(text)
    if (chunks.length === 0) {
      throw { code: 'NO_IMPORTABLE_ENTRIES', message: '未能识别到章节内容' } as PluginError
    }
    return {
      title: metaTitle ?? '未命名书籍',
      genre: mapGenre(metaGenre ?? ''),
      chapters: chunks,
    }
  }

  // 前置内容（首个标题前）：≥100 字 → 楔子章；否则并入第一章（保留内容）
  const built: ParsedChapter[] = []
  const preambleText = assemble(preamble)
  if (preambleText.trim()) {
    if (preambleText.length >= 100) {
      built.push({ title: '楔子', content: preambleText })
    } else {
      chapters[0]!.lines.unshift(preambleText)
    }
  }
  for (const chapter of chapters) {
    built.push({ title: chapter.title, content: assemble(chapter.lines) })
  }
  // 末尾空章节（文件尾部悬空的"第N章"行）剔除
  while (built.length > 0 && !built[built.length - 1]!.content.trim()) {
    built.pop()
  }
  if (built.length === 0) {
    throw { code: 'NO_IMPORTABLE_ENTRIES', message: '未能识别到章节内容' } as PluginError
  }

  // 书名：frontmatter → 首行启发式 → 文件名
  let title = metaTitle ?? ''
  if (!title) {
    const rawLines = text.split('\n')
    const first = rawLines.find((line) => line.trim().length > 0)?.trim()
    const second = rawLines.filter((line) => line.trim().length > 0)[1]?.trim() ?? ''
    if (first && first.length <= 40 && !SENTENCE_END.test(first) && !looksLikeHeading(first) && looksLikeHeading(second)) {
      title = first
    }
  }
  title = title || stem(fileName)

  return { title, genre: mapGenre(metaGenre ?? ''), chapters: built }
}
