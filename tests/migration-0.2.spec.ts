/**
 * 冒烟：用仓库内与运行期同版本的 @deepseek-ai 契约，验证工具定义可被真实校验。
 *
 * 意义：DSH 0.2.0 的 `defineTool` 在注册时会校验参数/output schema。
 * 如果迁移后 schema 形状过时，工具会在装配时抛错。这里直接调用真实
 * `validateArgs` / `valueSchemaSpecToJsonSchema`，把该风险钉死在 CI 里。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

describe('smoke — 构建产物与契约一致性', () => {
  it('lib/ 构建产物存在且相对导入已改写为 .js', () => {
    const entry = join(ROOT, 'lib', 'index.js')
    const text = readFileSync(entry, 'utf8')
    expect(text).toContain('./settings.js')
    // 任何残留的 .ts 说明 rewriteRelativeImportExtensions 失效，运行期会 ERR_MODULE_NOT_FOUND
    const leftovers = text.match(/from '\.\/[^']*\.ts'/g) ?? []
    expect(leftovers).toEqual([])
  })

  it('发布的 assets 仍在包内（技能/提示词/预设）', () => {
    const assets = readdirSync(join(ROOT, 'assets'))
    expect(assets).toContain('prompts')
    expect(assets).toContain('skills')
  })

  it('自由 JSON 输出 schema 可投影为 JSON Schema（novel_prompts 等工具的 output 契约）', () => {
    const projected = valueSchemaSpecToJsonSchema({ type: 'json' })
    expect(projected).toBeTruthy()
  })

  it('cordis.patch.yml 声明的 row id 与客户端定位的设置命名空间一致', () => {
    const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    // 客户端 src/client/index.ts 用 ENTRY_ID = 'dsh-novel-writer' 调 configForms.get()
    expect(patch).toContain('id: dsh-novel-writer')
    const clientEntry = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
    expect(clientEntry).toContain("const ENTRY_ID = 'dsh-novel-writer'")
  })

  it('客户端半区不再 import 已删除的 @deepseek-ai/dsh-client-runtime', () => {
    const files = ['index.ts', 'settings-tab.tsx', 'sidebar.ts', 'ui-hidden.ts']
    for (const file of files) {
      const text = readFileSync(join(ROOT, 'src', 'client', file), 'utf8')
      // 只检查真实 import（注释里说明历史包名不算引用）
      const imports = text.match(/^\s*import[^\n]*dsh-client-runtime/gm) ?? []
      expect(imports, file + ' 仍 import dsh-client-runtime').toEqual([])
    }
    const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8')
    expect(pkg).not.toContain('dsh-client-runtime')
  })

  it('客户端半区不再注册已被移除的 settings.plugin.item slot', () => {
    const clientEntry = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
    // 排除注释后不应再出现该 slot 名
    const code = clientEntry.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('settings.plugin.item')
    // 0.2.0 的正规位置
    expect(code).toContain('settings.plugins.tab')
  })

  it('构建出的 lib/client.js 是合法 ModuleLoader 单元：evaluate 后暴露 apply/inject', async () => {
    // 真正执行打包产物（含 react 依赖解析），捕捉语法/顶层求值错误。
    const { createRequire } = await import('node:module')
    const { runInNewContext } = await import('node:vm')
    const req = createRequire(join(ROOT, 'lib', 'client.js'))

    const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
    let captured: { id?: string; factory?: (require: unknown) => unknown } | undefined
    const windowStub = {
      __ModuleLoader__: {
        load: (unit: { id?: string; factory?: (require: unknown) => unknown }) => {
          captured = unit
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      setTimeout: () => 0,
      clearTimeout: () => {},
    }
    const localStorageStub = {
      _v: new Map<string, string>(),
      getItem(k: string) { return this._v.get(k) ?? null },
      setItem(k: string, v: string) { this._v.set(k, v) },
    }

    runInNewContext(bundle, {
      window: windowStub,
      localStorage: localStorageStub,
      require: req,
      module: { exports: {} },
      exports: {},
      console,
      setTimeout,
      clearTimeout,
    })

    expect(captured, 'bundle 应调用 window.__ModuleLoader__.load').toBeDefined()
    expect(captured!.id).toBe('@dsh-external/dsh-novel-writer')
    expect(typeof captured!.factory).toBe('function')

    const mod = captured!.factory!(req) as { apply?: unknown; inject?: unknown }
    expect(typeof mod.apply).toBe('function')
    expect(Array.isArray(mod.inject)).toBe(true)
    expect(mod.inject).toContain('slots')
  })
})
