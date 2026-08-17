import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextAssembler } from '../src/core/context/index.ts'
import { NovelStore } from '../src/core/novel/index.ts'
import { LoreStore } from '../src/core/lorebook/index.ts'
import { VariableStoreFile, variablesFilePath } from '../src/core/variables/index.ts'
import type { Book } from '../src/core/novel/index.ts'
import type { LoreEntry } from '../src/core/index.ts'

interface Fixture {
  assembler: ContextAssembler
  book: Book
}

const roots: string[] = []
async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'ctxasm-'))
  roots.push(dir)
  const store = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const book = await store.createBook({ title: '青云问道', genre: 'fantasy' })
  await store.writeArtifact(book.id, 'outline', '全书大纲：林远从外门弟子成长为剑仙。')
  await store.writeArtifact(book.id, 'volume', '第一卷：外门风云。')
  await store.writeArtifact(book.id, 'chapter', '第三章：林远突破筑基，遭遇赵无极挑衅。')
  for (let no = 1; no <= 4; no += 1) {
    await store.writeChapter(book.id, {
      no, title: `第${no}章`, status: 'draft', version: 1, words: 0, createdAt: 't', updatedAt: 't',
    }, `第${no}章正文：林远在青云宗修行。`)
  }
  await loreStore.writeEntries([
    {
      id: 'wb_1', name: '林远', content: '林远，炼气九层。', keywords: ['林远'], is_regex: false,
      case_sensitive: false, always_active: true, enabled: true, priority: 90, scan_depth: 0,
      inject_target: 'system', inject_position: 'append', insertion_depth: 0, book_id: '',
      tags: [], version: 1, created_at: 't', updated_at: 't',
    } satisfies LoreEntry,
  ])
  await loreStore.writeGroups([])
  const variables = new VariableStoreFile(variablesFilePath(store.getBookDir(book.id)))
  await variables.ensureBookVariables(book.id, { 境界: '炼气九层' })
  const assembler = new ContextAssembler({ store, loreStore, variables })
  return { assembler, book }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ContextAssembler — layering', () => {
  it('assembles L1/L2/L3 for the current chapter', async () => {
    const { assembler, book } = await fixture()
    const packet = await assembler.assemble({ book, chapterNo: 3 })
    expect(packet.projectBrief).toContain('青云问道')
    expect(packet.volumeOutline).toContain('外门风云')
    expect(packet.currentBrief).toContain('赵无极')
    expect(packet.prevChapters.map((c) => c.no)).toEqual([1, 2])
    expect(packet.loreInjection.append.map((e) => e.id)).toEqual(['wb_1'])
    expect(packet.variableSnapshot).toEqual({ 境界: '炼气九层' })
    expect(packet.constraints.some((c) => c.includes('2000'))).toBe(true)
    expect(packet.tokenEstimate).toBeGreaterThan(0)
    expect(packet.truncatedInfo).toEqual([])
  })

  it('prefers the externally provided chapter brief', async () => {
    const { assembler, book } = await fixture()
    const packet = await assembler.assemble({ book, chapterNo: 3, chapterBrief: '外部细纲：决战丹房。' })
    expect(packet.currentBrief).toBe('外部细纲：决战丹房。')
  })

  it('collects older-chapter summaries when beyond prevChaptersFull', async () => {
    const { assembler, book } = await fixture()
    // chapterNo=5，prevChaptersFull=0：1-4 章全部进入摘要层（升序）
    const packet = await assembler.assemble({ book, chapterNo: 5, prevChaptersFull: 0 })
    expect(packet.prevChapters).toEqual([])
    expect(packet.prevSummaries.map((s) => s.no)).toEqual([1, 2, 3, 4])
    expect(packet.prevSummaries[0]?.text.length).toBeLessThanOrEqual(200)
  })

  it('truncates under budget pressure: summaries first, then prev chapters', async () => {
    const { assembler, book } = await fixture()
    const packet = await assembler.assemble({ book, chapterNo: 5, contextBudget: 150 })
    expect(packet.truncatedInfo.length).toBeGreaterThan(0)
  })
})
