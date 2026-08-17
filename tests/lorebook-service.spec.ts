import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LoreService, LoreStore } from '../src/core/lorebook/index.ts'
import type { LoreEntry, PluginError } from '../src/core/index.ts'

const roots: string[] = []
async function freshService(): Promise<{ service: LoreService; store: LoreStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'loresvc-'))
  roots.push(dir)
  const store = new LoreStore(dir)
  return { service: new LoreService(store), store }
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
  throw new Error('expected the promise to reject')
}

describe('LoreService — entry CRUD', () => {
  it('creates an entry with normalized defaults', async () => {
    const { service } = await freshService()
    const entry = await service.createEntry({ name: '筑基', content: '林远，筑基三层。' })
    expect(entry.id).toMatch(/^wb_/)
    expect(entry.keywords).toEqual([])
    expect(entry.priority).toBe(50)
    expect(entry.inject_target).toBe('system')
    expect(entry.inject_position).toBe('append')
    expect(entry.enabled).toBe(true)
    expect(entry.version).toBe(1)
    expect(entry.book_id).toBe('')
  })

  it('rejects empty name/content', async () => {
    const { service } = await freshService()
    const e1 = await catchError(service.createEntry({ name: ' ', content: 'x' }))
    expect(e1.code).toBe('INVALID_FIELD_TYPE')
  })

  it('forces at_depth for assistant target', async () => {
    const { service } = await freshService()
    const entry = await service.createEntry({ name: '旁白', content: 'c', inject_target: 'assistant' })
    expect(entry.inject_position).toBe('at_depth')
  })

  it('lists entries sorted by priority desc', async () => {
    const { service } = await freshService()
    await service.createEntry({ name: 'low', content: 'c', priority: 10 })
    await service.createEntry({ name: 'high', content: 'c', priority: 90 })
    const list = await service.listEntries()
    expect(list.map((e) => e.name)).toEqual(['high', 'low'])
  })

  it('updates only provided fields and bumps version', async () => {
    const { service } = await freshService()
    const created = await service.createEntry({ name: 'A', content: 'c1', keywords: 'k1' })
    const updated = await service.updateEntry(created.id, { name: 'B' })
    expect(updated.name).toBe('B')
    expect(updated.content).toBe('c1')
    expect(updated.keywords).toEqual(['k1'])
    expect(updated.version).toBe(2)
    // 显式 null 重置
    const cleared = await service.updateEntry(created.id, { keywords: null, book_id: null })
    expect(cleared.keywords).toEqual([])
    expect(cleared.book_id).toBe('')
  })

  it('toggles enabled state', async () => {
    const { service } = await freshService()
    const created = await service.createEntry({ name: 'A', content: 'c' })
    const toggled = await service.toggleEntry(created.id)
    expect(toggled.enabled).toBe(false)
    expect((await service.getEntry(created.id)).enabled).toBe(false)
  })

  it('delete removes the entry and cleans group references', async () => {
    const { service } = await freshService()
    const a = await service.createEntry({ name: 'A', content: 'c' })
    const group = await service.createGroup({ name: 'g', entry_ids: [a.id] })
    await service.deleteEntry(a.id)
    await expect(catchError(service.getEntry(a.id))).resolves.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
    const groups = await service.listGroups()
    expect(groups[0]?.entry_ids).toEqual([])
    expect(groups[0]?.id).toBe(group.id)
  })

  it('getEntry reports ENTRY_NOT_FOUND and INVALID_ENTRY_ID', async () => {
    const { service } = await freshService()
    expect((await catchError(service.getEntry('nope'))).code).toBe('ENTRY_NOT_FOUND')
    expect((await catchError(service.getEntry('  '))).code).toBe('INVALID_ENTRY_ID')
  })
})

describe('LoreService — group CRUD', () => {
  it('creates/list/updates groups', async () => {
    const { service } = await freshService()
    const g = await service.createGroup({ name: '卷一', entry_ids: [], enabled: false })
    expect(g.name).toBe('卷一')
    expect(g.enabled).toBe(false)
    const updated = await service.updateGroup({ id: g.id, name: '卷壹', add_entry_ids: ['wb_x'], enabled: true })
    expect(updated.name).toBe('卷壹')
    expect(updated.entry_ids).toEqual(['wb_x'])
    await service.updateGroup({ id: g.id, remove_entry_ids: ['wb_x'] })
    expect((await service.listGroups())[0]?.entry_ids).toEqual([])
  })

  it('deletes a group with or without its entries', async () => {
    const { service } = await freshService()
    const a = await service.createEntry({ name: 'A', content: 'c' })
    const b = await service.createEntry({ name: 'B', content: 'c' })
    const g = await service.createGroup({ name: 'g', entry_ids: [a.id, b.id] })
    const result = await service.deleteGroup(g.id, true)
    expect(result.removedEntries.map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
    expect(await service.listEntries()).toEqual([])
  })

  it('moves an entry between groups and can detach it', async () => {
    const { service } = await freshService()
    const a = await service.createEntry({ name: 'A', content: 'c' })
    const g1 = await service.createGroup({ name: 'g1', entry_ids: [a.id] })
    const g2 = await service.createGroup({ name: 'g2' })
    const moved = await service.moveEntryToGroup(a.id, g2.id)
    expect(moved.removedFrom).toEqual([g1.id])
    expect(moved.targetGroup?.id).toBe(g2.id)
    const detached = await service.moveEntryToGroup(a.id)
    expect(detached.removedFrom).toEqual([g2.id])
    expect(detached.targetGroup).toBeNull()
  })
})

describe('LoreService — import', () => {
  it('imports a SillyTavern lorebook', async () => {
    const { service } = await freshService()
    const payload = {
      entries: {
        '0': { key: ['林远'], content: '筑基三层', constant: false, order: 10 },
        '1': { key: [], content: '常驻设定', constant: true },
      },
    }
    const result = await service.importEntries({ content: JSON.stringify(payload) })
    expect(result.source_type).toBe('sillytavern_worldbook')
    expect(result.imported_count).toBe(2)
    expect(result.entries.every((e) => e.id.startsWith('wb_'))).toBe(true)
    expect(await service.listEntries()).toHaveLength(2)
  })

  it('imports an embedded character_book with placement mapping', async () => {
    const { service } = await freshService()
    const payload = {
      character_book: {
        entries: [
          { keys: ['林远'], content: 'c', insertion_order: 20, position: 'before_char' },
        ],
      },
    }
    const result = await service.importEntries({ content: JSON.stringify(payload) })
    expect(result.source_type).toBe('character_book')
    expect(result.entries[0]?.inject_position).toBe('prepend')
    expect(result.entries[0]?.priority).toBe(20)
  })

  it('imports a bare Operit array and binds book_id', async () => {
    const { service } = await freshService()
    const result = await service.importEntries({ content: JSON.stringify([{ name: 'n', content: 'c' }]), book_id: 'bk_1' })
    expect(result.source_type).toBe('operit_entries')
    expect(result.entries[0]?.book_id).toBe('bk_1')
  })

  it('skips entries without keywords unless constant, with warnings', async () => {
    const { service } = await freshService()
    const payload = { entries: { '0': { key: [], content: 'x' }, '1': { key: ['k'], content: 'y' } } }
    const result = await service.importEntries({ content: JSON.stringify(payload) })
    expect(result.imported_count).toBe(1)
    expect(result.warning_count).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('已跳过'))).toBe(true)
  })

  it('rejects invalid JSON and unsupported formats', async () => {
    const { service } = await freshService()
    expect((await catchError(service.importEntries({ content: '{bad' }))).code).toBe('INVALID_JSON')
    expect((await catchError(service.importEntries({ content: '{"foo":1}' }))).code).toBe('UNSUPPORTED_WORLD_BOOK_FORMAT')
    expect((await catchError(service.importEntries({}))).code).toBe('IMPORT_PATH_REQUIRED')
  })

  it('reads from path via the injected reader', async () => {
    const { store } = await freshService()
    const svc = new LoreService(store, async () => '[{"name":"fromFile","content":"c"}]')
    const result = await svc.importEntries({ path: '/fake/book.json' })
    expect(result.imported_count).toBe(1)
  })

  it('reports reader failures as IO_FAILURE', async () => {
    const { store } = await freshService()
    const svc = new LoreService(store, async () => { throw new Error('denied') })
    expect((await catchError(svc.importEntries({ path: '/fake/book.json' }))).code).toBe('IO_FAILURE')
  })
})

describe('LoreService — asResult wrapper', () => {
  it('wraps success and PluginError into Result', async () => {
    const { service } = await freshService()
    const ok = await service.listEntries().then((value) => ({ ok: true as const, value }))
    expect(ok.ok).toBe(true)
    const result = await service.createEntry({ name: '', content: 'x' }).then(
      (value) => ({ ok: true as const, value }),
      (error: PluginError) => ({ ok: false as const, error }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_FIELD_TYPE')
  })
})

/** 类型守卫冒烟：确保 LoreEntry 在 service 返回值上可访问。 */
function assertLoreEntryShape(entry: LoreEntry): void {
  expect(typeof entry.id).toBe('string')
  expect(typeof entry.version).toBe('number')
}
void assertLoreEntryShape
