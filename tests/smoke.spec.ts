import { describe, expect, it } from 'vitest'
import { Config, name } from '../src/index.ts'

describe('plugin skeleton', () => {
  it('exports a stable plugin name', () => {
    expect(name).toBe('@dsh-external/dsh-novel-writer')
  })

  it('Config schema resolves the enabled default', () => {
    const resolved = Config({}) as { enabled: boolean }
    expect(resolved.enabled).toBe(true)
  })

  it('Config schema honors an explicit enabled=false', () => {
    const resolved = Config({ enabled: false }) as { enabled: boolean }
    expect(resolved.enabled).toBe(false)
  })
})
