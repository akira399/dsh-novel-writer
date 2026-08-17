import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LoreStore } from '../src/core/lorebook/index.ts'
import type { LoreEntry, LoreGroup, PluginError } from '../src/core/index.ts'

const roots: string[] = []
async function freshStore(options?: { keepBackups?: number }): Promise<{ store: LoreStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'lorestore-'))
  roots.push(dir)
  return { store: new LoreStore(dir, options), dir }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function entry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: 'wb_1',
    name: '筑基',
    content: '林远，筑基三层。',
    keywords: ['林远'],
    is_regex: false,
    case_sensitive: false,
    always_active: false,
    enabled: true,
    priority: 50,
    scan_depth: 0,
    inject_target: 'system',
    inject_position: 'append',
    insertion_depth: 0,
    book_id: '',
    tags: [],
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('LoreStore — read/write roundtrip', () => {
  it('returns defaults when files do not exist', async () => {
    const { store } = await freshStore()
    expect(await store.readEntries()).toEqual([])
    expect(await store.readGroups()).toEqual([])
    expect(await store.readSettings()).toEqual({})
  })

  it('roundtrips entries, groups and settings', async () => {
    const { store, dir } = await freshStore()
    const entries = [entry()]
    await store.writeEntries(entries)
    expect(await store.readEntries()).toEqual(entries)
    expect(await readFile(join(dir, 'entries.json'), 'utf8')).toContain('schemaVersion')

    const groups: LoreGroup[] = [{ id: 'wg_1', name: '卷一', entry_ids: ['wb_1'], book_ids: [], enabled: true, created_at: 't', updated_at: 't' }]
    await store.writeGroups(groups)
    expect(await store.readGroups()).toEqual(groups)

    await store.writeSettings({ user_replacement: '我' })
    expect(await store.readSettings()).toEqual({ user_replacement: '我' })
  })

  it('leaves no temporary files behind after writes', async () => {
    const { store, dir } = await freshStore()
    await store.writeEntries([entry()])
    await store.writeGroups([])
    const names = await readdir(dir)
    expect(names.some((name) => name.includes('.tmp.'))).toBe(false)
  })
})

describe('LoreStore — legacy migration', () => {
  it('wraps a bare legacy entries array into schemaVersion 1', async () => {
    const { store, dir } = await freshStore()
    await writeFile(join(dir, 'entries.json'), '[{"id":"wb_old","name":"n","content":"c"}]', 'utf8')
    const entries = await store.readEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('wb_old')
  })

  it('rejects an unsupported schemaVersion with a clear error', async () => {
    const { store, dir } = await freshStore()
    await writeFile(join(dir, 'entries.json'), JSON.stringify({ schemaVersion: 99, data: [] }), 'utf8')
    const error = await store.readEntries().then(() => null, (e: PluginError) => e)
    expect(error?.code).toBe('INVALID_FIELD_TYPE')
    expect(String(error?.message)).toContain('schemaVersion=99')
  })

  it('rejects invalid shapes instead of silently returning defaults', async () => {
    const { store, dir } = await freshStore()
    await writeFile(join(dir, 'entries.json'), '{"not":"an array"}', 'utf8')
    const error = await store.readEntries().then(() => null, (e: PluginError) => e)
    expect(error?.code).toBe('INVALID_FIELD_TYPE')
    expect(String(error?.message)).toContain('entries 必须是数组')
  })

  it('reports corrupt JSON with path context', async () => {
    const { store, dir } = await freshStore()
    await writeFile(join(dir, 'groups.json'), '{broken', 'utf8')
    const error = await store.readGroups().then(() => null, (e: PluginError) => e)
    expect(error?.code).toBe('INVALID_FIELD_TYPE')
    expect(String(error?.message)).toContain('groups.json')
  })
})

describe('LoreStore — backups', () => {
  it('creates a backup before each overwrite and prunes to keepBackups', async () => {
    const { store, dir } = await freshStore({ keepBackups: 2 })
    for (let i = 0; i < 5; i += 1) {
      await store.writeEntries([entry({ id: `wb_${i}` })])
    }
    const names = await readdir(dir)
    const backups = names.filter((name) => name.startsWith('entries.bak.'))
    expect(backups).toHaveLength(2)
    // 最新备份内容 = 倒数第二次写入
    const latestBackup = backups.sort().at(-1)!
    const content = JSON.parse(await readFile(join(dir, latestBackup), 'utf8')) as { data: LoreEntry[] }
    expect(content.data[0]?.id).toBe('wb_3')
  })

  it('keepBackups=0 keeps no backups', async () => {
    const { store, dir } = await freshStore({ keepBackups: 0 })
    await store.writeEntries([entry()])
    await store.writeEntries([entry({ id: 'wb_2' })])
    const names = await readdir(dir)
    expect(names.some((name) => name.startsWith('entries.bak.'))).toBe(false)
  })
})

describe('LoreStore — path safety', () => {
  it('safeFileName rejects traversal and path separators', () => {
    const { safeFileName } = require('../src/core/lorebook/store.ts') as typeof import('../src/core/lorebook/store.ts')
    expect(safeFileName('entries')).toBe('entries')
    expect(() => safeFileName('../evil')).toThrow()
    expect(() => safeFileName('a/b')).toThrow()
    expect(() => safeFileName('a\\b')).toThrow()
    expect(() => safeFileName('')).toThrow()
  })
})
