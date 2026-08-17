import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ForeshadowStore,
  GlossaryStore,
  IdeaStore,
} from '../src/core/auxiliary/index.ts'

const roots: string[] = []
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aux-'))
  roots.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('aux — foreshadow', () => {
  it('plants, reveals and drops with status transitions', async () => {
    const dir = await freshDir()
    const store = new ForeshadowStore(join(dir, 'foreshadow.json'))
    const planted = await store.plant({ content: '玉佩暗藏剑诀', plantChapter: 2, plannedRevealChapter: 20 })
    expect(planted.status).toBe('open')
    expect(planted.id).toMatch(/^fs_/)
    const revealed = await store.reveal(planted.id, 21)
    expect(revealed.status).toBe('revealed')
    expect(revealed.revealChapter).toBe(21)
    const dropped = await store.drop(planted.id)
    expect(dropped.status).toBe('dropped')
    expect(await store.all()).toHaveLength(1)
  })

  it('rejects empty content and missing ids', async () => {
    const dir = await freshDir()
    const store = new ForeshadowStore(join(dir, 'foreshadow.json'))
    await expect(store.plant({ content: '  ', plantChapter: 1 })).rejects.toMatchObject({ code: 'INVALID_FIELD_TYPE' })
    await expect(store.reveal('nope', 1)).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
  })

  it('detects overdue open foreshadows', () => {
    const list = [
      { id: 'a', content: 'x', plantChapter: 1, plannedRevealChapter: 10, status: 'open' as const, createdAt: 't', updatedAt: 't' },
      { id: 'b', content: 'y', plantChapter: 1, plannedRevealChapter: 30, status: 'open' as const, createdAt: 't', updatedAt: 't' },
      { id: 'c', content: 'z', plantChapter: 1, status: 'open' as const, createdAt: 't', updatedAt: 't' },
    ]
    const overdue = ForeshadowStore.overdue(list, 15)
    expect(overdue.map((f) => f.id)).toEqual(['a'])
  })
})

describe('aux — glossary', () => {
  it('adds unique terms and rejects duplicates', async () => {
    const dir = await freshDir()
    const store = new GlossaryStore(join(dir, 'glossary.json'))
    await store.add('青莲剑诀', '林家祖传剑法', '功法')
    await expect(store.add('青莲剑诀', '重复')).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(await store.all()).toHaveLength(1)
  })

  it('extracts quoted candidates from text', () => {
    const candidates = GlossaryStore.extractCandidates('他修炼《青莲剑诀》，踏入「青云宗」外门。')
    expect(candidates).toContain('青莲剑诀')
    expect(candidates).toContain('青云宗')
  })
})

describe('aux — ideas', () => {
  it('adds and searches ideas by keyword and tag', async () => {
    const dir = await freshDir()
    const store = new IdeaStore(join(dir, 'ideas.json'))
    await store.add('雨夜剑冢的设定', ['玄幻', '场景'])
    await store.add('主角失忆的桥段', ['剧情'])
    const byWord = await store.search('剑冢')
    expect(byWord).toHaveLength(1)
    const byTag = await store.search('剧情')
    expect(byTag).toHaveLength(1)
    expect((await store.all()).length).toBe(2)
  })

  it('lists newest first without query', async () => {
    const dir = await freshDir()
    const store = new IdeaStore(join(dir, 'ideas.json'))
    await store.add('第一')
    await store.add('第二')
    const list = await store.search()
    expect(list[0]?.content).toBe('第二')
  })
})
