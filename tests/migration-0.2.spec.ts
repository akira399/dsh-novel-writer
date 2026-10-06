/**
 * 冒烟：用仓库内与运行期同版本的 @deepseek-ai 契约，验证工具定义可被真实校验。
 *
 * 意义：DSH 0.2.0 的 `defineTool` 在注册时会校验参数/output schema。
 * 如果迁移后 schema 形状过时，工具会在装配时抛错。这里直接调用真实
 * `validateArgs` / `valueSchemaSpecToJsonSchema`，把该风险钉死在 CI 里。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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
    const files = ['index.ts', 'settings-tab.tsx', 'ui-hidden.ts', 'workshop-drawer.tsx']
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

  /**
   * 回归：插件里直接访问 `ctx.<服务>` 的每个服务都必须在导出的 inject 中声明。
   *
   * 背景：0.2.0 迁移时漏了 `skills`。缺少注入时 `ctx.skills.register` 会在
   * try/catch 里静默失败，现象是「41 个工具全部可用，但技能注册不上」，
   * 且现场没有任何错误日志，极难排查。此用例把该契约钉死。
   */
  it('host 半区：inject 覆盖所有直接访问的 ctx.<service>', () => {
    const entry = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
    const declared = (/export const inject = \[([^\]]*)\]/.exec(entry)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)

    // 直接成员访问 ctx.x / sctx.x / wctx.x（ctx.get('x') 属于可选读取，不在此列）
    const used = new Set<string>()
    for (const file of ['index.ts', 'routes.ts', 'presets.ts', 'tools/skill.ts', 'tools/index.ts']) {
      const text = readFileSync(join(ROOT, 'src', file), 'utf8')
      const code = text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/\b(?:ctx|sctx|wctx)\.([a-z][A-Za-z0-9_]*)/g)) {
        used.add(m[1]!)
      }
    }
    // 非服务成员白名单 + 通过 ctx.inject([...]) 局部声明的服务
    const allow = new Set([
      'get', 'effect', 'logger', 'inject', 'on', 'provide',
      // routes.ts 用 ctx.inject(['webServer'], (wctx) => ...) 局部声明，故不在顶层 inject
      'webServer',
    ])
    const missing = [...used].filter((name) => !allow.has(name) && !declared.includes(name))

    expect(missing, 'inject 缺少: ' + missing.join(', ')).toEqual([])
    // 技能 novel-writing-workflow 是本项目的真实依赖
    expect(declared).toContain('skills')
  })

  /**
   * 回归：侧边栏入口的点击热区与视觉必须一致。
   *
   * 现场反馈：文字本身点不动，文字右侧的空白处却能点开抽屉。原因是入口打头用了
   * `🐟` emoji——不同平台字形宽度/基线不一致，把文字挤出按钮热区。现改为固定尺寸的
   * 内联 SVG。这里断言渲染路径里不再出现 emoji 字面量，且图标为定宽 SVG。
   */
  it('侧边栏入口不再使用 emoji 字形（避免 hit area 与视觉错位）', () => {
    const src = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
    // 去掉注释后再断言：注释里提到历史实现不算渲染
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('🐟')
    expect(code).toContain("'svg'")
    expect(code).toContain('width: 16')
    expect(code).toContain("cursor: 'pointer'")
    expect(code).toContain('onMouseEnter')
  })

  it('抽屉左缘有显式分隔线（不依赖根元素 1px border）', () => {
    const src = readFileSync(join(ROOT, 'src', 'client', 'workshop-drawer.tsx'), 'utf8')
    // 现场结论：根元素上的 borderLeft 在真实壳里实测看不见
    //（被裁切/被后续内联样式覆盖）。改为 React 内容里显式画一条 2px 竖线。
    expect(src).toContain('data-nw-divider')
    expect(src).toMatch(/width: '2px'/)
    expect(src).toMatch(/background: '#c3cad6'/)
    // 根元素仍须 border-box：抽屉贴 right:0，content-box 会把盒子撑出视口
    expect(src).toContain("'boxSizing:border-box'")
  })

  it('侧边栏入口带 UI 版本戳（便于确认浏览器加载的是新构建）', () => {
    const src = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
    expect(src).toContain("'data-nw-ui': SIDEBAR_UI_VERSION")
    expect(src).toContain("const SIDEBAR_UI_VERSION = 'v")
    // 不要用 font 简写：它会重置 fontSize/lineHeight（此前导致文字尺寸不受控）
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain("font: 'inherit'")
  })

  /**
   * 回归：侧边栏入口只能有一个来源（官方 slot）。
   *
   * 现场事故：迁移到 slot 后我保留了 DOM 注入作为兜底，并用 `slots.entries(...)`
   * 判断 slot 是否生效——但真实服务上的方法名是 `entriesOf`。名字写错 → 判断恒为
   * false → **兜底与 slot 同时生效，侧边栏出现两个同名入口**；用户点到的正好是
   * 带 🐟 emoji 的那个旧 DOM 行，于是「改了代码却看不出任何变化」。
   */
  it('侧边栏入口不再有 DOM 兜底，也不依赖写错名字的 slots.entries', () => {
    // DOM 注入模块必须已删除
    expect(existsSync(join(ROOT, 'src', 'client', 'sidebar.ts'))).toBe(false)

    const src = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8')
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 不得再调用 DOM 注入
    expect(code).not.toContain('mountSidebarEntry')
    // 不得使用真实服务上不存在的 entries() 方法
    expect(code).not.toMatch(/slots\.entries\s*\(/)
    // 唯一来源是 slot
    expect(code).toContain("slots.inject('sidebar.footer.action'")
    // 且必须清理历史遗留的 DOM 入口元素
    expect(code).toContain('data-dsh-novel-writer-entry')
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
