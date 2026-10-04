/**
 * src/settings.ts 单测：DSH 0.2.0 的配置契约。
 *
 * 0.2.0 起 `dsh-settings` 不再提供 `settingsNamespace()` / `scope.register()`，
 * 配置由 Loader 直接注入 apply()；因此「门禁语义」全部落在本模块的纯函数上，
 * 必须用测试钉住：enabled 缺省为开、dataDir 缺省为 $DSH_HOME/dsh-novel-writer、
 * 以及 entry id 必须与 cordis.patch.yml 的 row id 一致（客户端据此定位表单）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, isEnabled, PLUGIN_ENTRY_ID, resolveDataDir } from '../src/settings.ts'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const ORIGINAL_DSH_HOME = process.env.DSH_HOME

afterEach(() => {
  if (ORIGINAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = ORIGINAL_DSH_HOME
})

describe('settings — 门禁语义', () => {
  it('enabled 缺省视为启用（undefined / {} 都算开）', () => {
    expect(isEnabled(undefined)).toBe(true)
    expect(isEnabled({})).toBe(true)
    expect(isEnabled({ enabled: true })).toBe(true)
  })

  it('enabled=false 才关闭', () => {
    expect(isEnabled({ enabled: false })).toBe(false)
  })
})

describe('settings — 数据目录解析', () => {
  it('显式配置优先（并去除首尾空白）', () => {
    expect(resolveDataDir({ dataDir: '  D:\\novels  ' })).toBe('D:\\novels')
  })

  it('空串 / 未配置时回退到 $DSH_HOME/<entryId>', () => {
    process.env.DSH_HOME = 'C:\\fake-dsh-home'
    expect(resolveDataDir({})).toBe(join('C:\\fake-dsh-home', PLUGIN_ENTRY_ID))
    expect(resolveDataDir({ dataDir: '   ' })).toBe(join('C:\\fake-dsh-home', PLUGIN_ENTRY_ID))
    expect(resolveDataDir(undefined)).toBe(join('C:\\fake-dsh-home', PLUGIN_ENTRY_ID))
  })

  it('未设置 DSH_HOME 时回退到 ~/.dsh/<entryId>', () => {
    delete process.env.DSH_HOME
    expect(resolveDataDir({})).toBe(join(homedir(), '.dsh', PLUGIN_ENTRY_ID))
  })
})

describe('settings — Config schema', () => {
  it('为三个字段提供默认值（用户只需写要覆盖的字段）', () => {
    const resolved = Config({}) as { enabled: boolean; dataDir: string; uiHidden: boolean }
    expect(resolved.enabled).toBe(true)
    expect(resolved.dataDir).toBe('')
    expect(resolved.uiHidden).toBe(false)
  })

  it('接受显式覆盖', () => {
    const resolved = Config({ enabled: false, dataDir: 'D:\\x', uiHidden: true }) as {
      enabled: boolean
      dataDir: string
      uiHidden: boolean
    }
    expect(resolved).toEqual({ enabled: false, dataDir: 'D:\\x', uiHidden: true })
  })

  it('拒绝错误类型（门禁不能被静默绕过）', () => {
    // 类型层已禁止；此处验证运行期（配置文件是 YAML，可能写入错误类型）同样拒绝。
    expect(() => Config({ enabled: 'yes' } as unknown as Parameters<typeof Config>[0])).toThrow()
  })
})

describe('settings — 与 bundle patch 的一致性', () => {
  it('PLUGIN_ENTRY_ID 必须等于 cordis.patch.yml 里插入的 row id', () => {
    // 客户端半区用同一字符串调 configForms.get(entryId) 定位设置表单；
    // 两者不一致会让设置页签永远读不到配置（静默失效），故用测试钉住。
    const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    const match = /-\s*insert:\s*\n\s*-\s*id:\s*(\S+)/.exec(patch)
    expect(match, 'cordis.patch.yml 应当有 insert 行').not.toBeNull()
    expect(match![1]).toBe(PLUGIN_ENTRY_ID)
  })

  it('cordis.patch.yml 的 name 必须是本包名', () => {
    const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string }
    expect(patch).toContain("name: '" + pkg.name + "'")
  })
})
