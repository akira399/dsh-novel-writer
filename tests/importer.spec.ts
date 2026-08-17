import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookImporter, chunkParagraphs, mapGenre, parseBookFile } from '../src/core/importer/index.ts'
import { NovelService, NovelStore } from '../src/core/novel/index.ts'
import { LoreStore } from '../src/core/lorebook/index.ts'
import { VariableStoreFile, variablesFilePath } from '../src/core/variables/index.ts'
import type { PluginError } from '../src/core/index.ts'

// ── 纯解析器 ──────────────────────────────────────────────────────────────

describe('importer/parse — 中文章节识别', () => {
  it('识别「第一章 标题」带分隔符', () => {
    const book = parseBookFile('test.txt', '第一章 穿越\n正文一。\n\n第二章 修行\n正文二。')
    expect(book.title).toBe('test')
    expect(book.chapters).toEqual([
      { title: '穿越', content: '正文一。' },
      { title: '修行', content: '正文二。' },
    ])
  })

  it('识别 第1章 / 第 12 章 / 第001章 / 第一百零二章', () => {
    const text = [
      '第1章 开局\n一。',
      '第 12 章 中局\n二。',
      '第001章 终局\n三。',
      '第一百零二章 大结局\n四。',
    ].join('\n')
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.map((c) => c.title)).toEqual(['开局', '中局', '终局', '大结局'])
    expect(book.chapters[3]?.content).toBe('四。')
  })

  it('识别裸标题「第2章」', () => {
    const book = parseBookFile('x.txt', '第1章 一\n内容。\n第2章\n内容二。')
    expect(book.chapters[1]?.title).toBe('第2章')
    expect(book.chapters[1]?.content).toBe('内容二。')
  })

  it('粘连标题「第X章标题」≥3 处整体提升', () => {
    const text = ['第一章风起\n甲。', '第二章云涌\n乙。', '第三章雷动\n丙。', '第四章雨落\n丁。'].join('\n')
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.map((c) => c.title)).toEqual(['风起', '云涌', '雷动', '雨落'])
  })

  it('粘连 <3 处不提升（正文"第二章我们终于见面了。"不误判）', () => {
    const text = '这是一段正文。\n第二章我们终于见面了。\n然后继续讲下去。\n第三章我们出发吧！\n最后一段。'
    const book = parseBookFile('x.txt', text)
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('第二章我们终于见面了。')
    expect(book.chapters[0]?.content).toContain('第三章我们出发吧！')
  })

  it('特殊章节：楔子 / 序章 / 番外', () => {
    const text = '楔子\n天地初开。\n\n第一章 入宗\n正文。\n\n番外 前尘\n往事。'
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.map((c) => c.title)).toEqual(['楔子', '入宗', '前尘'])
  })

  it('正文行以逗号接「第X章」不误判（分隔符不含逗号）', () => {
    const book = parseBookFile('x.txt', '第三章，我们走了。\n后面没有别的了。')
    expect(book.chapters).toHaveLength(1)
  })

  it('粘连候选未提升时正文完整保留（回归：曾推空串丢正文）', () => {
    // 2 处粘连候选（<3 不提升）+ 正常段落：整文件应为 1 章且正文无损
    const text = '第一章剑指苍穹\n甲。\n第二章云涌\n乙。\n然后有一段普通叙述。'
    const book = parseBookFile('x.txt', text)
    expect(book.chapters).toHaveLength(1)
    const content = book.chapters[0]!.content
    expect(content).toContain('第一章剑指苍穹')
    expect(content).toContain('第二章云涌')
    expect(content).toContain('甲。')
    expect(content).toContain('乙。')
    expect(content).toContain('然后有一段普通叙述。')
  })
})

describe('importer/parse — md 与英文', () => {
  it('md frontmatter 书名+题材 + `# 第1章` 标题', () => {
    const text = '---\ntitle: 星海征途\ngenre: 科幻\n---\n\n# 第1章 启航\n正文。\n\n## 第2章 跃迁\n正文二。'
    const book = parseBookFile('x.md', text)
    expect(book.title).toBe('星海征途')
    expect(book.genre).toBe('scifi')
    expect(book.chapters.map((c) => c.title)).toEqual(['启航', '跃迁'])
  })

  it('md 非章节标题（如 ## 人物设定）也作为章节保留', () => {
    const book = parseBookFile('x.md', '# 人物设定\n林远，炼气七层。\n\n# 第一章 拜师\n正文。')
    expect(book.chapters.map((c) => c.title)).toEqual(['人物设定', '拜师'])
  })

  it('英文 Chapter 标题', () => {
    const text = 'Chapter 1\nOnce upon a time.\n\nChapter 2: The Journey\nMore text.'
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'The Journey'])
  })
})

describe('importer/parse — 书名与前置内容', () => {
  it('文件名去扩展名作为书名', () => {
    const book = parseBookFile('我的小说.txt', '第一章 起点\n正文。')
    expect(book.title).toBe('我的小说')
  })

  it('首行书名启发式：首行短 + 下一非空行是标题', () => {
    const book = parseBookFile('x.txt', '青云问道\n\n第一章 穿越\n正文。')
    expect(book.title).toBe('青云问道')
  })

  it('前置内容 ≥100 字 → 楔子章', () => {
    const intro = '这是一个很长很长的内容简介，'.repeat(10)
    const book = parseBookFile('x.txt', `${intro}\n\n第一章 穿越\n正文。`)
    expect(book.chapters[0]?.title).toBe('楔子')
    expect(book.chapters[0]?.content).toContain('内容简介')
    expect(book.chapters).toHaveLength(2)
  })

  it('前置内容 <100 字并入第一章', () => {
    const book = parseBookFile('x.txt', '引子很短。\n\n第一章 穿越\n正文。')
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('引子很短。')
    expect(book.chapters[0]?.content).toContain('正文。')
  })
})

describe('importer/parse — 兜底与边界', () => {
  it('无标题 → 段落分块（多章）', () => {
    const para = '这是第%N%段正文，内容足够长以触发分块阈值，每一段都反复展开场景描写与人物心理活动，凑足字数，确保解析器按段落边界切成多章。'
    const text = Array.from({ length: 80 }, (_, i) => para.replace('%N%', String(i + 1))).join('\n\n')
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.length).toBeGreaterThan(1)
    expect(book.chapters[0]?.title).toBe('第 1 节')
    const joined = book.chapters.map((c) => c.content).join('')
    expect(joined).toContain('第1段正文')
    expect(joined).toContain('第80段正文')
  })

  it('无标题且单段超长 → 按句号切分多章', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `第${i + 1}句话内容。`).join('')
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.length).toBeGreaterThan(1)
    const joined = book.chapters.map((c) => c.content).join('')
    expect(joined).toContain('第1200句话内容。')
  })

  it('数字行兜底（1、标题 风格）≥3 处', () => {
    const text = ['1、初入江湖\n甲。', '2、拜师学艺\n乙。', '3、下山历练\n丙。'].join('\n')
    const book = parseBookFile('x.txt', text)
    expect(book.chapters.map((c) => c.title)).toEqual(['初入江湖', '拜师学艺', '下山历练'])
  })

  it('数字行 <3 处不启用（"12.5 万人在看"不误判）', () => {
    const text = '12.5 万人在看这一章。\n第二天 2.3 万。'
    const book = parseBookFile('x.txt', text)
    expect(book.chapters).toHaveLength(1)
  })

  it('末尾悬空标题行剔除', () => {
    const book = parseBookFile('x.txt', '第一章 一\n正文。\n\n第二章 二\n')
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.title).toBe('一')
  })

  it('BOM 与 CRLF 归一化', () => {
    const book = parseBookFile('x.txt', '\uFEFF第一章 一\r\n正文。\r\n\r\n第二章 二\r\n正文二。')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[1]?.content).toBe('正文二。')
  })

  it('空内容 → IMPORT_FILE_EMPTY', () => {
    let error: PluginError | undefined
    try {
      parseBookFile('x.txt', '   \n\t')
    } catch (cause) {
      error = cause as PluginError
    }
    expect(error?.code).toBe('IMPORT_FILE_EMPTY')
  })

  it('无任何可识别内容 → NO_IMPORTABLE_ENTRIES', () => {
    let error: PluginError | undefined
    try {
      parseBookFile('x.txt', '')
    } catch (cause) {
      error = cause as PluginError
    }
    expect(error?.code).toBe('IMPORT_FILE_EMPTY')
  })

  it('mapGenre 别名映射', () => {
    expect(mapGenre('仙侠')).toBe('xianxia')
    expect(mapGenre('玄幻')).toBe('fantasy')
    expect(mapGenre('SCIFI')).toBe('scifi')
    expect(mapGenre('未知')).toBe('fantasy')
    expect(mapGenre('')).toBe('fantasy')
  })

  it('chunkParagraphs 空输入返回空数组', () => {
    expect(chunkParagraphs('  \n\n ')).toEqual([])
  })
})

// ── 引擎（真实 store 集成） ────────────────────────────────────────────────

const roots: string[] = []
async function freshService(): Promise<NovelService> {
  const dir = await mkdtemp(join(tmpdir(), 'importer-'))
  roots.push(dir)
  const store = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const variables = new VariableStoreFile(variablesFilePath(join(dir, 'vars')))
  return new NovelService({ store, loreStore, variables })
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('BookImporter — 全链路', () => {
  it('解析→建书→逐章写入，完整同步章节与正文', async () => {
    const service = await freshService()
    const parsed = parseBookFile('青云问道.txt', '第一章 穿越\n正文一。\n\n第二章 修行\n正文二。')
    const importer = new BookImporter({
      createProject: (t, g) => service.createProject(t, g),
      saveChapter: (id, no, t, text) => service.saveChapter(id, no, t, text),
    })
    const result = await importer.importParsed(parsed)
    expect(result.title).toBe('青云问道')
    expect(result.chapterCount).toBe(2)
    expect(result.totalWords).toBeGreaterThan(0)

    const chapters = await service.allChapters(result.bookId)
    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.chapter.title).toBe('穿越')
    expect(chapters[0]?.content).toBe('正文一。')
    expect(chapters[1]?.chapter.title).toBe('修行')
    expect(chapters[1]?.content).toBe('正文二。')
    // 项目统计与审计已联动
    const book = await service.load(result.bookId)
    expect(book.stats.chapterCount).toBe(2)
    expect(book.stats.totalWords).toBe(result.totalWords)
    expect((await service.audit(result.bookId)).filter((e) => e.phase === 'writing')).toHaveLength(2)
  })

  it('空章节数组 → NO_IMPORTABLE_ENTRIES', async () => {
    const importer = new BookImporter({
      createProject: async () => ({ id: 'bk_x' }),
      saveChapter: async () => ({ words: 0 }),
    })
    let error: PluginError | undefined
    try {
      await importer.importParsed({ title: 'x', genre: 'fantasy', chapters: [] })
    } catch (cause) {
      error = cause as PluginError
    }
    expect(error?.code).toBe('NO_IMPORTABLE_ENTRIES')
  })

  it('fake deps：章节编号顺序 1..N，字数累计', async () => {
    const calls: Array<[string, number, string, string]> = []
    const importer = new BookImporter({
      createProject: async (title, genre) => ({ id: `bk_${title}_${genre}` }),
      saveChapter: async (id, no, title, text) => {
        calls.push([id, no, title, text])
        return { words: text.length }
      },
    })
    const result = await importer.importParsed({
      title: '测试书',
      genre: 'urban',
      chapters: [
        { title: '一', content: 'aaaa' },
        { title: '二', content: 'bbbbbb' },
        { title: '', content: '  ' },
      ],
    })
    expect(calls.map((c) => c[1])).toEqual([1, 2, 3])
    expect(calls[0]?.[2]).toBe('一')
    expect(calls[2]?.[2]).toBe('第 3 章')
    expect(result.totalWords).toBe(12)
    expect(result.emptyChapters).toBe(1)
  })
})
