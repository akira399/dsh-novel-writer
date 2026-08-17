import { describe, expect, it, vi } from 'vitest'
import { NovelAssembly } from '../src/assembly.ts'
import type { LoreService } from '../src/core/lorebook/index.ts'
import type { NovelService } from '../src/core/novel/index.ts'

/** 最小 ctx：tools.register 计数 + 返回 disposer。 */
function mockCtx() {
  const disposers: Array<() => void> = []
  const ctx = {
    tools: {
      register: vi.fn(() => {
        let disposed = false
        const dispose = (): void => { disposed = true }
        disposers.push(dispose)
        return dispose
      }),
    },
  } as never
  return { ctx, disposers }
}

/** 计数工厂：记录创建次数，返回假服务对。 */
function mockServicesFactory() {
  const created: string[] = []
  const factory = (dir: string) => {
    created.push(dir)
    return {
      lore: { dir } as unknown as LoreService,
      novel: { dir } as unknown as NovelService,
      llm: null,
      bookDirOf: (id: string) => id,
    }
  }
  return { factory, created }
}

describe('NovelAssembly — settings gate', () => {
  it('registers tools on first enable', () => {
    const { ctx, disposers } = mockCtx()
    const { factory, created } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    expect(assembly.active).toBe(false)
    assembly.sync(true, '/data')
    expect(assembly.active).toBe(true)
    expect(created).toEqual(['/data'])
    // 41 个工具（lorebook 13 + novel 11 + extras 9 + quality 5 + guide 2 + prompts 1 + wordcount 1；含克隆/账本/市场调研/创建）
    expect(disposers).toHaveLength(41)
  })

  it('is idempotent while enabled with the same dir', () => {
    const { ctx, disposers } = mockCtx()
    const { factory, created } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    assembly.sync(true, '/a')
    assembly.sync(true, '/a')
    expect(created).toHaveLength(1)
    expect(disposers).toHaveLength(41)
  })

  it('unregisters when disabled and can re-enable', () => {
    const { ctx, disposers } = mockCtx()
    const { factory, created } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    assembly.sync(true, '/a')
    assembly.sync(false, '/a')
    expect(assembly.active).toBe(false)
    assembly.sync(true, '/a')
    expect(created).toHaveLength(2)
    expect(disposers).toHaveLength(82)
  })

  it('rebuilds when the directory changes while enabled', () => {
    const { ctx } = mockCtx()
    const { factory, created } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    assembly.sync(true, '/a')
    assembly.sync(true, '/b')
    expect(created).toEqual(['/a', '/b'])
  })

  it('teardown is idempotent and exposes services', () => {
    const { ctx } = mockCtx()
    const { factory } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    assembly.sync(true, '/a')
    expect(assembly.services).not.toBeNull()
    assembly.teardown()
    assembly.teardown()
    expect(assembly.active).toBe(false)
    expect(assembly.services).toBeNull()
  })

  it('disabled state never creates the services', () => {
    const { ctx } = mockCtx()
    const { factory, created } = mockServicesFactory()
    const assembly = new NovelAssembly(ctx, { createServices: factory })
    assembly.sync(false, '/a')
    expect(created).toHaveLength(0)
  })
})
