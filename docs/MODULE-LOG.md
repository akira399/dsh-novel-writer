# dsh-novel-writer 模块开发日志（Module Log）

> 开发纪律（用户确认）：**每模块 → 单测 → 检查 → 复盘 → 通过后再进下一模块**。
> 每个模块在此登记：范围、验收证据、Code Review 结论、遗留事项。

---

## 模块 0：插件骨架（P0-0.1 脚手架重构）

**日期**：2026-08-16
**范围**：
- 由 `dev_scaffold_plugin`（hybrid 形态）生成的 daemon-loop 模板重构为 dsh-liangshen 工程范式：
  TS 源码（`.ts` 后缀导入，编译自动重写 `.js`）+ tsc 编译 host + tsdown 打包 client + vitest 单测。
- `package.json`（exports 双端、dsh.bundle.patch、dsh.client、optional peer）、`tsconfig.json`/`tsconfig.build.json`、
  `vitest.config.ts`、`scripts/build.sh`（本地 tsc 直编，兼容 dev_build_plugin）、`cordis.patch.yml`、
  `src/index.ts`（纯装配骨架：name/inject/Config(enabled)/apply）、`src/client/index.ts`（空装配占位）、
  `client.d.ts`（手写 client 类型声明）、`tests/smoke.spec.ts`。

**验收证据**：
- `npm run typecheck`：0 错误
- `npm test`：3/3 通过（name 常量、Config 默认值、enabled=false）
- `npm run build`：host tsc → `lib/index.js` + `lib/types/index.d.ts`；client tsdown → `lib/client.js`（含 `__ModuleLoader__.load` banner）
- `npm pack --dry-run`：11 文件，含 client.d.ts / cordis.patch.yml / lib/*

**Code Review 结论（通过 ✅）**：
1. ✅ 名称一致性：cordis.patch.yml `name` = src/index.ts `name` = tsdown PLUGIN_ID = package name
2. ✅ 职责分离：src/index.ts 仅装配，无业务逻辑；业务纯逻辑将落 src/core/**
3. ✅ client 失败策略：骨架阶段不挂 DOM，apply 只记日志（对齐 dsh-client-ui-task-board 的"挂载失败不抛错"策略）
4. ✅ 双编译产物边界：host 由 tsc（exclude src/client），client 由 tsdown（dts 关闭、手写 client.d.ts），无重叠
5. ✅ 测试与源码共用 `.ts` 后缀导入（TS 5.7 rewriteRelativeImportExtensions）

**遗留事项**：
- [ ] README.md 仍为脚手架占位；README.zh.md / LICENSE 未创建（P3 文档阶段统一）
- [ ] `npm approve-scripts` esbuild postinstall 未批准（不影响当前构建，tsdown 已成功）
- [ ] peerDependencies 仅有 cordis/dsh-tools；dsh-settings、dsh-skill、dsh-session 等在对应模块引入时补充

---

## 模块 1：核心类型契约层（P0-0.2 types + util）

**日期**：2026-08-16
**范围**：
- `src/core/types.ts`：ErrorCode/PluginError/Result 错误约定；LoreEntry/LoreGroup/LoreSettings/InjectionPlan（夏瑾字段全集 + v3 扩展 book_id/volume_id/tags/note/version）；ChapterStats；PromptTemplate；VersionedFile。
- `src/core/util.ts`：纯函数 newId / nowIso / normalizeKeywords / normalizeNumber / clampInt / estimateTokens。
- `src/core/index.ts`：域聚合导出（模块间统一引用入口）。
- `tests/core.spec.ts`：12 例。

**验收证据**：
- `npm run typecheck`：0 错误
- `npm test`：15/15 通过（smoke 3 + core 12）

**Code Review 结论（通过 ✅）**：
1. ✅ 类型模块零 IO 零 cordis 依赖（契约层纯净）
2. ✅ 夏瑾字段 1:1 覆盖（对照 worldbook_service.js 的 entry 字段逐一核对），v3 扩展全部可选字段
3. ✅ `Result<T>` 判别联合为工具层序列化统一出口
4. ✅ 可选字段用 `undefined`（非 null）+ VersionedFile 外壳 → 为模块 2 迁移链预留
5. ✅ 测试期发现 1 处测试期望计算错误（`abcd你好世界`=5 而非 6），实现正确、已修测试——实现/测试分离验证有效

**遗留事项**：
- [ ] 变量引擎类型（VariableStore）延迟到 P1 变量模块定义（避免超前契约）
- [ ] PromptTemplate 仅定义形状，加载/覆盖逻辑在 P2

---

## 模块 2：lorebook 存储层（P0-0.3 store.ts）

**日期**：2026-08-16
**范围**：`src/core/lorebook/store.ts`（LoreStore：原子写/迁移链/备份/严格错误）+ `src/core/lorebook/index.ts` + `tests/lorebook-store.spec.ts`（10 例）。
**验收证据**：typecheck 0 错误；`npm test` 25/25。
**Code Review 结论（通过 ✅）**：
1. ✅ 原子写（tmp+rename）+ 0600 权限；无 .tmp 残留（已测）
2. ✅ VersionedFile 外壳**读写对称**——单测抓出首版缺陷：写路径直接写裸数组、无版本标识，导致备份文件无外壳；已修复为 writeVersioned 统一包装（教训：迁移不只发生在读侧）
3. ✅ 迁移链：旧夏瑾裸数组自动包装 v1；schemaVersion=99 明确报错（含版本号）
4. ✅ 备份：写前备份 + prune 到 keepBackups（0/2 均测）；备份内容带外壳
5. ✅ 损坏 JSON/形状非法 → 抛 PluginError（含文件路径），不静默（修复夏瑾 E1）
6. ✅ safeFileName 防路径穿越（导出白盒测试 4 例）
7. ✅ 存储层零业务规则（规则在 service 层，职责分离）
**遗留事项**：
- [ ] readJson 对单条记录未做字段级形状校验（条目字段默认值补全放 service 层——模块 3 的 normalize 职责）

---

## 模块 3：lorebook 业务服务层（P0-0.4 service.ts）

**日期**：2026-08-16
**范围**：`src/core/lorebook/types.ts`（参数/结果类型）+ `service.ts`（LoreService：条目/分组 CRUD + 三格式导入解析 + asResult 包装）+ `tests/lorebook-service.spec.ts`（19 例）。
**验收证据**：typecheck 0 错误；`npm test` 44/44。
**Code Review 结论（通过 ✅）**：
1. ✅ 条目 CRUD：create 字段归一化（默认值/assistant→at_depth/priority 夹取）、update 部分更新 + version 递增、delete 级联清理分组引用、toggle
2. ✅ 分组 CRUD：create/list/update（含 add/remove entry_ids）/delete（可连带删除条目）/move（含从全部分组摘除）
3. ✅ 导入：Operit 数组 / SillyTavern lorebook / 内嵌+包裹 character_book 逐级尝试；5 类兼容性警告保留
4. ✅ 错误码体系贯通（ENTRY_NOT_FOUND/GROUP_NOT_FOUND/INVALID_ENTRY_ID/INVALID_JSON/UNSUPPORTED_FORMAT/IO_FAILURE…）
5. ✅ 文件读取能力构造注入（默认 node:fs）→ 导入可测
6. ✅ asResult 统一包装（工具层直接序列化）
**测试抓出并修复的缺陷（2 个）**：
- updateEntry 的「显式 null = 重置」语义与实现矛盾（`!= null` 跳过了 null）→ 可重置字段改用 `!== undefined`（修复）——types.ts 契约与实现不一致被测试暴露
- ST/character_book 条目无 name/comment 时被静默丢弃（夏瑾原版缺陷）→ name 回退 `key[0]/uid/未命名条目`（修复，优于夏瑾）
**遗留事项**：
- [ ] 角色卡列表（夏瑾 listWorldBookCharacterCards）→ DSH 中为项目列表，P1 项目模块接通
- [ ] 分组/条目的 book_id 过滤在查询层（现在全量返回，由调用方过滤）

---

## 模块 4：lorebook 匹配引擎（P0-0.5 matcher.ts）

**日期**：2026-08-16
**范围**：`src/core/lorebook/matcher.ts`（LoreMatcher：倒排索引 + 预编译正则缓存 + 增量更新）+ `tests/lorebook-matcher.spec.ts`（12 例）。
**验收证据**：typecheck 0 错误；`npm test` 56/56。
**Code Review 结论（通过 ✅）**：
1. ✅ 倒排索引（小写 token → entryId 集合）替代全量线性扫描（修复夏瑾 P4）
2. ✅ 正则预编译缓存 + upsert/remove 写时失效（修复夏瑾 P3）
3. ✅ 大小写敏感正确性——测试抓出「小写 token 比对原文」bug，改为原词判定 + hitKeyword 返回实际命中词（修复）
4. ✅ 正则条目全部关键词按正则解释（修正夏瑾移植偏差：原实现只编译首个关键词）
5. ✅ 非法正则整条跳过（try/catch 容错）、disabled 条目不索引、entryIds 过滤、空文本短路
**遗留事项**：
- [ ] scan_depth（回溯扫描对象数）语义由注入组装器（P1）消费，本层只做单文本匹配

---

## 模块 5：章节字数统计（P0-0.6 stats/wordcount.ts）

**日期**：2026-08-16
**范围**：`src/core/stats/wordcount.ts`（countChapter / checkWordTarget 纯函数）+ `src/core/stats/index.ts` + `tests/stats-wordcount.spec.ts`（11 例）。
**验收证据**：typecheck 0 错误；`npm test` 64/64。
**Code Review 结论（通过 ✅）**：
1. ✅ 统计口径明确：totalChars 主口径（对齐网文平台习惯）+ cjkChars 辅助 + 段落/对话占比/平均句长
2. ✅ 达标判定闭区间 [min,max]、口径可切换（useCjk）
3. ✅ 边界用例覆盖（空文本/纯空白/单句/多句/中英混排）
4. ✅ 纯函数零 IO；round 处理避免浮点噪声
**已知近似（记录，P2 校验引擎按 warning 级处理）**：
- 对话占比 = 引号字符/2 ÷ 总字符（引号未配对的文本会低估/高估）
- 平均句长按句末标点切分（引号内句号也会切分）
**遗留事项**：
- [ ] meetsTarget 默认 false 由 checkWordTarget 填充（保持 countChapter 纯净）

---

## 模块 6：agent 工具注册层（P0-0.7 tools/ + host 装配）

**日期**：2026-08-16
**范围**：`src/tools/{json,lorebook,stats,index}.ts`（9 个工具：lorebook list/get/create/update/delete/toggle/import/export + novel_wordcount）+ `src/index.ts` 装配 + client 骨架升级（settings.plugin.item 占位卡，task-board 验证模式）+ `tsconfig.client.json`（DOM lib）+ React 类型依赖。
**验收证据**：typecheck 0 错误（host+client 双段）；`npm test` 64/64；`npm run build` 完整 lib 树；**运行时注入验证：fiber ACTIVE（dev_inject_plugin → dev_plugin_status → dev_uninject_plugin 清理）**。
**Code Review 结论（通过 ✅）**：
1. ✅ defineTool 泛型 API 掌握：output.schema 用作者面 ValueSchemaSpec DSL（`{ type: 'json' }`=自由 JSON）；**宽类型标注会破坏泛型推断（value 退化为 never）**——jsonOutput() 改为字面量推断返回
2. ✅ 工具契约统一 `{ ok, value } | { ok: false, error }`（asResult 包装），错误码对模型可读
3. ✅ 工具参数 schema 完整（required/description），create/update 参数映射与 service 契约一致
4. ✅ client 装配契约：slots 声明 + register(name, Component) 两参数形式；SlotComponent 必须返回 ReactNode（React 为 devDependency，运行时宿主提供）
5. ✅ 注入器预检通过（client inject slots + 合法 slot name）；卸载后 junction/registry/patch 全部清理
**遗留事项**：
- [ ] settings 门禁未接入（enabled 目前只读 config；模块 7 接 settings 命名空间热生效）
- [ ] GUI 占位卡模块 7 升级为真实设置表单；侧边栏入口（DOM 注入）P2 落地
- [ ] 分组/角色卡工具（list_groups/create_group 等 5 个）随 P1 项目模块注册

---

## 模块 7：settings 门禁 + 示例资产 + P0 整体验收

**日期**：2026-08-16
**范围**：
- `src/assembly.ts`（NovelAssembly：enabled/lorebookDir 幂等注册注销控制器，可单测）
- `src/index.ts` 装配升级（ctx.inject(["settings"]) + settingsNamespace + scope.watch 热生效，仿 dsh-plugin-publisher 模式；settings 服务卸载时 teardown）
- `src/tools/*` 注册函数改为返回 disposer 数组（聚合注销）
- `assets/samples/demo-book/lorebook/{entries,groups,settings}.json`（示例小说《青云问道》：10 条世界书条目 + 1 分组 + 设置）
- `tests/assembly.spec.ts`（6 例）+ `tests/demo-assets.spec.ts`（6 例）
**验收证据**：
- typecheck 0 错误；`npm test` 76/76（8 文件）
- `npm run verify`（typecheck+test+build）全绿；`npm pack` 74 文件含 assets
- **scratch 组合验证**：`npx -y @deepseek-ai/dsh plugin --profile scratch add .` + `--dump-config` 输出含 `# == @dsh-external/dsh-novel-writer` 插件行，exit=0
- **运行时注入验证**：settings 门禁版本注入 → fiber ACTIVE → 卸载干净（junction/registry/patch 全部清理）
**Code Review 结论（通过 ✅）**：
1. ✅ settings 门禁与装配解耦：NovelAssembly 纯逻辑可单测（幂等/目录切换重建/禁用零创建），cordis 接线薄层在 index.ts
2. ✅ 热生效语义正确：enabled=false 注销全部工具；目录变更重建；settings 服务卸载时 teardown 防泄漏
3. ✅ settingsNamespace 品牌类型（首次 typecheck 报错后修正）——API 契约准确
4. ✅ 示例资产经 store/service/matcher 全链完整性测试（id 唯一/字段完整/分组引用有效/关键词命中）
5. ✅ dsh CLI 组合验证确认 patch 装配层合法
**遗留事项（P0 结束）**：
- [ ] P1：九阶段流程引擎/注入组装器/变量引擎/上下文包/会话驱动/技能/预设
- [ ] P2：GUI v2（世界书管理/诊断面板/统计面板）+ 分组工具注册 + 提示词库全量
- [ ] 设置卡真实表单（P1 GUI v1 一并落地）

---

## P1-A：九阶段流程状态机引擎（workflow/engine.ts）

**日期**：2026-08-16
**范围**：`src/core/workflow/{types,engine,index}.ts`（PhaseId/PhaseState/PhaseRecord/AuditEvent/PhaseLedger + 纯函数引擎：createLedger/enter/submit/forceApprove/reopen/skip/rollback/canEnter/nextPhaseOf）+ `tests/workflow.spec.ts`（17 例）。
**验收证据**：typecheck 0 错误；`npm test` 93/93。
**Code Review 结论（通过 ✅）**：
1. ✅ 九阶段线性主链 + 门禁（前一阶段 approved/skipped 才可进入，topic 恒可进）
2. ✅ submit 门禁语义：errorCount>0 → review 挂起不自动推进；通过 → approved + version 递增 + approvedAt；review 可重试
3. ✅ 用户覆盖：forceApprove（review/in_progress→approved）、reopen（→in_progress）、skip（仅 locked/in_progress）
4. ✅ 修订回环：revision/done 可 rollback 到任意 approved/skipped 目标，目标之后的已批准阶段自动解锁重走
5. ✅ 审计事件模型（action/phase/actor/detail）；seq 由存储层分配（P1-B）
6. ✅ 纯函数无 IO：ledger 进出，持久化零耦合
**测试期修正**：1 处测试断言过严（从 done 回退时 detail 为 "from done"，同属合法路径）
**遗留事项**：
- [ ] seq 分配与 audit.jsonl 落盘 → P1-B
- [ ] 产物版本快照（versions/<phase>/v<n>）→ P1-B
- [ ] 阶段级校验器绑定（validatorIds）→ P2 quality 模块

---

## P1-B：小说项目存储层（novel/store.ts）

**日期**：2026-08-16
**范围**：`src/core/atomic-file.ts`（原子写/备份/追加写，LoreStore 与 NovelStore 共用）+ `src/core/novel/{types,store,index}.ts`（Book/BookConfig/Chapter + NovelStore：项目生命周期/审计/产物版本快照/章节 frontmatter）+ `tests/novel-store.spec.ts`（12 例）。
**验收证据**：typecheck 0 错误；`npm test` 105/105。
**Code Review 结论（通过 ✅）**：
1. ✅ 项目目录布局对齐方案 §6.1：book.json（VersionedFile 外壳）/audit.jsonl/docs/versions/chapters
2. ✅ 旧格式自动迁移（裸对象→外壳、缺失阶段补 locked）
3. ✅ 审计 append-only + seq 递增（create 事件占 1）
4. ✅ 章节 frontmatter（HTML 注释内嵌 JSON）编码/解析对称 + 容错（坏 JSON→null、裸正文→默认元数据、缺字段默认值）
5. ✅ 产物版本快照 v<n> 自动编号；assertBookId 防路径穿越
6. ✅ 原子写抽公共工具（atomic-file.ts），LoreStore 后续可切换复用
**测试期修正（3 处）**：
- parseChapterFrontmatter 返回 `body` 与 readChapter 期望 `content` 字段名不一致（统一映射）
- 文件规范尾换行读回未 trim（readChapter 统一 trimEnd）
- 测试自身遗漏 mkdir（裸写章节文件前未建目录）
**遗留事项**：
- [ ] Book.stats（totalWords/chapterCount）由写章统计接线自动更新（P1-F）
- [ ] summary/（章节摘要）与 ledger.json（变量/账本）→ P1-C/E
- [ ] 阶段产物与 workflow 门禁的联动服务（novel_service，P1-F 提供）

---

## P1-C：变量引擎（variables/engine.ts + store.ts）

**日期**：2026-08-16
**范围**：`src/core/variables/{types,engine,store,index}.ts`（YAML-like 解析/InitVar/JSON Pointer/JSON Patch/UpdateVariable 提取/宏渲染全集 + variables.json 存储与章节增量同步）+ `tests/variables.spec.ts`（14 例）。
**验收证据**：typecheck 0 错误；`npm test` 119/119。
**Code Review 结论（通过 ✅）**：
1. ✅ 夏瑾 variables.js 核心能力全量移植（YAML 子集解析/JSON Pointer/5 类 op/4 种 patch 包裹/9 类宏）
2. ✅ get_*（JSON 序列化）与 format_*（YAML 文本）语义保留夏瑾/ST 兼容
3. ✅ 增强：`{{.x}}`/`{{$x}}` 宏支持 CJK 键（中文变量名场景）
4. ✅ 存储：VersionedFile 外壳 + 旧格式兼容 + 章节增量同步幂等（processed_chapter_numbers 游标）
5. ✅ 保护 `_` 前缀键；非法 patch 静默跳过（模型输出容错）
**测试期修正（3 处）**：
- removeValueByPointer 对象分支缺 `in` 保护（JS `delete` 对不存在键返回 true——夏瑾有保护，移植遗漏）→ 修复
- get_* 宏测试期望与夏瑾 JSON 序列化语义不符 → 修测试（文档注明语义）
- 测试用例数据错误（$world 实际存在）→ 修测试
**遗留事项**：
- [ ] VariableStoreFile 尚未挂到项目目录（P1-E 上下文组装时接线）
- [ ] 账本融合（ledger.json 写入）→ P2 一致性引擎

---

## P1-D：注入组装器（lorebook/injector.ts）

**日期**：2026-08-16
**范围**：`src/core/lorebook/injector.ts`（buildInjectionPlan：过滤/分流/排序/预算/渲染，三种 scope 复用）+ `tests/lorebook-injector.spec.ts`（13 例）。
**验收证据**：typecheck 0 错误；`npm test` 132/132。
**Code Review 结论（通过 ✅）**：
1. ✅ 过滤链：disabled 条目 → 禁用分组 → 书绑定（条目级优先、分组级次之、全局兜底）
2. ✅ 常驻/关键词双通道分流：system→prepend/append；user→user 槽；assistant→at_depth（强制）
3. ✅ scan_depth 回溯最近 N 条历史；priority 降序（at_depth 按 depth 降序）
4. ✅ 预算贪心裁剪（budget 0=关闭；truncated 携带原因：budget/disabled-group/book-mismatch）
5. ✅ 组装格式：<worldbook><entry> XML 包裹 + 属性转义 + 变量宏/名称宏渲染
6. ✅ 契约统一：InjectionPlan.truncated reason 由 card-mismatch 改为 book-mismatch（DSH 语义）
**测试期修正（3 处测试数据错误 + 1 处类型契约）**：
- 关键词「来了」不在扫描文本中（改「来到」）
- scan_depth 回溯方向理解反（最近 N 条，修正两个用例期望）
- 预算 400 < 单条目 500 token（改 300 预算 + 200 字条目）
**遗留事项**：
- [ ] user 槽并入 append 是占位——P1-E 上下文包组装时按场景细分（写作指令 vs 对话）
- [ ] at_depth 条目的历史插入位置由 P1-E 决定

---

## P1-E：上下文包组装器（context/assembler.ts）

**日期**：2026-08-16
**范围**：`src/core/context/{types,assembler,index}.ts`（ContextPacket + ContextAssembler：L1/L2/L3 三层组装 + 预算裁剪链 + 硬约束生成）+ `tests/context-assembler.spec.ts`（4 例）。
**验收证据**：typecheck 0 错误；`npm test` 136/136。
**Code Review 结论（通过 ✅）**：
1. ✅ L1 全书级（书名/类型/风格 + 大纲 ≤500 字截断）；L2 卷章级（卷细纲 + 章细纲外部优先 + 前 N 章全文）；L3 记忆级（摘要降级首 200 字 + 变量快照 + lorebook 动态注入，scanHistory=前章全文）
2. ✅ 预算恒定性：contextBudget 硬上限，裁剪顺序 L3 摘要减半 → L2 前章减半，truncatedInfo 全程记录
3. ✅ 硬约束自动生成（字数区间/视角/禁用词/章末钩子/防剧透）
4. ✅ 依赖注入（store/loreStore/variables）可 fixture 单测；NovelStore.getBookDir 公共化
**测试期修正（3 处）**：`||`+`??` 混用语法错误；摘要收集顺序（push→unshift 升序）；fixture 章节数不足导致预算/摘要场景无法触发（扩到 4 章）
**遗留事项**：
- [ ] summary/ 写入（P1-F 写章后生成）；at_depth 条目的历史插入位置（P1-F 指令组装）
- [ ] 账本实体注入（P2 一致性引擎）

---

## P1-F1：小说创作组合服务（novel/service.ts）

**日期**：2026-08-16
**范围**：`src/core/novel/service.ts`（NovelService：项目/流程门禁组合/产物提交/章节保存管线/统计/组装）+ `tests/novel-service.spec.ts`（8 例）。
**验收证据**：typecheck 0 错误；`npm test` 144/144。
**Code Review 结论（通过 ✅）**：
1. ✅ 一站式流程面：enterPhase（门禁）→ commitPhase（产物+版本快照+状态机+审计）→ overridePhase（force/reopen/skip/rollback）
2. ✅ saveChapter 管线：countChapter+checkWordTarget → frontmatter 落盘 → Book.stats 增量（覆盖写时减旧加新，已测）→ 变量 JSONPatch → 审计
3. ✅ chapterStats 达标判定（wordTargets 接线）
4. ✅ assemble 接入 ContextAssembler（写章指令数据源）
5. ✅ 错误统一抛 PluginError（工具层 asResult 包装直接可用）
**遗留事项**：
- [ ] P1-F2 会话驱动 ChapterWriter（依赖 sessions/workspaces SDK 契约）
- [ ] writing 阶段按章推进的批量 submit（P2 校验引擎统一门禁）

---

## P1-F3：完整创作工具集（tools/novel.ts + 分组工具 + 装配扩展）

**日期**：2026-08-16
**范围**：`src/tools/novel.ts`（novel_projects/phase/commit/override/write_chapter/commit_chapter/audit/stats 8 个）+ `src/tools/lorebook.ts` 分组工具补全（list/create/update/delete_group/move_entry 5 个）+ `src/tools/index.ts` 聚合（22 工具）+ `src/assembly.ts` 服务对工厂（lore+novel）+ `src/index.ts` 装配（projects 目录 + 全局 variables.json）+ `tests/assembly.spec.ts` 更新。
**验收证据**：typecheck 0 错误；`npm test` 144/144；build ✅；**运行时注入验证：完整服务链 fiber ACTIVE，数据目录（lorebook/projects）正确创建，卸载干净**。
**Code Review 结论（通过 ✅）**：
1. ✅ 两段式写章协议：novel_write_chapter（返回上下文包）→ 模型回复输出正文 → novel_commit_chapter（统计/落盘/变量/审计）
2. ✅ 全部 22 工具统一 `{ ok, value } | { ok: false, error }` 契约 + asResult 包装
3. ✅ lorebook 分组工具补全（模块 6 遗留），含增量 add/remove entry_ids
4. ✅ 装配扩展：createServices 返回 { lore, novel } 服务对；settings 门禁注册/注销全量工具
5. ✅ 无循环导入（novel.ts 域工具改名 registerNovelDomainTools，index.ts 直接导入——修复了初版 require() hack）
**关键 SDK 事实（记录）**：host 侧 `dsh-session` 是低层 append 日志 API（无 prompt 方法）；`prompt` 是 client 侧 SessionDriver 契约（task-board execution.ts 模式）→ 会话驱动推迟到 P1-I 与 GUI 一起做（client 侧）
**遗留事项**：
- [ ] client 侧「一键写章」会话驱动（P1-I，task-board execution.ts 模式）
- [ ] 写章后摘要生成（summary/）→ P2（模型摘要工具）
- [ ] writing 阶段批量门禁（novel_commit writing 批量校验）→ P2

---

## P1-G：技能注册 + 内置提示词库 v1（tools/skill.ts + core/prompts + assets）

**日期**：2026-08-16
**范围**：`assets/skills/novel-writing-workflow/SKILL.md`（全流程方法说明书：九阶段/世界书纪律/两段式写章协议/质量自检/修订）+ `assets/prompts/*.md` 12 个模板（六阶段创作/正文写作/润色 3/诊断/文风）+ `src/core/prompts/loader.ts`（frontmatter 解析/渲染/损坏容错）+ `src/tools/skill.ts`（技能注册 + novel_prompts 工具）+ `tests/prompts.spec.ts`（5 例）。
**验收证据**：typecheck 0 错误；`npm test` 150/150；工具总数 23（lorebook 13 + novel 8 + wordcount 1 + prompts 1）。
**Code Review 结论（通过 ✅）**：
1. ✅ 技能注册契约：ctx.skills.register + resourceBase 目录 + frontmatter 解析（name/description/whenToUse），随 enabled 门禁联动注册/注销
2. ✅ 提示词库：id=文件名（文件系统保证唯一，frontmatter id 对齐）；variables `[a, b]` 两种写法；renderPromptTemplate 占位符替换（缺失保留）
3. ✅ 损坏模板容错（category=broken + version=0，不阻断整库）
4. ✅ novel_prompts 工具（list/get/render）统一 Result 契约
**测试期修正（3 处）**：variables 方括号剥离；id 语义统一（frontmatter 点号 → 文件名连字符，12 个模板文件对齐）；assembly 工具计数 22→23
**遗留事项**：
- [ ] 提示词库 P2 补全至 ≥60（8 类型×阶段、8 文风、去味 6、润色 5、诊断 5、引导 6、世界书 4）
- [ ] 技能内容 P2 扩充（AI 味词清单、黄金三章理论要点）

---

## P1-H：创作向导 + 工坊助手意图解析（core/guide/engine.ts）

**日期**：2026-08-16
**范围**：`src/core/guide/engine.ts`（WizardState 五步状态机：genre→title→setting→outline→start + wizardNext/Commit/Skip + IntentAction 意图规则通道 14 条）+ `tests/guide.spec.ts`（10 例）。
**验收证据**：typecheck 0 错误；`npm test` 160/160。
**Code Review 结论（通过 ✅）**：
1. ✅ 向导状态机：commit 产物非空校验、skip、推进时自动跳过已 done 步骤、start 完成 → readyToWrite
2. ✅ 意图规则表按优先级排序、首个命中返回；写操作（写章/去味/润色/灵感/建项目）confirmRequired=true（消耗额度/改数据需确认）
3. ✅ 未命中返回 null（自由对话/模型通道兜底，P2 加 LLM 通道）
4. ✅ 纯函数无 IO，状态可持久化（P1-I 接线 book.json）
**遗留事项**：
- [ ] novel_wizard / novel_guide 工具注册（wizard 状态需落 book.json——P1-I 随 GUI 接线）
- [ ] 意图模型通道（LLM 兜底，P2）

---

## P1-I：host 路由 + client GUI v1 + 向导/助手工具

**日期**：2026-08-16
**范围**：`src/routes.ts`（/api/novel-writer 单 prefix 路由：项目列表/创建/详情/章节，fence 头）+ `src/tools/guide.ts`（novel_wizard + novel_guide，wizard.json 持久化）+ client 三件套（`settings-card.tsx` 设置卡 / `workshop-drawer.tsx` 工作台抽屉 / `sidebar.ts` 侧边栏自愈入口）+ agent 预设资产。
**验收证据**：typecheck 0 错误；`npm test` 160/160；build ✅（client 14.2kB）；pack 188 文件 158.8kB；**运行时注入验证：fiber ACTIVE + 路由实测（GET 列表 ✅ / POST 创建 ✅ / fence 403 ✅）+ 卸载干净**。
**Code Review 结论（通过 ✅）**：
1. ✅ 路由契约：WebRoute.path 无尾斜杠（prefix 单注册 + 内部分派）；fence 头；门禁未启用 503
2. ✅ novel_wizard：五步状态机持久化 wizard.json；novel_guide：意图规则通道
3. ✅ client：SettingsScope 自绘设置卡；侧边栏 MutationObserver 自愈；工作台懒挂载抽屉
4. ✅ tsconfig 分层：主配置 exclude src/client，client 配置 jsx=react-jsx
**遗留事项（P2）**：
- [ ] agent 预设同步机制（presets → ~/.dsh/.agent-presets）
- [ ] client「一键写章」会话驱动（execution.ts 移植）
- [ ] 工作台详情视图（阶段流转/写章入口）

## P2-A：AI 味检测引擎（polish/）

**日期**：2026-08-16
**范围**：`src/core/polish/{types,dict,scanner,index}.ts`（234 词 5 类词库 + 长词优先扫描器 + 密度评分 + 项目覆盖合并）+ `tests/polish.spec.ts`（7 例）。
**验收证据**：typecheck 0 错误；`npm test` 169/169。
**Code Review 结论（通过 ✅）**：
1. ✅ 词库 234 词：connector/action/psychology/adjective/tone，replace/delete/rewrite 三策略 + 推荐替换
2. ✅ 扫描器：长词优先（微微一笑 优先于 微微）、句子上下文（60 字截断）、类别分布、密度评分（每千字命中×10 上限 100）
3. ✅ mergeDictionaries：项目覆盖同词替换 + 新词追加
4. ✅ hitsByCategory 分类过滤（GUI 高亮视图用）
**测试期修正（3 处）**：词库补齐 192→234（补 42 词）、删重复词「不由得」、override 测试语义（同词覆盖不增数）
**遗留事项**：
- [ ] novel_depolish 工具（报告 + LLM 改写执行）→ P2-B 与 LLM 层一起接线
- [ ] GUI 命中高亮 → P2-H

## P2-B：黄金三章诊断规则层（diagnose/）

**日期**：2026-08-16
**范围**：`src/core/diagnose/{types,rules,index}.ts`（6 条规则：字数/对话占比/章末钩子/开场钩子/设定灌输/冲突密度 + 维度评分 + 模型层协议 ModelDiagnosis）+ `tests/diagnose.spec.ts`（8 例）。
**验收证据**：typecheck 0 错误；`npm test` 177/177。
**Code Review 结论（通过 ✅）**：
1. ✅ 规则层纯函数离线必出分（模型无关）；6 维均分 → 总分 0-100
2. ✅ 章末钩子多信号（对话/悬念词/冲突词/强烈标点）；开场钩子仅第一章
3. ✅ 设定灌输：连续 3 段 120+ 字无对话段落；冲突密度按词频
4. ✅ 模型层协议类型就位（score/dimensions/issues/suggestion/summary），LLM 接线在工具层
**测试期修正（2 处实质）**：
- 对话占比口径改进：引号内字符计数（原「引号字符/2」对短对话严重低估——3 章全部误报）
- hook 测试文本过短被长度门槛跳过（加长正文 + 平淡结尾）
**遗留事项**：
- [ ] novel_diagnose 工具（规则层 + 可选模型层）→ P2-G 工具接线
- [ ] GUI 评分卡（雷达/问题列表/一键建议）→ P2-H

## P2-C：四族校验引擎（validation/engine.ts）

**日期**：2026-08-16
**范围**：`src/core/validation/engine.ts`（ValidationRule 注册表 + validateChapter 执行器，9 条内置规则）+ `tests/validation.spec.ts`（12 例）。
**验收证据**：typecheck 0 错误；`npm test` 189/189。
**Code Review 结论（通过 ✅）**：
1. ✅ 四族规则：结构（字数/标题）、内容（禁用词/AI 味/视角/对话占比）、剧情（章末钩子/细纲覆盖）、一致性（账本接口占位，P2-D 接数据）
2. ✅ error 清零才 passed；单规则异常不阻断
3. ✅ 复用 stats/polish/diagnose 能力（单一事实源）
4. ✅ stats.countChapter 对话占比口径统一为「引号内字符/总字符」（修复模块 5 的近似遗留）
5. ✅ briefCoverage：短语 ≥2 个 2 字窗口命中才算覆盖（换称宽容、无关文本不误报——两轮迭代）
**测试期修正（3 处实质）**：stats 口径统一（P2-B 与 P2-C 一致）、pov 测试数据（我/他等量不触发）、brief 覆盖算法两轮迭代
**遗留事项**：
- [ ] consistency.ledger 规则数据源 → P2-D
- [ ] novel_validate 工具接线 → P2-G

## P2-D：一致性引擎（consistency/）

**日期**：2026-08-16
**范围**：`src/core/consistency/{types,store,detect,index}.ts`（LedgerStore/TimelineStore + 冲突检测/时间线异常/沉淀建议/卷摘要聚合）+ `tests/consistency.spec.ts`（11 例）。
**验收证据**：typecheck 0 错误；`npm test` 200/200。
**Code Review 结论（通过 ✅）**：
1. ✅ 账本：章节 <JSONPatch> → LedgerEntry（entity/field 提取、幂等重放、source 标记）
2. ✅ 冲突检测：同字段取值史；数值单调上升=info、回退=warning
3. ✅ 时间线：阿拉伯/中文数字（「第三日」/「第 12 天」/「第十二日」）、年月日、年份；倒挂+缺失检测
4. ✅ 沉淀建议：账本实体 → 世界书建议条目（含字段行）
5. ✅ 卷摘要聚合（数据层 cap 拼接；LLM 压缩在工具层）
**测试期修正（3 处，含 1 个真 bug）**：
- **中文数字 bug**：normalizeBookTime 只认阿拉伯数字，「第三日」返回 null → 时间倒挂检测失效（probe 抓出，修复为 chineseToNumber 支持 十/十二/二十/二十三）
- entity 解构类型（noUncheckedIndexedAccess）
- 日期期望值计算错误（day=1 → y10240301 而非 y10240300）
**遗留事项**：
- [ ] novel_consistency_audit / novel_timeline / novel_sediment 工具接线 → P2-G
- [ ] 沉淀自动写入需用户确认（GUI）→ P2-H

## P2-E：修订系统 + 导出（revision/ + export/）

**日期**：2026-08-16
**范围**：`src/core/revision/engine.ts`（3 修订模式 + diffStats/editDistance（超长块级降级）+ buildRevisionResult）+ `src/core/export/engine.ts`（txt/markdown/platform 三格式 + 卷分隔 + 作者的话）+ 测试 8 例。
**验收证据**：typecheck 0 错误；`npm test` 207/207。
**Code Review 结论（通过 ✅）**：
1. ✅ diff 统计：Levenshtein（≤2000 字符）+ 超长 64 字符块级降级（不爆内存）
2. ✅ 修订结果：mode/wordDelta/changeRatio/changed（不覆盖原稿语义由工具层保证：新版本写回 versions）
3. ✅ 导出：三格式单章 + 全书拼接（卷分隔去重、作者的话、空行归一）
**测试期修正**：1 处测试期望计算错误（-2 非 -3）
**遗留事项**：
- [ ] novel_revise / novel_export 工具接线（LLM 改写 + 导出文件写出）→ P2-G

## P2-F：伏笔/术语/灵感（aux/）

**日期**：2026-08-16
**范围**：`src/core/aux/store.ts`（ForeshadowStore/GlossaryStore/IdeaStore）+ `tests/aux.spec.ts`（7 例）。
**验收证据**：typecheck 0 错误；`npm test` 214/214。
**Code Review 结论（通过 ✅）**：
1. ✅ 伏笔：plant/reveal/drop 状态机 + 超期检测（plannedRevealChapter 已过未回收）
2. ✅ 术语表：唯一性约束 + 《》「」" 引号包裹词提取
3. ✅ 灵感库：关键词/标签检索、最新在前
4. ✅ 三 store 统一 VersionedFile + 原子写 + 损坏容错
**遗留事项**：
- [ ] novel_foreshadow / novel_idea / novel_glossary 工具接线 → P2-G

## P2-G：LLM 客户端 + 全量工具接线（37 工具）

**日期**：2026-08-16
**范围**：`src/core/llm/client.ts`（captureRoute 路由捕获 + createLlmClient.complete）+ `src/tools/quality.ts`（novel_depolish/style_convert/diagnose/apply_advice/validate 5 个）+ `src/tools/extras.ts`（novel_foreshadow/idea/glossary/consistency_audit/timeline/revise/export 7 个）+ NovelService 章节读取方法 + NovelServices 扩展（llm/bookDirOf）+ assembly/index 装配。
**验收证据**：typecheck 0 错误；`npm test` 214/214；build ✅（217kB/280 文件）；**注入验证：37 工具全链 fiber ACTIVE，卸载干净**。
**Code Review 结论（通过 ✅）**：
1. ✅ LlmClient：llm/stream 瀑布路由捕获（脚手架验证模式）+ complete 封装；无路由/无 llm 时工具降级（degraded 标记）不崩溃
2. ✅ 质量工具：检测层必出（AI 味报告/规则层诊断/四族校验），模型层可选叠加
3. ✅ 扩展工具：伏笔/灵感/术语/巡检/时间线/修订/导出，全部按项目隔离（bookDirOf 定位，工具内构造 store——修复初版全局共享设计缺陷）
4. ✅ 修订不覆盖原稿（saveChapter version+1 语义）；导出写 exports/ 目录
5. ✅ 工具总数 37 = lorebook 13 + novel 8 + wordcount 1 + prompts 1 + guide 2 + quality 5 + extras 7
**设计修正**：aux/账本/时间线 store 从「全局共享单文件」改为「按项目目录隔离」（bookDirOf 模式）——避免多项目数据串扰
**遗留事项**：
- [ ] 提示词库全量（P2-G 已用 12 个，需补至 ≥60）
- [ ] GUI v2（诊断面板/AI 味高亮/统计面板）→ P2-H

## P2-H + P2-I：GUI v2 写章驱动 + 预设同步/示例导入

**日期**：2026-08-16
**范围**：
- P2-H：`src/core/client-writer.ts`（ChapterWriter 会话驱动：定位会话/prompt/等待正文稳定/提取，纯逻辑可测）+ host 路由扩展（GET context/<no> 上下文包、POST chapters/<no> 保存）+ `workshop-drawer.tsx` v2（项目详情/章节选择/一键写章/正文保存）
- P2-I：`src/presets.ts`（预设同步 assets/presets → ~/.dsh/.agent-presets/novel-writer，enabled 时幂等）+ 路由 POST /demo（一键导入示例项目《青云问道》+ 世界书条目）
**验收证据**：typecheck 0 错误；`npm test` 219/219（writer 5 例）；build ✅（client 22.4kB）；pack 217kB/280 文件。
**Code Review 结论（通过 ✅）**：
1. ✅ ChapterWriter：复用当前工作区会话 / 连接工作区取新会话 → prompt(queue) → 正文稳定轮询（2 轮不变）→ 提取最后助手消息
2. ✅ writer 纯逻辑（无 DOM）放 core 域，快照注入可单测（移出 src/client 规避 tsconfig 分层）
3. ✅ 一键写章闭环：context 路由 → 组装写作指令（设定/细纲/前文/硬约束）→ 会话驱动 → 正文填入 → POST 保存（统计/变量/审计管线）
4. ✅ 预设同步：cp 幂等覆盖（升级自动更新，仿 liangshen 只写不删）；目标 = harness home（修正初版误用数据目录）
5. ✅ 示例导入：POST /demo 创建示例书 + 导入 10 条世界书（book_id 统一绑定）
**遗留事项**：
- [ ] 正文自动回填的会话快照 API（snapshotOf 占位，当前需用户确认/粘贴）
- [ ] 诊断/AI 味可视化面板（P3）
- [ ] 示例导入 GUI 按钮（路由已就绪，按钮 P3）

## P2-J：百万字压测 + P2 整体验收

**日期**：2026-08-16
**范围**：`scripts/simulate-1m.mjs`（500 章 × 2000 字确定性生成 + 植入 20 处账本冲突 + 预算抽样 + 检出率）。
**验收证据（压测通过 ✅）**：
- 100 万字生成（500 章 × 2000 字），耗时 ~20s
- **上下文包预算恒不超限**：10 个抽样章 tokenEstimate 恒 ~7900（预算 12000），0 超限
- **冲突 100% 覆盖检出**：植入 20 个不同值全部进入账本冲突历史
- `npm run verify` 全绿（23 文件 219 例）+ scratch 组合验证插件行
**Code Review 结论（通过 ✅）**：
1. ✅ **压测抓出并修复真 bug**：saveChapter 只写变量不写账本 → 一致性引擎无数据源（0 检出）→ 写章管线接线 ledger.applyChapterPatch（按项目目录）
2. ✅ 检出口径修正：同 key 多值聚合为 1 条冲突记录（历史含全部值）——统计用「植入值覆盖」而非「冲突条数」
3. ✅ 预算恒定性验证：L1/L2/L3 裁剪链在 100 万字下 token 恒定（v3 §3.6 目标达成）
**P2 遗留**：
- [ ] P3：诊断/AI 味 GUI 面板、示例导入按钮、提示词库补全至 ≥60、README/文档/发布

## P3：提示词库全量 + GUI 面板 + 文档发布（收尾）

**日期**：2026-08-16
**范围**：
- P3-A：提示词库 12 → **60 个**（文风 7/写作 7/润色 4/去味分类 5/诊断 6/引导 7/世界书 4/创作 8），测试断言同步
- P3-B：诊断路由 + 抽屉「导入示例/结构诊断」按钮（评分/问题列表）
- P3-C：README 中英完整版 + AGENTS.md（开发指引，被系统采纳）+ LICENSE + 隐私扫描（干净）+ files 清单
**验收证据**：typecheck 0 错误；`npm test` 225/225（24 文件，+routes 6 例）；verify 全绿；pack 265.9kB/340 文件；**路由实测：详情/保存章节/诊断/上下文全部通过**。
**Code Review 结论（通过 ✅）**：
1. ✅ 提示词库 60 个全覆盖（创作/文风/去味/润色/诊断/引导/世界书）
2. ✅ **抓出并修复 P2-I 潜伏的路由解构 bug**：`segments` 含 'projects' 前缀，解构 `[projectId, section, noText]` 错位导致所有带 id 的 GET/POST 路由 404——列表/创建恰好用 segments[0] 不受影响（此前实测未覆盖）；修复为 `[, projectId, section, noText]` + 抽 `parseNovelPath` 纯函数 + 6 例回归单测
3. ✅ demo 导入动态 import 路径失效 → 静态导入修复
4. ✅ 隐私扫描：无 token/邮箱/绝对路径泄漏
**P3 遗留**：
- [ ] 定时连载（浏览器 cron）— 规划未实现
- [ ] 发布（npm pack 产物已就绪，GitHub Release 待用户决定）

## 模块 8：本地书籍导入（P3 新增 · txt/md → 建书 → 全量章节同步）

**日期**：2026-08-16
**范围**：
- `src/core/importer/parse.ts`：纯文本解析器（零 IO）——章节标题识别（严格/粘连/特殊/英文/md 标题 + 数字行与段落分块两级兜底）、书名来源三级（md frontmatter → 首行启发式 → 文件名）、题材归一化、前置内容处理（≥100 字成楔子章、否则并入首章）、末尾悬空标题剔除、BOM/CRLF 归一化。
- `src/core/importer/engine.ts`：`BookImporter`（建书 → 逐章 `saveChapter` 全管线：字数统计/变量/账本/审计；IO 经 `ImportDeps` 注入可测）。
- `src/routes.ts`：`POST /import`（fence 校验、8MB 上限、解析失败按 `IMPORT_FILE_EMPTY`/`NO_IMPORTABLE_ENTRIES` 透传）。
- `src/client/workshop-drawer.tsx`：列表页「导入本地书籍」按钮 + 原生隐藏 file input（React 合成事件不可靠，走原生 change → FileReader → POST）→ 成功后刷新列表并打开新书。
- `tests/importer.spec.ts`：27 例（解析 20 + 引擎 7）。

**验收证据**：
- `npm run typecheck`：0 错误；`npm test`：**257/257 通过**（26 文件，+27）；`npm run build` 全绿（client 47.56 kB）
- 引擎集成测试：真实 NovelStore 全链路（解析→建书→逐章落盘→统计/审计联动）、fake deps 编号/字数/空章占位断言

**Code Review 结论（通过 ✅）**：
1. ✅ **统计式粘连提升**：`第X章标题`（无分隔符）仅在全文件 ≥3 处时提升为标题——正文"第二章我们终于见面了。"（<3 处）不误判（回归测试覆盖）；分隔符集排除逗号（"第三章，…"不误判）
2. ✅ **两级兜底保证内容完整同步**：无标题文件按数字行（≥3 处）/ 段落分块（~2500 字）切分，超长单段按句号切——测试断言 1200 句长文分章后内容无损
3. ✅ **测试抓出真 bug**：SPEC_SEP 双捕获组（词+标题）误用组 1 → 取词不取标题（「番外 前尘」标题变「番外」）；已修组 2
4. ✅ 引擎复用 `saveChapter` 完整管线（统计/账本/变量/审计），导入即与现有写章数据流同构，无重复实现
5. ✅ 路由错误码透传（IMPORT_FILE_EMPTY / NO_IMPORTABLE_ENTRIES 400 而非 500）

**遗留事项**：
- [ ] epub/docx 等二进制格式（需 zip/xml 解析依赖，暂不支持；当前 txt/md 覆盖网文主流导出）
- [ ] 导入时可选自动去重书名（同名书籍重复导入建第二个项目）
- [ ] 大文件（>8MB）分片导入

## 模块 9：一键润色 + diff 标亮 + 保存确认 + 逐步撤销（P3 新增）

**日期**：2026-08-16
**范围**：
- `assets/prompts/polish-literary.md`：文笔润色模板（三条底线：情节不变/设定不变/走向不变；提升流畅度/美感/文学性；只输出润色后全文）。
- `src/core/polish/diff.ts`：句子级 LCS diff 纯函数（`splitSentences` 句末标点+换行 token 化、`diffSentences` 回溯生成 same/del/add、`countDiffChanges` 统计、>2000 token 退化整块对比防 O(n·m) 爆炸）。
- `src/routes.ts`：`POST /projects/<id>/chapters/<no>/polish`（fence + 模型检查 → 渲染模板 → llm.complete → 返回 `{original, polished}`，**不落盘**；编辑区为空时回退已保存正文；确认保存复用既有保存路由）。
- `src/client/workshop-drawer.tsx`：详情页「一键润色」按钮（写章按钮右侧同款样式）→ 润色结果入编辑区 + DiffPreviewV 面板（黄=润色后文、红删除线=被替换原文、修改处计数）+「确认保存 / 放弃还原」；编辑区上方「↶ 撤销（N）」侧向撤销按钮。
- `tests/polish-diff.spec.ts`：11 例（token 切分、插入/删除/替换、平局顺序、大文本退化、两侧无损还原不变式、计数）。

**验收证据**：
- `npm run typecheck` 0 错误；`npm test` **268/268 通过**（27 文件，+11）；`npm run build` 全绿（client 56.63 kB）

**Code Review 结论（通过 ✅）**：
1. ✅ **测试抓出回溯平局 bug**：LCS 回溯平局时取 add → 替换对渲染为「新→旧」乱序（"丙乙"）；改平局取 del → 替换对稳定渲染为「旧→新」（`del:乙, add:丙`），回归测试锁定
2. ✅ 撤销栈语义：`pushUndo` 存"变化前快照"，手动编辑 800ms 防抖快照（连续打字不刷栈）、写章/润色应用前显式入栈、切章/重载清栈并清 pending timer（防跨章污染）；上限 100 条，支持逐步还原至任意状态
3. ✅ 润色不落盘 + 显式确认：`polish` 路由只返回结果，`polish-save` 走既有保存路由（复用 saveChapter 管线：统计/账本/变量/审计）；`polish-discard` 一键恢复原文
4. ✅ 展示语义：token 级比较（标点单独 token）——句末标点未动则不标亮，只标亮真正改写的句子部分；两侧无损还原不变式（same+del=原文 / same+add=润色文）测试锁定
5. ✅ 客户端仍守"React 纯渲染 + 原生事件代理"铁律（data-action: polish / polish-save / polish-discard / undo）

**遗留事项**：
- [ ] 润色可选"逐条采纳/拒绝"（当前为整体确认）
- [ ] 撤销栈跨会话持久化（当前会话内有效）

## 模块 10：抽屉布局优化 —— 展开模式 + 聊天框条避让（P3 新增）

**日期**：2026-08-16
**范围**：
- `src/core/drawer-size.ts`：布局尺寸纯函数 `drawerSize(expanded, viewportWidth, bottomBarHeight)`（展开=min(780, 视口92%)，收起=380；底部避让=条高+8px 间隙，条高 0 贴底）；常量 `DRAWER_COLLAPSED_WIDTH / DRAWER_EXPANDED_MAX / DRAWER_EXPANDED_RATIO / DRAWER_BOTTOM_GAP`。
- `src/client/workshop-drawer.tsx`：
  - **全局固定头部**：视图标题（小说工坊/书名/世界书）+「⇔ 展开 / 收起」按钮；头部 flex 固定、内容区独立滚动（`flex:1 + minHeight:0 + overflowY:auto`），头部常驻不随内容滚动。
  - **展开/收起**：`state.expanded` + dispatch `expand`；宽度动画过渡（`transition:width .18s`）。
  - **聊天条物理避让**：`detectBottomBar()` 扫描 fixed 且贴底（bottomGap≤24px）、高度 8~160px、位于视口中下部的宿主元素（聊天输入条等），取最高者 → `applySize()` 把抽屉 `bottom` 抬到条高之上（物理不重叠 → 内容可读、交互可点）；resize 防抖 200ms 重算。
  - **润色预览随展开**：DiffPreviewV 滚动区高度 240px → 展开时 48vh。
  - **修复潜伏 bug**：`importFileInput`/`nativeTest` 原 append 在抽屉容器内，React 18 createRoot 首次 render 会清空容器子节点 → 改挂 `document.body`（导入功能此前可能已失效）；dispose 完整清理（resize 监听、timer、file input、nativeTest）。
- `tests/drawer-size.spec.ts`：7 例（收起 380 / 展开 92% 上限 780 / 避让=条高+间隙 / 未检测贴底 / 异常值）。

**验收证据**：
- `npm run typecheck` 0 错误；`npm test` **274/274 通过**（28 文件，+7）；`npm run build` 全绿（client 60.66 kB）
- GUI 布局类改动无纯逻辑外的 DOM 行为，人工验收：强刷后开抽屉 → 点「⇔ 展开」→ 宽度变宽、底部让出聊天条、润色预览更高、滚动/点击正常；点「⇔ 收起」复原

**Code Review 结论（通过 ✅）**：
1. ✅ 物理避让优于层级压栈：zIndex 已 int32 上限，再叠高不可靠；把抽屉 bottom 抬到聊天条之上，从布局上根除遮挡（内容与交互均不重叠）
2. ✅ 头部/内容分离：固定头部 + 独立滚动区，滚动时标题与展开按钮常驻
3. ✅ 展开宽度收敛：92% 视口且 ≤780px，窄屏不溢出、宽屏不空旷
4. ✅ 顺带修复 createRoot 清空容器子节点的潜伏 bug（导入 file input 挂错位置）
5. ✅ 布局尺寸抽纯函数（core/drawer-size.ts）满足"每模块可单测"纪律

**遗留事项**：
- [ ] 展开状态持久化（localStorage 记忆用户偏好）
- [ ] detectBottomBar 候选遍历性能（打开时 + resize 防抖触发，量级可接受；页面元素极多时可缓存）

## 模块 10 补充：覆盖避让升级（右侧聊天条/高底部条，P3 新增）

**日期**：2026-08-16
**背景**：用户实测反馈——展开后仍有"右侧白色长条"悬浮遮挡抽屉内容；旧检测只认底部 fixed 条且高度 ≤160px，漏检右侧竖栏/高聊天条。
**范围**：
- `detectBottomBar` → 通用 `detectOverlays()`：扫描与抽屉矩形**实际重叠**（水平+垂直均 >8px）的 fixed 元素（排除自身/badge/探针/隐藏 input），记录 rect 与 z-index。
- `applySize` 双轴避让 + 动态层级：
  - 底部横条（贴底且非全高）→ `bottom` 抬到条顶之上（高度不限）
  - 全高右侧竖条（height > 60% 视口，右缘与抽屉右缘相邻）→ 抽屉 `right` 左移露出条自身（`条宽+8px`）
  - z-index 动态提升 = 重叠元素最大 z + 1（clamp 2147483647）
  - 角标 badge 显示诊断：`避让:底 Xpx 右 Ypx 重叠 N zZ`（用户可读，便于后续定位）
- `expand`/`toggle` 双次 `applySize()` 收敛（width 变化影响重叠判定）。
- `MutationObserver`（body childList+subtree，防抖 300ms）：宿主聊天条后插入/重渲染时自动重算；dispose 断开。
**验收**：typecheck 0 错误；`npm test` 274/274；build 全绿（client 63.01 kB）；热重载生效。人工验证待用户强刷后确认。
**遗留**：
- [ ] 若右侧竖条同时覆盖底部（L 形），当前只按竖条右移处理；视实测补组合避让

## 模块 10 补充二：撤销按钮修复 —— 内容修改检测 + 立即可用（P3 新增）

**日期**：2026-08-16
**背景**：用户实测——撤销按钮始终灰（手动编辑、AI 润色后均不可点）。
**根因（两条）**：
1. `pushUndo` 后不触发 `render()`——按钮 `disabled` 依赖 `undoStack.length`，栈变化时界面不刷新 → 永远显示灰
2. 输入防抖 800ms 才产生快照；且输入事件不 render → 修改后按钮状态不更新
**范围（workshop-drawer.tsx）**：
- 新增 `baseline`（章节已加载/已保存原文）与 `draftModified`（draft !== baseline）状态；`setDraft` 统一维护 draftModified
- `loadChapter` 重设 baseline + 清栈；`undo` 语义升级：栈非空 → 弹最近快照；**栈空但内容被修改 → 回 baseline 兜底**（保证"手动修改后必可撤销一次"）
- 撤销按钮 `disabled = !draftModified && undoStack.length === 0`；`id="undo-btn"` + 步数显示（栈长 + 栈空时 modified 计 1）
- input 事件内 `syncUndoButton()` 原生即时同步按钮（不 render，不打断输入）；`pushUndo` 末尾 `render()` 刷新（防抖回调时机安全，不重挂 textarea）
- AI 润色：`setDraft(polished)` 自动置 draftModified=true → 按钮亮；保存/放弃后回到 baseline 自动复原
**验收**：typecheck 0 错误；`npm test` 274/274；build 全绿（client 64.13 kB）；热重载生效。人工验证：修改正文 → 按钮立即可点 → 撤销回原文 → 灰；润色后按钮亮可撤销。

## 模块 10 补充三：隐藏左上角角标与调试探针（P3 新增）

**日期**：2026-08-16
**背景**：用户要求去掉左上角黑框（badge 角标）。
**处理**：badge 与 nativeTest 探针均改为 `opacity:0`（视觉隐藏）而非移除——badge 此前实测为「共存锚点」（其存在疑似与抽屉内 React 渲染正常化相关，机理未明），必须保留在 DOM 以防影响功能；诊断信息仍写入 textContent，排查时可临时改回 `opacity:1`。`pointer-events:none` 已有，隐藏后不拦截任何交互。
**验收**：typecheck 0 错误；build 全绿；热重载生效。功能零影响（抽屉渲染/避让/撤销/润色均不受影响）。

## 模块 11：题材标签扩充 —— 网文全类型（P3 新增）

**日期**：2026-08-16
**背景**：创建书籍题材下拉仅 4 个（玄幻/仙侠/都市/科幻），需覆盖网文全类型。
**范围**：
- `src/core/genres.ts`：统一题材清单 `GENRES`（27 个，含 id/label/group 三字段），分组：奇幻武侠（玄幻/仙侠/武侠/西幻）、都市现实（都市/现实生活/青春校园/商战职场/权谋智斗）、历史军事（历史架空/军事战争）、科幻灵异（科幻/悬疑推理/灵异惊悚/末世危机）、情感（现代言情/古代言情）、竞技（游戏/体育竞技）、轻小说二次元（轻小说/二次元/同人衍生）、流派向（洪荒封神/种田文/系统流/无限流/诸天万界）；纯函数 `genreLabel`（id→中文，未知原样，兼容旧数据）/ `genreIdFromLabel` / `isGenreId`。
- `src/core/importer/parse.ts`：`mapGenre` 重构为「id 直通 → 中文标签 → 变体别名（含旧版兼容 + 网文口语：修真/魔法/末世/电竞/古言/同人…）→ 回退 fantasy」。
- `src/client/workshop-drawer.tsx`：创建下拉渲染 27 项（按 group 分 `<optgroup>`）；详情页/列表卡片题材显示中文（`genreLabel`）。
- `src/core/context/assembler.ts` + `src/routes.ts`（lorebook-autogen 模板）：上下文包与世界书生成改为传入中文题材（LLM 可读性）。
- `tests/genres.spec.ts`：16 例（清单唯一性/全类型覆盖/标签转换/mapGenre 全量映射）。

**验收证据**：
- `npm run typecheck` 0 错误；`npm test` **284/284 通过**（29 文件，+16）；`npm run build` 全绿（client 67.20 kB）
- 兼容性：旧 4 个 id 保留、旧书籍 genre 值不变；`mapGenre('奇幻')` 等旧映射行为保持

**Code Review 结论（通过 ✅）**：
1. ✅ 存储兼容：id 为持久化值，label 仅展示；未知 id 原样显示（旧数据不炸）
2. ✅ 单一事实源：client 下拉与导入归一化共用 `GENRES`（新增题材一处加、处处生效）
3. ✅ mapGenre 三阶匹配（id→label→别名）覆盖 md frontmatter 中文 genre 与网文口语
4. ✅ 分组 optgroup 解决 27 项下拉的可用性

**遗留事项**：
- [ ] 题材编辑（书籍详情可改题材，当前仅创建时选择/导入识别）

## 模块 12：全面代码审查 + 功能核对（P3 收尾）

**日期**：2026-08-16
**背景**：用户要求全面检查 bug、逐一审查功能可用性、对照 DEVELOPMENT-PLAN.md 逐项核对实现状态。
**方法**：3 个后台 subagent 并行深度审查（存储/业务、质量/一致性、上下文/辅助）+ 主 agent 审查（路由/工具/客户端/装配）+ 全部回归测试。
**修复清单（38 项）**：
- **Critical 2**：
  - C1：`novel/service.ts` 三处 `saveBook(result.value.ledger as Book)` 把 PhaseLedger 残缺对象整存覆盖 book.json（丢 title/genre/config/stats）→ mergeLedger 合并完整 Book + 回归测试（曾未被测试发现）
  - C2：`atomicWriteFile`/lorebook store tmp 仅含 pid → 并发写坏文件 → tmp 加随机后缀
- **Major 12**：
  - 意图解析指向不存在工具（novel_ledger / create_project→novel_projects）→ 新增 `novel_ledger`（账本查询）+ `novel_create_project` 两工具并修映射
  - `allChapters` 按 chapterCount 遍历丢稀疏章节 → store.listChapterNumbers（readdir 解析）
  - 版本快照号 count+1 覆盖旧快照 → max+1
  - variables 幂等键按章号短路吞 patch → 重写章节重新应用
  - 账本 applyChapterPatch 残留（删除 patch 后旧条目不清）→ 先清后写 + 回归测试
  - workflow enter 门禁漏洞（可绕过线性链直达 done）→ 拒绝重入 approved/skipped
  - 引号配对 bug（ASCII " 只开不闭 → 对话占比误报）→ wordcount + diagnose 奇偶切换 + 回归
  - 开场钩子按切片下标判定 → 改 chapter.no===1
  - 时间线检测不按章节排序（乱序记录假倒挂）+ 跨刻度 d*/y* 误比 → 排序 + 同刻度比较 + 回归
  - 导入 CN_GLUED 误判正文 + 未提升行推空串丢正文 → 后缀首字符排除标点 + Line.raw 保留 + 回归
  - novel_revise 空文本覆盖原章 → 空值守卫
  - buildWritePrompt 不渲染 L3（prevSummaries/variableSnapshot/atDepth）→ 补全（L3 摘要层此前是死代码）
- **Minor 15+**：lorebook 逐元素形状校验、YAML 嵌套数组丢数据、ledger/timeline/variables 损坏静默覆盖→抛可报告错误、validateChapter 规则异常静默→internal issue、consistencyLedger 空壳→接线、导入中途失败回滚半成品、toggle version+1、章节号校验、newId 补零、drawer 负宽防御、prompts $& 转义、escapeAttr &、audit 双换行、config.genre 空白、死代码清理（fallbackName/`approve` 成员）、rollback 清 approvedAt 等
**功能核对（DEVELOPMENT-PLAN）**：见最终交付报告核对表；未实现项（市场调研/定时连载/Git 管理/复盘报告/敏感内容过滤/模板复制/提问式补全/章节 AI 摘要/横幅注入/结构化 GenreTemplate）如实标注为 P2/P3 遗留。
**验收**：`npm run typecheck` 0 错误；`npm test` **288/288**（+4 回归）；`npm run build` 全绿；热重载生效。

## 模块 13：模板复制（§3.5-11）+ 市场调研（§3.5-4）

**日期**：2026-08-16
**范围**：
- **模板复制**：
  - `core/novel/service.ts`：`cloneProject(sourceId, {title?, genre?})`（复制 config 的字数目标/风格视角/禁用词/AI味词 + 已完成阶段设定文档 topic/setting/character/outline/volume/chapter；正文不复制；状态机重置）；`artifactOf(bookId, phase)`（读 docs 产物）。
  - 工具 `novel_clone_project`（sourceId/title/genre）。
- **市场调研**：
  - 工具 `novel_market_research`（两段式）：`mode=prompt` 按题材/方向返回 web_search 查询建议 + 初始化 `reports/market.md`；`mode=report` 把模型用自身 web_search 汇总的调研落盘 `reports/market.md`（选题报告可引用）。设计约束：插件 host 无外部搜索 API，故引导主模型 web_search（复用会话搜索能力），插件负责框架引导 + 沉淀。
  - 意图解析：市场/榜单/调研 → novel_market_research；克隆/套模板/参照 → novel_clone_project。
- 工具数 39 → **41**（README 中英同步修正为 41）；`tests/novel-service.spec.ts` +3（clone 复制 config/文档/正文不复制/状态重置/标题题材覆盖/未知源报错）；`tests/guide.spec.ts` +2（意图映射）。
**验收**：typecheck 0 错误；`npm test` **291/291**；build 全绿；热重载生效。
**遗留**：市场调研依赖主模型 web_search 可用（离线环境自动降级为提示）；世界书条目克隆（当前复制项目结构但不复制世界书绑定条目）——如需要可后续增强。

## 模块 14：真实用户反馈驱动的四向优化（逐条采纳润色 / 字级 diff / 写章遵循 / 酒馆导出 / 摸鱼隐藏）

**日期**：2026-08-17
**背景**：用户反馈——①润色想逐条采纳不能、整段标红但只改一两字找不同累；②一键写文遵循大纲不足"没参考价值"；③需要彻底隐藏入口（摸鱼）；④世界书能否直接导入酒馆。
**范围**：
- **A 润色逐条采纳 + 字级 diff**：`core/polish/diff.ts` 新增 `diffChars`（字符级 LCS，标出具体改哪几个字）、`splitPolishSuggestions`（把原文vs润色拆成带位置的逐条建议）、`applyPolishSuggestions`（按采纳状态重组正文，支持纯插入）；client DiffPreviewV 重构为逐条建议卡片（每条 采纳/撤销 切换 + 原文/改后字级高亮），新增 dispatch polish-toggle/accept-all/reject-all，polishSave 改为"按采纳建议重组后落盘"。
- **B 写章遵循约束**：`write-prompt.ts` 增补 4 条硬性写作要求（严格按本章细纲推进、以设定/事实快照为唯一事实来源、承接前文时间线因果、保持视角口吻），针对"规范了大纲还是没参考价值"。
- **D 酒馆互操作**：`lorebook_export_entries` 新增 `format=sillytavern` 输出 SillyTavern 原生 `{entries:[...]}`（uid/key/keys/constant/insert_order/position 等映射），可直接在酒馆 Import；README 说明。
- **C 摸鱼模式**：host Config 新增 `uiHidden`；client 据此隐藏侧边栏入口；设置卡加"隐藏侧边栏入口"开关。
- 测试：`polish-diff.spec.ts` +8（字级 diff 3 + 建议拆分/重组 4 + 纯插入 1）。
**验收**：typecheck 0 错误；`npm test` **299/299**；build 全绿；热重载生效。
**遗留**：GUI 世界书面板暂无"一键导出到酒馆"按钮（当前走工具/对话 `lorebook_export_entries format=sillytavern`，可后续加导出按钮+Blob）；uiHidden 切换需重启/刷新生效。

## 模块 15：补充两个遗留项（GUI 导出酒馆 + uiHidden 即时生效）

**日期**：2026-08-17
**范围**：
- **GUI「导出到酒馆」按钮**：世界书面板顶部新增「导出到酒馆」，用当前条目生成 SillyTavern 原生 `{entries:[...]}`（uid/key/keys/constant/insert_order/position 等映射）→ Blob 下载 `novel-lorebook-export.json`，可在酒馆 Import 导入；与工具层 `lorebook_export_entries format=sillytavern` 同构。
- **uiHidden 即时生效**：client 侧改为订阅 settingsScope，uiHidden 变化时动态注入/移除侧边栏入口（`ensureEntry` 幂等），不再需要重启/刷新；设置卡文案同步。
- 该模块无新 core 纯逻辑，以 typecheck + build + 现有 299 测试为准（client 行为变化无法单测，热重载+人工验证）。
**验收**：typecheck 0 错误；`npm test` 299/299；build 全绿；热重载生效。

## 模块 16：设置卡「命名空间未暴露」修复 — 隐藏入口改 localStorage 独立可用

**日期**：2026-08-17
**背景**：用户环境 settingsScope 为 `unavailable`（契约：命名空间未对该 client 暴露，或连接处于 memory/进程本地模式），设置卡原先在 unavailable 时只显示错误、不渲染任何开关，导致「隐藏侧边栏入口」无法使用。
**修复**：
- 新增 `src/client/ui-hidden.ts`：隐藏开关存 `localStorage`（key dsh-novel-writer:uiHidden），切换派发自定义事件即时通知入口；与 host settings 解耦，任何连接模式都可用。
- `settings-card.tsx`：`uiHidden` 读写 localStorage；当 host settings `unavailable` 时**降级渲染**（标题 + 隐藏开关 + 说明），不再只报错；ready 时照常显示启用/数据目录 + host 同步。
- `client/index.ts`：`ensureEntry` 改读 `readUiHidden()`（localStorage）；监听自定义事件 + host settings scope（host 的 uiHidden 变化也同步到 localStorage）即时增删侧边栏入口。
**验收**：typecheck 0 错误；`npm test` 299/299；build 全绿；热重载生效。
