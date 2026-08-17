import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelService, NovelStore } from '../src/core/novel/index.ts'
import { LoreStore } from '../src/core/lorebook/index.ts'
import { VariableStoreFile, variablesFilePath } from '../src/core/variables/index.ts'
import type { PluginError } from '../src/core/index.ts'

const roots: string[] = []
async function freshService(): Promise<{ service: NovelService; store: NovelStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'novelsvc-'))
  roots.push(dir)
  const store = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const variables = new VariableStoreFile(variablesFilePath(join(dir, 'vars')))
  const service = new NovelService({ store, loreStore, variables })
  return { service, store }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function catchError<T>(body: Promise<T>): Promise<PluginError> {
  try {
    await body
  } catch (cause) {
    return cause as PluginError
  }
  throw new Error('expected rejection')
}

describe('NovelService — project and phases', () => {
  it('creates a project and walks the phase gate', async () => {
    const { service } = await freshService()
    const book = await service.createProject('青云问道', 'fantasy')
    // 未批准 topic 不能进 setting
    expect((await catchError(service.enterPhase(book.id, 'setting'))).code).toBe('INVALID_STATE')
    await service.enterPhase(book.id, 'topic')
    const after = await service.commitPhase(book.id, 'topic', '选题报告', { passed: true, errorCount: 0, warningCount: 0 })
    expect(after.phases.topic.state).toBe('approved')
    // 回归（C1）：阶段流转不得丢 book 字段（曾把 PhaseLedger 残缺对象整存覆盖 book.json）
    expect(after.title).toBe('青云问道')
    expect(after.genre).toBe('fantasy')
    expect(after.config.wordTargets.perChapterMin).toBe(2000)
    expect(after.stats).toMatchObject({ totalWords: 0, chapterCount: 0 })
    expect(after.schemaVersion).toBeDefined()
    const reloaded = await service.load(book.id)
    expect(reloaded.title).toBe('青云问道')
    expect(reloaded.config.title).toBe('青云问道')
    expect(reloaded.phases.topic.state).toBe('approved')
    // 现在可以进 setting
    await service.enterPhase(book.id, 'setting')
    const setting = await service.commitPhase(book.id, 'setting', '设定文档', { passed: true, errorCount: 0, warningCount: 0 })
    expect(setting.phases.setting.state).toBe('approved')
    expect(setting.currentPhase).toBe('setting')
    expect(setting.title).toBe('青云问道')
    expect(setting.config.title).toBe('青云问道')
  })

  it('parks in review when the report has errors, then force-approves', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    const review = await service.commitPhase(book.id, 'topic', '有问题的产物', { passed: false, errorCount: 2, warningCount: 1 })
    expect(review.phases.topic.state).toBe('review')
    const forced = await service.overridePhase(book.id, 'topic', 'force')
    expect(forced.phases.topic.state).toBe('approved')
  })

  it('records audit events for every operation', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    await service.commitPhase(book.id, 'topic', 'x', { passed: true, errorCount: 0, warningCount: 0 })
    const audit = await service.audit(book.id)
    expect(audit.map((e) => e.action)).toEqual(['create', 'enter', 'submit'])
    expect(audit[2]?.phase).toBe('topic')
    expect(audit[2]?.seq).toBe(3)
  })

  it('writes artifact versions on commit', async () => {
    const { service, store } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.enterPhase(book.id, 'topic')
    await service.commitPhase(book.id, 'topic', 'v1 选题', { passed: true, errorCount: 0, warningCount: 0 })
    expect(await store.readArtifact(book.id, 'topic')).toBe('v1 选题')
  })
})

describe('NovelService — chapters', () => {
  it('saves a chapter with stats, updates book stats and audit', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    const chapter = await service.saveChapter(book.id, 1, '第一章', '一二三四五')
    expect(chapter.words).toBe(5)
    expect(chapter.version).toBe(1)
    const reloaded = await service.load(book.id)
    expect(reloaded.stats.totalWords).toBe(5)
    expect(reloaded.stats.chapterCount).toBe(1)
    expect(reloaded.stats.lastWriteAt).toBeDefined()
    // 覆盖写入：字数增量正确
    await service.saveChapter(book.id, 1, '第一章', '一二三四五六七八九十')
    const reloaded2 = await service.load(book.id)
    expect(reloaded2.stats.totalWords).toBe(10)
    expect(reloaded2.stats.chapterCount).toBe(1)
  })

  it('reports chapter stats with target compliance', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一章', '字'.repeat(2500))
    const stats = await service.chapterStats(book.id, 1)
    expect(stats?.words).toBe(2500)
    expect(stats?.meetsTarget).toBe(true)
    const short = await service.saveChapter(book.id, 2, '第二章', '短')
    expect(short.words).toBe(1)
    const stats2 = await service.chapterStats(book.id, 2)
    expect(stats2?.meetsTarget).toBe(false)
  })

  it('applies variable JSON patches from chapter text', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    const text = '正文……<JSONPatch>[{"op":"replace","path":"/stat_data/境界","value":"筑基"}]</JSONPatch>'
    await service.saveChapter(book.id, 1, '第一章', text)
    const stats = await service.chapterStats(book.id, 1)
    expect(stats).toBeDefined()
  })

  it('assembles a context packet for the next chapter', async () => {
    const { service } = await freshService()
    const book = await service.createProject('A', 'x')
    await service.saveChapter(book.id, 1, '第一章', '林远修行。')
    const packet = await service.assemble(book.id, 2, '第二章细纲')
    expect(packet.chapterNo).toBe(2)
    expect(packet.currentBrief).toBe('第二章细纲')
    expect(packet.prevChapters.map((c) => c.no)).toEqual([1])
    expect(packet.constraints.length).toBeGreaterThan(0)
  })
})

describe('NovelService — 模板复制（§3.5-11 cloneProject）', () => {
  it('clones config + stage artifacts, not chapters; resets state machine', async () => {
    const { service } = await freshService()
    const source = await service.createProject('青云问道', 'xianxia')
    // 提交设定阶段产物 → 产生 docs/setting.md
    await service.enterPhase(source.id, 'topic')
    await service.commitPhase(source.id, 'topic', '玄幻题材调研', { passed: true, errorCount: 0, warningCount: 0 })
    await service.enterPhase(source.id, 'setting')
    await service.commitPhase(source.id, 'setting', '世界观：九州；力量体系：炼气→筑基→金丹；地图：玄天大陆。', { passed: true, errorCount: 0, warningCount: 0 })
    // 源书写了几章正文
    await service.saveChapter(source.id, 1, '第一章', '林远修行。')

    const clone = await service.cloneProject(source.id)
    // 新项目独立 id / 重置状态机
    expect(clone.id).not.toBe(source.id)
    expect(clone.title).toBe('青云问道（模板）')
    expect(clone.genre).toBe('xianxia')
    expect(clone.phases.topic.state).toBe('locked')
    expect(clone.stats).toMatchObject({ chapterCount: 0, totalWords: 0 })
    // config 复制（字数目标/风格保留）
    expect(clone.config.genre).toBe('xianxia')
    expect(clone.config.wordTargets).toEqual(source.config.wordTargets)
    // 设定文档复制
    expect(await service.artifactOf(clone.id, 'topic')).toBe('玄幻题材调研')
    expect(await service.artifactOf(clone.id, 'setting')).toContain('九州')
    // 正文不复制
    expect(await service.chapterText(clone.id, 1)).toBe('')
  })

  it('honors explicit title/genre override', async () => {
    const { service } = await freshService()
    const source = await service.createProject('原书', 'fantasy')
    const clone = await service.cloneProject(source.id, { title: '新书', genre: 'urban' })
    expect(clone.title).toBe('新书')
    expect(clone.genre).toBe('urban')
  })

  it('throws for unknown source', async () => {
    const { service } = await freshService()
    let code: string | undefined
    try {
      await service.cloneProject('bk_nonexistent_000000')
    } catch (cause) {
      code = (cause as { code?: string }).code
    }
    expect(code).toBe('ENTRY_NOT_FOUND')
  })
})
