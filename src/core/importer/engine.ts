/**
 * dsh-novel-writer — 书籍导入编排（P3 导入模块）。
 *
 * BookImporter：解析结果 → 建书 → 逐章写入（走 NovelService.saveChapter 完整管线：
 * 字数统计 / 账本 / 变量 / 审计）。IO 通过 ImportDeps 注入，可单测（fake 或真实 store）。
 */
import type { ParsedBook } from './parse.ts'

export interface ImportDeps {
  createProject(title: string, genre: string): Promise<{ id: string }>
  saveChapter(bookId: string, chapterNo: number, title: string, text: string): Promise<{ words: number }>
  /** 可选：导入中途失败时清理半成品项目（连同正文删除）。 */
  deleteProject?(bookId: string): Promise<unknown>
}

export interface ImportResult {
  bookId: string
  title: string
  genre: string
  chapterCount: number
  totalWords: number
  /** 内容为空的章节数（仍落盘占位，报告用）。 */
  emptyChapters: number
}

export class BookImporter {
  constructor(private readonly deps: ImportDeps) {}

  async importParsed(parsed: ParsedBook): Promise<ImportResult> {
    if (parsed.chapters.length === 0) {
      throw { code: 'NO_IMPORTABLE_ENTRIES', message: '未能识别到章节内容' } as never
    }
    const book = await this.deps.createProject(parsed.title || '未命名书籍', parsed.genre)
    try {
      let totalWords = 0
      let emptyChapters = 0
      for (let index = 0; index < parsed.chapters.length; index += 1) {
        const chapter = parsed.chapters[index]!
        const saved = await this.deps.saveChapter(book.id, index + 1, chapter.title || `第 ${index + 1} 章`, chapter.content)
        totalWords += saved.words
        if (!chapter.content.trim()) emptyChapters += 1
      }
      return {
        bookId: book.id,
        title: parsed.title,
        genre: parsed.genre,
        chapterCount: parsed.chapters.length,
        totalWords,
        emptyChapters,
      }
    } catch (error) {
      // 中途失败：清理半成品项目（避免留下只有部分章节的残缺书籍）
      await this.deps.deleteProject?.(book.id).catch(() => undefined)
      throw error
    }
  }
}
