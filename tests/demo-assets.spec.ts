/**
 * 示例项目资产完整性测试（P0 验收）。
 * 验证随包分发的 assets/samples/demo-book/lorebook/*.json：
 *  1. 外壳（schemaVersion）与 store 写格式一致，可被 LoreStore 读取；
 *  2. 条目可被 LoreService 消费（id 唯一、字段完整、分组引用有效）；
 *  3. 示例数据可被 LoreMatcher 索引（关键词命中）。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LoreMatcher, LoreService, LoreStore } from '../src/core/lorebook/index.ts'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'samples', 'demo-book', 'lorebook')

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function serviceOverAssets(): Promise<{ service: LoreService; store: LoreStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'lore-assets-'))
  roots.push(dir)
  // 把示例文件复制到临时目录（不直接读 assets，验证「文件→store→service」全链）
  const { cp } = await import('node:fs/promises')
  await cp(ASSETS_DIR, dir, { recursive: true })
  const store = new LoreStore(dir)
  return { service: new LoreService(store), store }
}

describe('demo assets — integrity', () => {
  it('entries.json is a valid versioned store file readable through LoreStore', async () => {
    const { store } = await serviceOverAssets()
    const entries = await store.readEntries()
    expect(entries.length).toBeGreaterThanOrEqual(10)
  })

  it('entry ids are unique and fields are complete', async () => {
    const { service } = await serviceOverAssets()
    const entries = await service.listEntries()
    const ids = new Set(entries.map((e) => e.id))
    expect(ids.size).toBe(entries.length)
    for (const entry of entries) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.content.length).toBeGreaterThan(0)
      expect(entry.version).toBeGreaterThanOrEqual(1)
      expect(['system', 'user', 'assistant']).toContain(entry.inject_target)
      expect(['prepend', 'append', 'at_depth']).toContain(entry.inject_position)
    }
  })

  it('always-active entries are present for constant injection', async () => {
    const { service } = await serviceOverAssets()
    const entries = await service.listEntries()
    const constant = entries.filter((e) => e.always_active)
    expect(constant.length).toBeGreaterThanOrEqual(3)
  })

  it('group references resolve to existing entries', async () => {
    const { service } = await serviceOverAssets()
    const groups = await service.listGroups()
    const entries = await service.listEntries()
    const ids = new Set(entries.map((e) => e.id))
    for (const group of groups) {
      for (const entryId of group.entry_ids) {
        expect(ids.has(entryId)).toBe(true)
      }
    }
  })

  it('keywords hit through LoreMatcher', async () => {
    const { service } = await serviceOverAssets()
    const entries = await service.listEntries()
    const matcher = new LoreMatcher()
    matcher.rebuild(entries)
    const hits = matcher.match('林远在青云宗突破筑基，引来赵无极的目光')
    expect(hits.map((h) => h.entry.id).sort()).toEqual(
      ['wb_demo_linyuan', 'wb_demo_qingyun', 'wb_demo_zhao', 'wb_demo_zhuji'].sort(),
    )
  })

  it('settings.json carries the user replacement and budget', async () => {
    const { store } = await serviceOverAssets()
    const settings = await store.readSettings()
    expect(settings.user_replacement).toBe('我')
    expect(settings.injection_budget).toBe(4000)
  })
})
