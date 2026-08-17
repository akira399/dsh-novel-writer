# dsh-novel-writer 融合开发方案 v3：OperitForge「夏瑾小说工坊」能力移植 + 结构化创作流程 + 面向大众的开箱即用体验

> 本文档是 `dsh-novel-writer`（DSH 网络小说创作插件）的完整开发方案 **v3**（v1=九阶段流程，v2=夏瑾工坊移植，v3=大众化开箱即用）。
> 依据：GitHub 仓库 [zxhdhcp/OperitForge](https://github.com/zxhdhcp/OperitForge)（release 资产存储库）中
> 「夏瑾小说工坊」`com.operit.xiajin_novel_build` v0.6.0（对比 v0.5.0）的**逐文件源码分析**，
> 本工作区既有方案 [DEVELOPMENT-PLAN.md](./DEVELOPMENT-PLAN.md)（九阶段创作流程），
> 以及 v3 大众化需求（图形界面、开箱即用、内置提示词库、AI 味去除、黄金三章诊断、百万字一致性、章节字数统计、酒馆式对话引导）。
> 本文档 **只交付方案、步骤、依赖与环境说明，不执行实际开发**。

## 0.0 v3 目标定位（面向开源用户）

| 目标 | 验收表述 |
| --- | --- |
| **开箱即用** | 安装一条命令（`dsh plugin --profile web add github:<repo>`）；装完即带示例小说项目；零配置完成第一本书（默认值全可用） |
| **图形化** | 全部能力按钮化：侧边栏「小说工坊」+ 项目工作台 + 向导 + 报告可视化；非技术用户全程不接触命令行/JSON |
| **内置提示词库** | 随包分发 ≥60 个创作/优化提示词模板（文风、AI 味去除、润色、黄金三章诊断、九阶段创作、世界观生成）；GUI 可浏览/编辑/导出 |
| **质量增强** | AI 味自动检测与一键去除；黄金三章结构智能诊断与优化建议；文风自然化改写 |
| **百万字一致性** | 分层账本 + 增量摘要压缩 + 世界书自动沉淀 + 一致性巡检 + 时间线引擎，100 万字上下文恒在预算内且设定不漂移 |
| **章节字数自动统计** | 每章提交后自动统计（总字数/中文字符/对话占比/段落），达标徽标实时展示，全书/卷级统计面板 |
| **酒馆式引导** | 「工坊助手」对话式引导 + 意图解析（自然语言→工具调用）+ 快捷按钮流，新手 3 步教程 |

---

## 0. 分析结论（先说清仓库真相）

### 0.1 仓库性质

- `OperitForge` 是 **release 资产发布仓库**：`main` 分支只有一个 README，全部有效内容在 GitHub Releases 的 `.toolpkg` 附件中。
- 小说插件 = **「夏瑾小说工坊」**（display_name: 夏瑾小说工坊 / Xiajin Workshop），manifest 标识 `com.operit.xiajin_novel_build`，最新 **v0.6.0**（127,339 字节），另有 v0.5.0（83,512 字节）可对比演进。
- `.toolpkg` 是 **zip 归档**（schema_version 1）：`main.js` 入口 + `manifest.json`（subpackages 声明）+ 三组件源码 + README。
- **关键定性**：这是 **Operit 应用（安卓端 AI 写作/角色扮演宿主，SillyTavern 生态风格）的 ToolPkg 插件，不是 DSH（DeepSeek Harness）插件**。它的注入机制（`ToolPkg.registerSystemPromptComposeHook` / `registerPromptFinalizeHook` / `Tools.Files` / `Tools.Chat` / `/sdcard/...` 路径 / `compose_dsl` UI / `ToolPkg._m` 混淆）全部绑定 Operit 平台。
- 因此本方案的本质是：**把夏瑾小说工坊的「世界书(lorebook) + 提示词注入 + 变量渲染」能力按 DSH 插件架构重写移植，修复其缺陷，并与九阶段创作流程（DEVELOPMENT-PLAN.md）合并为 DSH 小说创作插件。**

### 0.2 仓库已有功能全景（v0.6.0 逐模块）

| 模块 | 文件 | 功能 |
| --- | --- | --- |
| 世界书 Plus | `worldbook/dist/main.js`（561 行） | 注入引擎：`systemPromptHook`（常驻条目注入系统提示词前后）+ `finalizeHook`（关键词命中条目注入 history/用户消息/末尾）；UI 路由 + 工具箱/侧边栏双入口 |
| 世界书服务 | `worldbook/dist/shared/worldbook_service.js`（783 行） | 条目 CRUD、分组 CRUD、角色卡绑定、导入解析（Operit 数组 / SillyTavern lorebook / 角色卡 character_book，含 5 类兼容性警告）、分组内条目移动/复制 |
| 世界书存储 | `worldbook/dist/shared/worldbook_storage.js`（121 行） | 文件读写：`/sdcard/Download/Operit/worldbook/{entries,groups,settings,variables}.json`，legacy 迁移 |
| 世界书变量 | `worldbook/dist/shared/worldbook_variables.js`（753 行） | 变量引擎：InitVar 条目 YAML 模板初始化、消息内 `<UpdateVariable>/<JSONPatch>` 增量应用（replace/insert/remove/delta/move + JSON Pointer + 受保护键）、8 类渲染宏 |
| 世界书工具 | `worldbook/dist/packages/worldbook_tools_plus_build.js`（650 行） | 13 个 agent 工具：条目 7（list/get/create/update/delete/toggle/import）+ 角色卡代理 1 + 分组 5（list/create/update/delete/move） |
| 世界书 UI | `worldbook/dist/ui/worldbook_manager/index.ui.js`（~92KB） | compose_dsl 单文件管理界面：条目列表/编辑表单/分组管理/JSON 导入/宏片段速查（CONTENT_SNIPPETS） |
| 提示词前 | `prompt/dist/*`（main 514 行 + service + storage + variables + tools + UI 88KB） | 独立存储 `/sdcard/Download/Operit/xiajin_prompt/`；条目+分组 CRUD；**不注册 Hook**（注入逻辑并入世界书 main.js，固定注入最前） |
| 提示词后 | `prompt_back/*`（v0.6.0 新增） | 同提示词前结构 + **自注册两个 Hook**，注入到最后面（独立 turn 追加，按 priority 升序）；工具加 `prompt_back_` 前缀 |
| 注入顺序 | 三组件装配 | `prompt[prepend] → worldbook prepend → 原始 systemPrompt → worldbook append → prompt[append]`；finalize 阶段 system/user/assistant 分角色注入 |
| i18n | 每组件 `i18n/{zh-CN,en-US,index,types}.js` | 双语文案（UI 内仍有大段中文硬编码） |

### 0.3 与 v0.5.0 的演进差异（重要）

1. **修复构建复制错误**：v0.5.0 的 `prompt/dist/shared/` 与 `prompt/dist/ui/` 错放了 worldbook 的文件（`worldbook_service.js` 等）；v0.6.0 已替换为 `prompt_service.js`/`prompt_manager`——证明其**构建流水线靠手工复制、无自动化校验**。
2. 新增 `prompt_back` 组件（提示词后注入）与 `prompt_service.js` 独立存储。
3. 工具名从 `worldbook_*` 语义改为在 prompt 域重复注册（v0.6.0 的 prompt 组件提供与 worldbook 完全同名的 13 个工具，只是数据源不同；prompt_back 用前缀避免冲突）。

---

## 1. 现有不足识别（带代码证据）

### 1.1 功能缺失

| # | 缺失 | 证据/说明 |
| --- | --- | --- |
| F1 | **无创作流程引导** | 全部能力是"注入工具"，没有任何选题/设定/大纲/分卷/正文/修订的状态机或模板——模型不受流程约束 |
| F2 | **无章节与正文管理** | 无章节存储、字数统计、细纲对照；正文散落在聊天记录 |
| F3 | **无导出** | 世界书仅有 JSON 导入（`importWorldBookEntries`），无导出/备份/发布格式（txt/markdown/平台排版） |
| F4 | **无校验** | 无禁用词/AI 味词/一致性/伏笔等质量校验 |
| F5 | **无伏笔/术语/灵感管理** | 创作刚需工具完全缺席 |
| F6 | **无 token 预算控制** | 命中即全量注入（`buildInjection` 拼接所有命中条目），长篇上下文必然膨胀 |
| F7 | **无搜索/过滤/分页** | UI 全量渲染所有条目，数百条目后不可用 |
| F8 | **无变量 UI** | 变量系统仅靠条目内宏读写，无可视化查看/编辑（只能通过 CONTENT_SNIPPETS 速查语法） |
| F9 | **无版本迁移** | `readWorldBookEntries` 直接 `JSON.parse`，字段结构演进无 `schema_version` 迁移（manifest 有 1 但数据文件没有） |

### 1.2 性能瓶颈

| # | 瓶颈 | 证据/说明 |
| --- | --- | --- |
| P1 | **每次提示词组装 4-6 次磁盘读** | `systemPromptHook` + `finalizeHook` 各自调用 `readEnabledEntries`（读 entries+groups）→ `buildGroupCardBindingMap`（再读 groups）→ `resolveVariableContext`（读 entries + variables + `Tools.Chat.getMessages` 全量拉取）；两 Hook 合计每轮 ≥6 次文件 IO |
| P2 | **跨模块重复执行** | worldbook `systemPromptHook` 内 `require("../../prompt/dist/main.js")` 并调用其 `readEnabledEntries`/`buildGroupCardBindingMap`——prompt 组件每轮被串行执行两次读取 |
| P3 | **正则每轮重建** | `matchesEntry` 内 `new RegExp(keyword, ...)` 对每条目每轮新建，无预编译缓存 |
| P4 | **全量扫描** | 无倒排索引，N 条目 × M 关键词线性匹配 |
| P5 | **单文件 UI 巨大** | 三个 UI 各 88-92KB 单文件，加载解析开销大、无法按需分包 |
| P6 | **消息全量拉取** | 变量同步每次 `Tools.Chat.getMessages(chatId, {order:'asc'})` 拉全部消息再按 timestamp 去重 |

### 1.3 结构混乱

| # | 问题 | 证据/说明 |
| --- | --- | --- |
| S1 | **三组件 80%+ 代码重复** | `worldbook_service.js`(31KB) 与 `prompt_service.js`(31KB) 逐行对比仅函数名前缀不同（diff 证实）；`*_variables.js`、`*_main.js`、tools、UI 全部复制改名；`prompt_back` 再复制一遍 |
| S2 | **跨模块硬依赖** | `worldbook/dist/main.js:319` `require("../../prompt/dist/main.js")`——prompt 不注册 Hook 却由 worldbook 代跑；`prompt/dist/main.js:302` 读 worldbook 的 `settings.json`（`resolveUserName`）——跨存储耦合 |
| S3 | **构建无校验** | v0.5.0 prompt 目录错放 worldbook 文件证明纯手工复制流程 |
| S4 | **工具命名冲突靠前缀规避** | prompt_back 工具全部 `prompt_back_` 前缀，本质是同一 CRUD 的第三份拷贝 |
| S5 | **平台硬编码** | `/sdcard/Download/Operit/` 四处硬编码路径（storage ×2 + prompt + prompt_back），不可配置 |
| S6 | **无测试/类型** | 整个仓库零测试文件、零 `.d.ts`（入口有 `/// <reference>` 但无类型文件）、无 lint/typecheck |
| S7 | **伪混淆** | `ToolPkg._m([33,120,...],90)` 为数组异或浅混淆，无实际保护意义，纯增体积与维护成本 |

### 1.4 体验缺陷

| # | 缺陷 | 说明 |
| --- | --- | --- |
| E1 | 所有 IO 错误被静默吞掉 | `catch (_error) { return []/{} }` 遍布 storage/main，用户无法感知数据损坏 |
| E2 | 无注入预览/命中调试 | 看不到"哪些条目在哪些轮次命中" |
| E3 | 无字数/token 统计 | 注入量不可见 |
| E4 | UI 无搜索排序 | 大列表不可用 |
| E5 | 无备份/恢复 UI | 数据只有裸 JSON 文件 |
| E6 | 文案硬编码 | i18n 存在但 UI 仍大量中文直写（如"未命名分组"） |
| E7 | README 过简 | 仅 762 字节，无数据格式/宏语法/迁移文档 |

---

## 2. 目标架构（融合方案总览）

```
dsh-novel-writer（单包双半区，DSH bundle 插件）
├── host 半区（node）
│   ├── lorebook/            ← 夏瑾「世界书Plus」移植（核心）
│   │   ├── entry-crud.ts       条目/分组/角色卡绑定 CRUD（含导入解析器）
│   │   ├── matcher.ts          关键词/正则匹配引擎（预编译 + 索引）
│   │   ├── injector.ts         注入组装器（prepend/append/at_depth，token 预算）
│   │   ├── variables.ts        变量引擎（InitVar/JSONPatch/宏渲染）
│   │   └── store.ts            存储（schema_version 迁移 + 原子写 + 备份）
│   ├── prompt/              ← 夏瑾「提示词前/后」合并（一个模型，position 字段区分）
│   ├── prompts/             ← ★v3 内置提示词库（≥60 模板，随包分发、可编辑导出）
│   ├── workflow/            ← 九阶段创作流程引擎（DEVELOPMENT-PLAN.md §3.1）
│   ├── novel/               ← 章节/正文/大纲/细纲/人设管理
│   ├── quality/             ← 校验引擎（结构/一致性/内容/剧情四族）
│   ├── polish/              ← ★v3 AI 味去除 + 文风优化 + 润色改写服务
│   ├── diagnose/            ← ★v3 黄金三章等网文理论智能诊断
│   ├── consistency/         ← ★v3 百万字一致性引擎（账本/时间线/巡检/摘要压缩）
│   ├── stats/               ← ★v3 章节字数统计与达标校验
│   ├── guide/               ← ★v3 对话式引导（意图解析 → 工具编排）
│   ├── ledger/              ← 事实账本（与变量引擎融合）
│   ├── foreshadow/ glossary/ ideas/  ← 伏笔/术语/灵感（新增）
│   ├── export/              ← 导出（txt/markdown/平台排版）
│   └── routes.ts            ← /novel-writer/* HTTP 路由
├── client 半区（Web GUI）★v3 全部按钮化
│   ├── sidebar/             侧边栏「小说工坊」
│   ├── wizard/              ★创作向导（新建项目多步引导 + 示例项目）
│   ├── assistant/           ★工坊助手对话面板（自然语言 → 工具）
│   ├── lorebook-manager/    世界书管理（搜索/过滤/分页/注入预览）
│   ├── prompt-manager/      提示词前/后管理
│   ├── prompt-library/      ★内置提示词库浏览器（分类/编辑/导出）
│   ├── project-board/       项目工作台（阶段流程视图/章节列表+字数徽标/校验报告）
│   ├── diagnose-panel/      ★黄金三章诊断报告可视化（评分+建议+一键优化）
│   ├── polish-panel/        ★AI 味报告（命中高亮+一键改写）
│   └── settings-card/       设置页卡片（新手/高级模式）
├── assets/
│   ├── presets/novel-writer.json   「小说创作模式」agent 预设
│   ├── prompts/*.md               ★内置提示词库源文件（随包分发）
│   └── samples/demo-book/          ★示例小说项目（安装即带演示数据）
├── .dsh/skills/novel-writing-workflow/SKILL.md
└── tests/                   vitest（core 全覆盖）
```

### 2.1 关键映射决策（Operit 概念 → DSH 概念）

| Operit 概念 | DSH 移植映射 | 说明 |
| --- | --- | --- |
| 角色卡（character_card） | **小说项目（Book）** | 世界书条目的"角色卡绑定"变为"项目绑定"：条目可绑定到具体小说项目/卷/人物 |
| `registerSystemPromptComposeHook` | **上下文包组装器注入** + 可选 `ctx.systemPrompt.section` | 写章时注入 ContextPacket（L1/L2/L3 分层），而非全局改系统提示词（避免污染非创作会话） |
| `registerPromptFinalizeHook` | 上下文包 constraints 注入 + 写章指令模板 | "提示词前/后"变为上下文包的前置/后置区块 |
| `Tools.Files`（安卓文件） | `node:fs` + `~/.dsh/dsh-novel-writer/` | 主机文件系统 |
| `Tools.Chat` | `ctx.sessions`/`ctx.workspaces` | 会话驱动 |
| `compose_dsl` UI | React 组件（`__ModuleLoader__.load`） | Web GUI |
| 变量宏（{{getvar::}} 等） | 账本宏（ledger 注入时直接渲染） | 保留宏语法兼容，新增 `{{ledger::entity.field}}` |

### 2.2 三通道约束模型（沿用 DEVELOPMENT-PLAN.md §4.1）

软引导（技能 `novel-writing-workflow`）＋ 硬轨道（`novel_*` + `lorebook_*` + `prompt_*` 工具）＋ 模式锚定（「小说创作模式」agent 预设）。详见 DEVELOPMENT-PLAN.md §4。

---

## 3. 功能模块设计

### 3.1 移植模块（原仓库功能 → DSH 重写，附带修复）

#### M1 世界书引擎（lorebook）—— 修复 F1 之外的 P1-P4、S1、S5、E1

- 数据模型：条目（name/content/keywords/is_regex/case_sensitive/always_active/enabled/priority/scan_depth/inject_target/inject_position/insertion_depth/**book_id**/volume_id/tags/created_at/updated_at/version）+ 分组（entry_ids/book_ids/enabled）。
- 匹配引擎 `matcher.ts`：
  - **预编译正则缓存**（Map<entryId, RegExp>，写时失效）——修复 P3；
  - **关键词倒排索引**（内存 Map<token, Set<entryId>>，加载时构建，变更时增量更新）——修复 P4；
  - scan_depth：回溯前 N 章（DSH 中扫描对象 = 当前章细纲 + 前 N 章全文，而非用户消息）。
- 注入组装器 `injector.ts`：
  - 保留 `prepend/append/at_depth` 三位置语义与"前→后"顺序（prompt[prepend] → lorebook prepend → 原文 → lorebook append → prompt[append]）；
  - **新增 token 预算**（`contextBudget`）：按 priority 排序后贪心裁剪，超限条目折叠为摘要列表，报告裁剪数——修复 F6；
  - 输出 `InjectionPlan`（命中条目、位置、token 估算、裁剪列表）供 GUI 预览——修复 E2/E3。
- 存储 `store.ts`：
  - **schema_version 迁移链**（v1：合并旧字段；后续版本可迁移）——修复 F9；
  - **原子写**（tmp+rename）+ **自动备份**（每次写入前保留 `*.bak`，保留 N 份）——修复 E5；
  - 错误上抛带上下文（不再静默 `catch` 返回 `[]`，降级时写 warning 日志）——修复 E1；
  - 路径可配置（`storageDir`）——修复 S5。

#### M2 变量引擎（variables）—— 修复 P6、F8

- 保留：InitVar 条目 YAML 模板、`<UpdateVariable>/<JSONPatch>` 增量（op: replace/insert/remove/delta/move + JSON Pointer + 下划线保护键）、8 类宏渲染。
- 修复：**增量消息扫描**（按 `since_timestamp` 拉取增量而非全量 getMessages）——修复 P6；
- 新增：**账本融合**——JSONPatch 同时写 `variables.json` 与 `ledger.json`（实体-字段-值，供校验器比对），宏新增 `{{ledger::人物.境界}}`；
- 新增：GUI 变量查看器（只读树 + 路径复制），运行时变量快照可导出——修复 F8。

#### M3 提示词前/后（prompt）—— 修复 S1/S2/S4

- **三合一单模型**：worldbook/prompt/prompt_back 的 30KB×3 服务合并为一个 `EntryStore` 类，`scope: 'lorebook' | 'prompt_front' | 'prompt_back'` 区分数据目录与注入位置；工具注册一次（参数带 `scope`）——修复 S1/S4；
- 删除跨模块 require 与跨存储读 settings：`resolveUserName` 改读统一配置命名空间——修复 S2；
- 前端 prompt 不再"由 worldbook 代跑"：注入组装器统一接收三个 scope 的命中结果，按顺序组装。

#### M4 导入解析器（import）—— 保留 + 补导出

- 保留三格式导入（Operit 数组 / SillyTavern lorebook / character_book）与 5 类兼容性警告；
- **新增导出**（修复 F3）：`lorebook_export` 工具 + UI 按钮，输出 SillyTavern 兼容 JSON / 纯文本清单；
- 新增导入字段映射到 `book_id`/`tags`。

### 3.2 创作流程模块（DEVELOPMENT-PLAN.md 全量保留）

- **M5 流程引擎**：九阶段状态机（topic→setting→character→outline→volume→chapter→writing→revision→done），阶段门禁（locked/in_progress/review/approved/skipped）、版本快照、审计日志（audit.jsonl）。
- **M6 规范模板库**：8 类型模板 + 9 阶段模板 + 风格约束表（含 AI 味词表）。
- **M7 章节上下文管理**：三层记忆组装器（L1 全书压缩 ≤500 字 / L2 卷章细纲+前 N 章 / L3 摘要+账本+伏笔+**lorebook 命中条目**），`contextBudget` 裁剪；**lorebook 注入作为 L3 的一部分**，由 M1 的 injector 提供。
- **M8 质量校验**：结构/一致性（账本冲突）/内容（禁用词、AI 味词、视角漂移）/剧情（钩子、伏笔回收、细纲偏离）。
- **M9 会话驱动**：host 侧 `ctx.inject(["sessions","workspaces"])`，`session.prompt` 写章 + GUI 确认弹窗。

### 3.3 新增模块（原仓库未覆盖，创作场景刚需）

| # | 模块 | 说明 |
| --- | --- | --- |
| N1 | 灵感库 ideas | 随时记录灵感片段，选题阶段拉取聚合 |
| N2 | 伏笔管理 foreshadow | 登记/回收/跟踪（plant/reveal/list），校验器核对 |
| N3 | 术语表 glossary | 自动从设定提取 + 手工维护，注入上下文防用词漂移 |
| N4 | 项目克隆/模板 | 以完本项目为模板新建（结构复制、正文不复制） |
| N5 | 定时连载 scheduler | 浏览器端 cron（P3，可选） |
| N6 | 市场调研 market | 选题阶段 web_search 热度辅助（需确认） |
| N7 | 复盘报告 retrospective | 完本统计（字数曲线/校验分布/修订次数） |
| N8 | 平台合规 compliance | 违禁内容清单检查（选题/设定/正文） |
| N9 | 修订模式 revision | 错别字/节奏/文风三模式，diff 统计，不覆盖原稿 |
| N10 | 提问式补全 | 选题/设定阶段每轮 ≤3 问（沿用 DEVELOPMENT-PLAN §3.5-12） |
| N11 | ★内置提示词库 prompt-library | ≥60 个随包分发的创作/优化提示词模板（详见 3.5） |
| N12 | ★AI 味去除 polish | 检测 + 一键改写 + 文风自然化（详见 3.5） |
| N13 | ★黄金三章诊断 diagnose | 网文理论结构诊断与优化建议（详见 3.5） |
| N14 | ★百万字一致性引擎 consistency | 时间线/巡检/自动沉淀（详见 3.6） |
| N15 | ★章节字数统计 stats | 自动统计 + 达标校验 + 统计面板（详见 3.7） |
| N16 | ★对话式引导 guide | 工坊助手 + 意图解析 + 创作向导（详见 3.8） |

### 3.4 面向大众的开箱即用设计（★v3 核心）

| # | 设计 | 说明 |
| --- | --- | --- |
| U1 | **一键安装** | `dsh plugin --profile web add github:<repo>`；发布物为单个 tgz；README 安装路径 ≤3 步 |
| U2 | **示例项目开箱** | 安装即创建 `assets/samples/demo-book/` 示例小说（含九阶段完整产物 + 3 章样章 + 世界书条目），用户可一键「克隆示例」试玩，也作为 UI 演示数据 |
| U3 | **创作向导 wizard** | 新建项目多步引导：①选类型（8 类卡片+说明）→ ②起书名/一句话创意（可留空自动生成）→ ③生成核心设定（模型按内置模板生成，用户逐项确认/修改）→ ④生成全书大纲 → ⑤开写第一章。向导有进度条、可随时暂停/恢复（状态存 book.json） |
| U4 | **零配置默认值** | 所有设置均有最优默认；「新手模式」隐藏高级项（注入预算/扫描深度/校验规则集），「高级模式」全展示 |
| U5 | **一键动作流** | 每个报告/提示都带「一键执行」按钮（如「一键去 AI 味」「一键优化第三章」「一键写下一章」），背后走同一套工具服务 |
| U6 | **新手教程** | 首次使用弹出 3 步图文教程（创建项目→写第一章→看诊断报告）；可关闭 |
| U7 | **容错与恢复** | 任何失败给可读提示 + 建议动作；自动备份 + undo 快照（dsh-undo-savepoint 联动）；数据损坏自动修复提示 |
| U8 | **i18n 双语** | zh/en 完整对照（UI/提示词/报告），默认跟随系统语言 |

### 3.5 内置提示词库与质量增强（★v3）

**提示词库 `prompts/`（随包分发，GUI 可浏览/编辑/导出，项目级可覆盖）**：

| 分类 | 模板示例 | 数量 |
| --- | --- | --- |
| 九阶段创作 | 选题生成/核心设定/人设卡/全书大纲/分卷细纲/章细纲/正文写作（分 8 类型 × 各阶段） | ≥30 |
| 文风预设 | 玄幻热血/仙侠飘逸/都市轻快/悬疑冷峻/古风典雅/科幻冷硬/历史厚重/轻松搞笑——每套含视角/句式/词汇/对话风格指令 | 8 |
| AI 味去除 | 通用去味改写 + 分类去味（连接词/动作描写/心理描写/形容词）+ 逐条替换建议 | 6 |
| 润色 | 错别字病句（轻改）/节奏调整（重写段）/文风统一（全文轻润）/扩写与缩写 | 5 |
| 黄金三章诊断 | 三章结构诊断/单章节奏诊断/开篇钩子评估/爽点密度评估/章末悬念评估 | 5 |
| 对话引导 | 工坊助手 persona/创作向导各步骤引导语/提问式补全协议 | 6 |
| 世界书辅助 | 设定自动生成世界书条目/术语表提取/伏笔登记建议 | 4 |

**AI 味去除（polish.ts）**：
- **内置 AI 味词库**（≥300 词，按 5 类组织：转折连接词「然而/总而言之/不禁」、万能动作「缓缓/微微/仿佛」、心理描写「心底涌起/一股暖流」、形容词堆叠「深邃的眸子里闪过一丝」、句末感叹「啊/呢/吧」）；每词带**推荐替换/删除策略**（可配置：替换/删除/改写）。
- 检测：`novel_validate` 内容族规则扩展（AI 味密度评分 0-100，按类别分布报告，GUI 高亮命中句）。
- 去除：`novel_depolish` 工具 + GUI「一键去 AI 味」——按内置改写提示词调用模型重写（默认只改命中句附近，可整章），产出新版本不覆盖原稿，diff 展示；用户可逐条接受/拒绝。
- 文风自然化：`novel_style_convert` 工具，按所选文风预设整体改写章节（可选段落级）。

**黄金三章诊断（diagnose.ts）**：
- **规则层（纯函数，离线可用）**：每章字数达标、对话占比区间、章末是否为对话/悬念/动作钩子、是否引入主要冲突、主角出场章节与亮相质量（首章必检）、设定灌输量（设定段落占比过高告警）。
- **模型层（LLM 诊断）**：按内置诊断提示词产出结构化报告（每项：severity/问题描述/证据句/优化建议），输出 JSON 由 GUI 渲染为评分卡（总分 + 雷达图 + 问题列表 + 建议）。
- **一键优化**：每项建议可选中执行（`novel_apply_advice`，把建议+原文发给模型改写）。
- 触发：前 3 章必检（提交后自动），后续每 N 章可选（`goldenCheckEveryN`）。

### 3.6 百万字一致性引擎（★v3，`consistency/`）

| 机制 | 说明 |
| --- | --- |
| **分层事实账本** | 实体-字段-值-置信度-章节号（沿用 ledger.ts）；**实体级索引**（倒排，实体名→相关条目/章节/世界书条目），供检索与校验 |
| **增量摘要压缩** | 每章摘要 ≤200 字；**每卷结束生成卷摘要**（由各章摘要再压缩）；**每 10 卷生成全书总摘要**；上下文包按需取"近 3 章全文 + 本卷摘要 + 全书总摘要"——字数增长时预算恒定 |
| **世界书自动沉淀** | 每卷结束自动把该卷确立的关键设定（新人物/新地点/新规则/力量体系变化）生成为**常驻世界书条目**（`always_active: true`）——确保百万字后关键设定永远在上下文中，这是对夏瑾"常驻注入"理念的创作化延伸 |
| **一致性巡检 consistency-audit** | 每 N 章（默认 10）自动跑全量校验：账本冲突（境界倒退/物品消失/地点错位/人物死亡后复现/时间线矛盾）+ 伏笔超期未回收 + 术语漂移；产出巡检报告（严重/警告分级） |
| **时间线引擎 timeline** | 每章提交时登记事件-时间锚点（书内时间），检测前后章时间倒挂；支持「N 年后」等模糊表述由模型解析（可选，模型层） |
| **检索增强** | 写章上下文包组装时，按当前章细纲关键词从「摘要库 + 账本 + 世界书」检索相关条目注入（复用 matcher 倒排索引技术）——替代"全书塞进上下文" |
| **一致性自检协议** | 内置提示词「写作前一致性自检」：正文写作指令中要求模型先对照账本相关条目，再动笔；`novel_write_chapter` 返回前强制调用一次账本比对（新增 `consistencyGuard` 开关，默认开） |

**预算恒定性**：`contextBudget` 硬上限 + 上述分层裁剪，保证 100 万字时上下文包与第 10 章时同规模（实测目标：≤ 配置预算，超出 0 次）。

### 3.7 章节字数自动统计与达标校验（★v3，`stats/`）

| # | 功能 | 说明 |
| --- | --- | --- |
| S1 | **提交自动统计** | `novel_write_chapter`/`novel_commit` 落盘时自动统计：总字数、中文字符数（排除标点/空白）、段落数、对话占比、平均句长；写入章节元数据与 `stats.json` |
| S2 | **达标校验** | 对照 `wordTargets.perChapterMin/Max`：不足/超限给 warning（不足时建议扩写、超限时建议拆分），达标给徽标 ✓；GUI 章节列表实时显示「字数/目标 + 徽标」 |
| S3 | **全书统计面板** | 总字数/卷字数/平均章字数/最长沙发字章节/字数曲线（按章序号，ECharts 或纯 CSS 条形图）/每日新增字数（连载模式） |
| S4 | **目标自适应** | 完成卷细纲时可设置该卷目标字数，全书目标 = Σ卷目标；`novel_stats` 工具返回全部统计（agent 可见） |
| S5 | **字数仪表** | 写作编辑器中实时字数计数 + 与目标差距提示（client 端打字即算） |

### 3.8 对话式引导与工坊助手（★v3，参考 AI 酒馆理念）

**核心理念借鉴（SillyTavern/Operit 酒馆风格）**：世界书常驻设定、可定制系统提示词、宏变量渲染、沉浸式人机对话。映射到本插件：

| 酒馆理念 | 本插件落地 |
| --- | --- |
| 角色卡（Character Card） | **「工坊助手」角色卡**：内置 persona（书名+当前阶段+用户偏好），以对话形式陪伴创作；GUI 助手面板常驻，输入框即对话 |
| 世界书 Lorebook | 移植的世界书引擎（3.1-M1），条目自动沉淀（3.6） |
| 可定制系统提示词 | 内置提示词库（3.5）+ 项目级覆盖 |
| 宏变量 | 变量/账本渲染宏（`{{ledger::}}` 等） |
| 沉浸式引导 | **意图解析层 `guide/intent.ts`**：把自然语言指令映射到工具调用 |

**意图解析（guide/intent.ts）**：规则 + 模型双通道把用户语句转为结构化动作：
- 「写下一章 / 继续写」→ `novel_write_chapter`
- 「润色第三章 / 改得自然点」→ `novel_revise`（自动识别目标章节与模式）
- 「哪里 AI 味重 / 检查一下」→ `novel_validate`（自动选规则集）
- 「帮我看看开头好不好」→ `novel_diagnose`（黄金三章）
- 「林远现在什么境界」→ `novel_ledger` 查询
- 「存个灵感」→ `novel_idea`
- 未匹配 → 交给模型自由对话（工坊助手 persona 回复，可继续追问）
- 全部动作在 GUI 确认面板预览后再执行（非技术用户可点「直接执行」跳过）

**创作向导（wizard）**（U3 细化）：向导步骤状态存 `book.json.wizard`，模型生成的内容每步可编辑后「下一步」；生成失败可重试；全程无命令行。

### 3.9 agent 工具清单（合并后全集）

| 工具名 | 用途 | 来源 |
| --- | --- | --- |
| `lorebook_*`（13 个：list/get/create/update/delete/toggle/import/export/roles/groups×5） | 世界书条目与分组 | 夏瑾移植（import 已存在，export 新增） |
| `prompt_*`（同 13 个，带 `scope: front|back` 参数） | 提示词前/后条目 | 夏瑾移植（三合一修复后） |
| `novel_projects` / `novel_phase` / `novel_commit` / `novel_write_chapter` / `novel_revise` / `novel_validate` / `novel_ledger` / `novel_foreshadow` / `novel_idea` / `novel_override_phase` / `novel_export` / `novel_stats` | 创作流程 | DEVELOPMENT-PLAN §4.2 |
| `novel_variables` | 变量/账本查询（替代夏瑾无 UI 的变量查看） | 新增 |
| ★`novel_depolish`（章节/全书，去 AI 味改写） | AI 味去除 | v3 新增 |
| ★`novel_style_convert`（章节，文风预设改写） | 文风自然化 | v3 新增 |
| ★`novel_diagnose`（章节/前三章，规则+模型诊断报告） | 黄金三章诊断 | v3 新增 |
| ★`novel_apply_advice`（诊断建议逐条执行） | 诊断建议落地 | v3 新增 |
| ★`novel_consistency_audit`（全量一致性巡检） | 百万字一致性 | v3 新增 |
| ★`novel_timeline`（时间线查询/登记） | 时间线引擎 | v3 新增 |
| ★`novel_wordcount`（章节/全书统计明细） | 字数统计 | v3 新增 |
| ★`novel_prompts`（浏览/导出/覆盖内置提示词库） | 提示词库 | v3 新增 |
| ★`novel_wizard`（创作向导步骤驱动：next/back/regenerate/commit） | 向导 | v3 新增 |
| ★`novel_guide`（意图解析入口：自然语言→结构化动作） | 工坊助手 | v3 新增 |

---

## 4. 配置项（合并）

### 4.1 全局（设置页命名空间 `dsh-novel-writer`）

`enabled` / `defaultGenre` / `defaultWordPerChapter` / `defaultStylePreset` / `contextBudget`(默认 12000) / `prevChaptersFull` / `validationLevel` / `storageDir`(默认 `~/.dsh/dsh-novel-writer/projects`) / `lorebookDir`(默认 `<storageDir>/lorebook`) / `aiTasteWords` / `injectionBudget`(默认 4000 token，lorebook 单轮注入上限——修复 F6) / `userReplacement`(原 user_replacement 迁移) / `useGit`(P3) / `backupKeep`(默认 5)

★v3 新增：`uiMode`（'beginner'|'advanced'，默认 beginner）/ `goldenCheckEveryN`(默认 3，后续章节诊断频率) / `consistencyGuard`(默认 true，写章前账本自检) / `consistencyAuditEveryN`(默认 10) / `autoSediment`(默认 true，卷末自动沉淀世界书) / `depolishMode`('suggest'|'rewrite'|'off'，默认 suggest) / `promptLibraryDir`(默认随包内置；用户可指外部目录覆盖) / `assistantEnabled`(默认 true，工坊助手面板) / `demoBookOnInstall`(默认 true，安装示例项目) / `tutorialOnFirstUse`(默认 true)

### 4.2 项目级（book.json.config）

`title/author/tags/audience` / `genre` / `wordTargets`（含 perVolume/perBook，v3 支持卷目标）/ `style`(StyleSheet，含项目级禁用词覆盖) / `phaseGating` / `templateId` / `compliance` / `lorebookProfile`(该项目默认启用/禁用的条目 id 白名单——替代角色卡绑定语义) / ★`stylePresetId`（文风预设）/ ★`wizard`（向导进度状态）/ ★`auditLog`（一致性巡检历史索引）

### 4.3 条目级（夏瑾字段全集 + 新增）

夏瑾字段（name/content/keywords/is_regex/case_sensitive/always_active/enabled/priority/scan_depth/inject_target/inject_position/insertion_depth/character_card_id→**book_id**）+ 新增 `tags[]` / `volume_id?` / `note`。

---

## 5. 数据结构（增量）

- 完全沿用 DEVELOPMENT-PLAN.md §6 的 `Book/PhaseState/Chapter/LedgerEntry/ValidationReport/ContextPacket/GenreTemplate/StyleSheet`。
- 新增（本方案 v2）：
  - `LoreEntry`（上表字段，含 `schemaVersion`）
  - `LoreGroup`（id/name/entry_ids/book_ids/enabled）
  - `InjectionPlan`（entries/positions/tokenEstimate/truncated[]）
  - `VariableStore`（global_variables/character_variables/chats → 移植为 global/book/chats，book 级对应原 character 级）
  - `Foreshadow/ForeshadowPlant`、`GlossaryTerm`、`Idea`
- 新增（★v3）：
  - `PromptTemplate`（id/category/name/description/template(带占位符)/variables[]/builtin|user 来源/版本）
  - `DepolishReport`（density/类别分布/命中列表（sentence/hitWord/suggestion）/rewriteDiff）
  - `DiagnoseReport`（score/维度分（钩子/冲突/人物/爽点/悬念/节奏）/issues[{severity,title,evidence,advice,status}]）
  - `ConsistencyAuditReport`（auditedThroughChapter/conflicts[{kind,entity,field,chapters[],severity}]/summary）
  - `TimelineEvent`（chapterNo/bookTime/event/confidence）
  - `ChapterStats`（totalChars/cjkChars/paragraphs/dialogueRatio/avgSentenceLen/meetsTarget）
  - `WizardState`（step/currentStep/progress/artifacts[]/status）
  - `IntentAction`（intent/action/params/confidence/confirmRequired）
- 存储布局：`<storageDir>/lorebook/{entries.json,groups.json,variables.json,settings.json}`、`<storageDir>/projects/<bookId>/...`（沿用 DEVELOPMENT-PLAN §6.1）、★`<storageDir>/prompts/`（内置库导出/覆盖区）、`assets/samples/demo-book/`（示例项目，只读随包）。

---

## 6. 实施步骤与阶段划分（明确到文件/工具/资源）

> 每阶段末尾给出**验收命令**。全部开发在本机 `E:/deepseekwork/dsh-novel-writer/` 进行。

### P0 原型：移植最小闭环 + 示例项目（约 1.5 周）

**目标**：世界书条目 CRUD + 关键词注入可跑通（DSH 会话内验证）+ 示例项目随包，证明"夏瑾能力在 DSH 落地、装完即见 UI"成立。

| 步骤 | 动作 | 工具/命令 | 阅读资源 |
| --- | --- | --- | --- |
| 0.1 | 生成插件骨架（hybrid：host+client） | `dev_scaffold_plugin(dir=E:/deepseekwork/dsh-novel-writer, name=dsh-novel-writer, form=hybrid)` | `E:/deepseekwork/dsh-plugin-publisher/`（零依赖骨架样板） |
| 0.2 | 定义核心类型 `src/core/types.ts`（含 v3 类型：PromptTemplate/ChapterStats/WizardState/IntentAction 等） | 编辑器（read/write/edit） | 本方案 §5 + DEVELOPMENT-PLAN §6.2；参考 `~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-task-board/src/core/store.ts` 的类型风格 |
| 0.3 | `src/core/lorebook/store.ts`（原子写 + schema 迁移 + 备份） | vitest 单测 | 夏瑾 `worldbook_storage.js`（迁移逻辑参考其 legacy 迁移思路，重写为迁移链） |
| 0.4 | `src/core/lorebook/service.ts`（条目/分组 CRUD + 导入解析器） | vitest 单测 | 夏瑾 `worldbook_service.js` 全量（783 行逐函数移植） |
| 0.5 | `src/core/lorebook/matcher.ts`（预编译正则 + 倒排索引） | vitest 单测 | 夏瑾 `main.js:matchesEntry` 语义 |
| 0.6 | `src/core/stats/wordcount.ts`（字数统计：中文字符/对话占比/句长 + 达标校验） | vitest（中英文混排/标点用例） | — |
| 0.7 | 工具注册 `lorebook_*`（8 个）+ `novel_wordcount` | 参考 `~/.dsh/profiles/web/node_modules/@linxin666/dsh-ssh/src/tools.ts` 的 `ctx.tools.register(defineTool({...}))` 模式 | 本方案 §3.9 |
| 0.8 | host 装配 + settings 门禁 + **示例项目资产 `assets/samples/demo-book/`**（构造：1 类型模板 + 9 阶段产物 + 3 章样章 + 10 条世界书条目 + 5 条提示词样例） | 参考 `E:/deepseekwork/dsh-plugin-publisher/lib/index.js` 的 `ctx.inject(["settings"])` + `sync()` 模式 | 夏瑾 `worldbook/dist/packages/*` 工具描述文案（复用翻译） |
| 0.9 | GUI 骨架：侧边栏「小说工坊」+ 项目列表（显示示例项目卡片，一键克隆） | client 半区 React；参考 `dsh-client-ui-task-board/src/client/sidebar-entry.ts` | — |
| 0.10 | 组合/运行时验证 | `npx -y @deepseek-ai/dsh plugin --profile scratch add <path>` → `--dump-config`；headless profile 实测工具可用 | dsh CLI 文档（`@deepseek-ai/dsh-cmdline` README） |

**验收**：headless 会话中创建条目→写关键词→触发注入→条目出现在上下文包；GUI 项目列表可见示例项目并可克隆；`pnpm typecheck && pnpm test` 全绿。

### P1 核心：创作流程 + 注入引擎 + 向导（约 3 周）

| 步骤 | 动作 | 工具/命令 | 阅读资源 |
| --- | --- | --- | --- |
| 1.1 | 九阶段状态机 `workflow.ts` + 门禁 + 审计 | vitest（转移矩阵 20+ 用例） | DEVELOPMENT-PLAN §3.1/§6.2；本方案附录 A（实验状态机思路） |
| 1.2 | 项目存储 `store.ts`（book.json + 目录骨架 + 章节 frontmatter + wizard 状态） | vitest | DEVELOPMENT-PLAN §6.1/§6.3 |
| 1.3 | 注入组装器 `injector.ts`（三位置 + token 预算 + InjectionPlan） | vitest（预算裁剪用例） | 夏瑾 `worldbook/main.js:systemPromptHook/finalizeHook` 组装顺序；本方案 §3.1-M1 |
| 1.4 | 变量引擎 `variables.ts`（InitVar/JSONPatch/宏，增量扫描） | vitest（JSON Patch 正反例） | 夏瑾 `worldbook_variables.js` 全量（753 行逐函数移植） |
| 1.5 | 上下文包组装器 `context.ts`（L1/L2/L3 + lorebook 注入接入 + **检索增强**） | vitest（预算裁剪） | DEVELOPMENT-PLAN §3.3；本方案 §3.6 |
| 1.6 | 会话驱动（host 侧 session.prompt 写章 + 确认弹窗）+ **写章自动字数统计与达标校验** | 参考 `dsh-client-ui-task-board/src/core/execution.ts` 的服务契约，host 侧注入 | 本方案 §3.7 |
| 1.7 | 技能注册 `novel-writing-workflow` + 提示词前/后统一（scope 三合一） | 参考 `dsh-plugin-publisher` 的 `ctx.skills.register` | DEVELOPMENT-PLAN §4.1 |
| 1.8 | **内置提示词库 v1**：`assets/prompts/` 首批 20 个模板（九阶段 × 玄幻 + 文风预设 2 + 去 AI 味 3 + 润色 3）`prompts.ts` 加载器 + `novel_prompts` 工具 | 提示词编写（人工打磨，模板用占位符 `{{title}}` 等） | 参考 AI 酒馆系统提示词风格：结构化分节、明确输出格式 |
| 1.9 | **创作向导 v1**：`wizard.ts` + `novel_wizard` 工具（next/back/regenerate/commit）+ GUI 多步表单 | client React | 本方案 §3.8 |
| 1.10 | **工坊助手 v1**：`guide/intent.ts` 规则意图解析（10 条核心意图）+ 助手对话面板 | client React | 本方案 §3.8 |
| 1.11 | GUI v1：项目工作台（阶段视图/章节列表+字数徽标/产物查看/向导界面） | client 半区 React；参考 `dsh-client-ui-task-board/src/client/sidebar-entry.ts` | — |
| 1.12 | agent 预设「小说创作模式」 | 写入 `~/.dsh/.agent-presets/novel-writer/{preset.yml,agent.cordis.yml}`；参考 `~/.dsh/.agent-presets/liangshen/` | DEVELOPMENT-PLAN §4.1 |

**验收**：headless 端到端走完九阶段写 3 章样章；每章字数自动统计并达标徽标正确；GUI 向导从零创建项目成功；lorebook 命中条目在上下文包且 token ≤ 预算；core 单测 ≥ 80 例。

### P2 增强：质量引擎（AI 味/黄金三章/一致性）+ 全量提示词库（约 3.5 周）

| 步骤 | 动作 | 工具/命令 | 阅读资源 |
| --- | --- | --- | --- |
| 2.1 | 校验引擎四族规则 `validation.ts`（账本冲突/禁用词/AI 味密度/钩子/伏笔回收/细纲偏离） | vitest + 冲突注入夹具 | DEVELOPMENT-PLAN §3.4 |
| 2.2 | **AI 味引擎 `polish.ts`**：内置 300+ 词库（5 类 + 替换策略）+ 密度评分 + `novel_depolish`/`novel_style_convert` + GUI 高亮报告与「一键去味」 | vitest（词库命中正反例） | 参考网文圈公开 AI 味词清单整理；本方案 §3.5 |
| 2.3 | **黄金三章诊断 `diagnose.ts`**：规则层（钩子/字数/对话占比/设定灌输/冲突引入）+ 模型层（`novel_diagnose`，按内置诊断提示词输出 JSON 报告）+ `novel_apply_advice` | vitest（规则层离线用例）+ headless 模型层联调 | 本方案 §3.5；网文黄金三章理论要点整理 |
| 2.4 | **一致性引擎 `consistency/`**：卷摘要压缩链、世界书自动沉淀（`autoSediment`）、一致性巡检 `novel_consistency_audit`、时间线 `novel_timeline` | vitest（摘要压缩/沉淀/时间倒挂用例） | 本方案 §3.6 |
| 2.5 | 伏笔/术语/灵感模块 + 对应工具 | vitest | — |
| 2.6 | 修订系统 `revision.ts`（三模式 + diff 统计） | vitest | — |
| 2.7 | 导出 `export.ts`（txt/markdown/平台排版 + 世界书导出 + **提示词库导出**） | vitest（格式快照） | — |
| 2.8 | **内置提示词库全量**：补足 ≥60 模板（8 类型 × 各阶段、8 文风预设、去味 6、润色 5、诊断 5、引导 6、世界书 4） | 人工编写 + 模板渲染单测 | — |
| 2.9 | GUI v2：世界书管理（搜索/过滤/分页/注入预览/变量查看器）+ 诊断报告可视化（评分卡/雷达/建议一键执行）+ AI 味报告 + 一致性报告 + 统计面板 + 提示词库浏览器 + 版本回滚界面 | client React | 夏瑾 UI 功能清单逐一对照移植；本方案 §3.4-3.8 |
| 2.10 | 全局配置卡（`web-ui.plugin.item` 槽，order 100+，新手/高级模式切换） | 参考 `dsh-client-ui-task-board/src/client/settings-form.ts` | — |
| 2.11 | 提问式补全 + compliance 规则 + 新手教程引导页 | — | — |

**验收**：100 章模拟 + 植入 5 处冲突全部检出；AI 味报告密度评分与人工判断一致率 ≥90%；黄金三章诊断规则层全离线可跑；注入预览正确显示命中与裁剪；导出格式抽检通过。

### P3 测试上线：百万字压测 + 发布（约 2.5 周）

| 步骤 | 动作 | 工具/命令 |
| --- | --- | --- |
| 3.1 | core 全覆盖测试（状态机/迁移/校验/组装器/导出/变量/字数/意图解析/诊断规则） | `pnpm test`；参考 `dsh-forge` 测试风格（`tests/*.spec.ts` 用 mkdtemp 临时目录） |
| 3.2 | **百万字压测脚本 `scripts/simulate-1m.mjs`**：脚本生成 500 章 × 2000 字模拟正文 + 人工植入 20 处一致性冲突 → 验证：上下文包预算 0 超限、一致性巡检检出率 100%、摘要压缩链正确、世界书沉淀条目数合理 | 脚本 + vitest 集成用例；模拟数据走 store 不调模型 |
| 3.3 | client 冒烟（`__ModuleLoader__` stub）+ 新手路径 E2E（向导→第一章→诊断→去味→导出 全按钮流） | vitest + jsdom |
| 3.4 | 门禁全绿 + 隐私扫描 + 文档（README 中英三件套/AGENTS.md/用户手册（含提示词库目录）/迁移说明：夏瑾数据 → 本插件格式） | `pnpm typecheck && pnpm test && pnpm build`；`node scripts/hygiene.mjs`（借鉴 dsh-forge 的 hygiene 检查：必需文件/ESM/peer optional） |
| 3.5 | 构建发布产物（tgz，含 assets/prompts 与 assets/samples） | `dev_build_plugin` → `npm pack` → 可选 `dev_release_plugin` |
| 3.6 | 安装验证（干净 profile）+ 真实小项目灰度 + 开源发布（README 安装 3 步、示例截图、贡献指南） | `dsh plugin --profile web add <tgz>`；`dev_release_plugin` 发布 GitHub Release |

**验收**：全部门禁绿；百万字压测全部通过（预算 0 超限、冲突 100% 检出）；克隆发布产物复测通过；非技术用户按 README 3 分钟装完并打开 GUI 创建第一本书。

---

## 7. 依赖与环境配置

### 7.1 运行时（宿主提供，插件零运行时依赖——沿用 dsh-plugin-publisher 原则）

| 依赖 | 用途 | 版本基线 |
| --- | --- | --- |
| `@deepseek-ai/dsh`（宿主） | DSH 运行时 | 本机 `0.1.0-rc.6`（npx 缓存实测） |
| `@deepseek-ai/cordis` | ctx/Service/effect 生命周期 | 宿主提供（peer optional） |
| `@deepseek-ai/dsh-tools` | `defineTool`/`ctx.tools.register` | 宿主提供（peer optional） |
| `@deepseek-ai/dsh-settings` | `installSettingsSection`/`settings.register` | 宿主提供（peer optional） |
| `@deepseek-ai/dsh-skill` | `ctx.skills.register` | 宿主提供（peer optional） |
| `@deepseek-ai/dsh-session`、`dsh-workspace` | 会话驱动 | 宿主提供（peer optional） |

### 7.2 开发环境（本机已具备）

| 项 | 值 | 备注 |
| --- | --- | --- |
| Node.js | ≥ 22.19（建议 24） | 本机 npx 缓存证实 |
| pnpm | ≥ 9 | 全家桶工具链 |
| TypeScript | ^6.0.3 | 与 dsh-forge 一致 |
| vitest | ^4.1.8 | 测试 |
| tsdown | ^0.22.2（仅 client 分包时） | 全家桶构建 |
| Git | 2.55.0 | 本机已装（shell 已恢复） |
| 参考插件源码 | `~/.dsh/profiles/web/node_modules/@linxin666/{dsh-ssh,dsh-client-ui-task-board,dsh-plugin-publisher,...}` | 照抄模式不照抄代码 |

### 7.3 目录约定

- 插件源码：`E:/deepseekwork/dsh-novel-writer/`（已存在 `DEVELOPMENT-PLAN.md`，本方案与其并存）
- 数据：`~/.dsh/dsh-novel-writer/{projects,lorebook}`（可配置）
- 预设：`~/.dsh/.agent-presets/novel-writer/`
- 分析临时区：`E:/deepseekwork/operit-analysis/`（已解包 v0.5.0/v0.6.0 源码，供移植时逐行对照）

---

## 8. 需调用的工具汇总

| 类别 | 工具 | 阶段 |
| --- | --- | --- |
| 代码分析 | read / grep / glob（读夏瑾源码、SDK 源码、参考插件） | P0-P3 全程 |
| 脚手架 | `dev_scaffold_plugin` | P0 |
| 构建 | `dev_build_plugin`（build.sh + tsc + tsdown） | P0-P3 |
| 注入测试 | `dev_inject_plugin` / `dev_injected_list` / `dev_uninject_plugin`（免重启验证） | P0-P1 |
| 热重载 | `dev_reload_package` | P1-P2 |
| 组合验证 | `npx -y @deepseek-ai/dsh plugin --profile scratch add <path>` + `--dump-config` | 每阶段末 |
| 运行时验证 | `npx -y @deepseek-ai/dsh --profile headless "<任务>"` | P0-P2 |
| 单测 | vitest（`pnpm test`） | P0-P3 |
| 类型检查 | `pnpm typecheck`（tsc --noEmit） | 每阶段末 |
| 发布 | `npm pack` / `dev_release_plugin`（可选） | P3 |
| 安装验证 | `dsh plugin --profile web add <tgz>` | P3 |

---

## 9. 需阅读的资源清单（映射表）

### 9.1 本仓库（OperitForge，已解包于 `E:/deepseekwork/operit-analysis/v060/`）

| 文件 | 移植要点 |
| --- | --- |
| `worldbook/dist/shared/worldbook_service.js`（783 行） | 条目/分组/导入 CRUD 全量移植 |
| `worldbook/dist/shared/worldbook_variables.js`（753 行） | InitVar/JSONPatch/宏渲染全量移植 |
| `worldbook/dist/main.js`（561 行） | 注入组装顺序/匹配/角色卡三级绑定语义 |
| `worldbook/dist/shared/worldbook_storage.js`（121 行） | legacy 迁移思路（重写为迁移链） |
| `worldbook/dist/packages/worldbook_tools_plus_build.js`（650 行） | 13 个工具的参数 schema（JSON 描述完整可照抄） |
| `worldbook/dist/ui/worldbook_manager/index.ui.js` | 功能清单（列表/表单/分组/导入/宏速查）——UI 不复用 DSL，按清单重写 React |
| `prompt/dist/main.js`、`prompt_back/main.js` | 前/后注入差异；`prompt/dist/shared/prompt_storage.js` 独立存储 |
| `prompt/dist/packages/xiajin_prompt_tools.js`、`prompt_back/packages/prompt_back_tools.js` | 工具集与 `prompt_back_` 前缀冲突处理 |
| `manifest.json` | subpackages 声明结构（DSH 中改为单包） |
| `main.js` | 三组件装配顺序（`ToolPkg._m` 混淆段忽略） |
| `i18n/zh-CN.js`、`en-US.js` | 文案全集（可直接复用翻译） |
| `v050/xiajin_novel_build/**` | 对比 v0.6.0 验证构建修复点（S3 证据） |

### 9.2 本工作区既有方案

| 文件 | 用途 |
| --- | --- |
| `E:/deepseekwork/dsh-novel-writer/DEVELOPMENT-PLAN.md` | 九阶段流程/模板库/上下文管理/校验/路线图（本方案继承其全部内容） |
| `E:/deepseekwork/dsh-plugin-publisher/` | 零依赖 host 骨架、settings 门禁、技能注册样板 |

### 9.3 DSH SDK 与参考插件（`C:/Users/xiy/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/` 与 `~/.dsh/profiles/web/node_modules/@linxin666/`）

| 文件 | 用途 |
| --- | --- |
| `dsh-tools/lib/index.js`（defineTool 契约） | 工具注册 |
| `dsh-settings/lib/index.js:618`（installSettingsSection） | 设置命名空间 |
| `dsh-skill/lib/index.js:193`（skills.register） | 技能注册 |
| `dsh-agent-presets/lib/index.js:160`（USER_PRESET_DIR） | 预设安装位置 |
| `dsh-ssh/src/tools.ts`（已安装包） | 工具注册实操样板 |
| `dsh-client-ui-task-board/src/core/{execution,store}.ts` | 会话驱动、存储解析 |
| `dsh-client-ui-task-board/src/client/{sidebar-entry,settings-form}.ts` | GUI 装配样板 |

---

## 10. 风险与对策（增量）

| 风险 | 对策 |
| --- | --- |
| 夏瑾代码量大（~630KB）移植周期长 | 按 P0 顺序先移植 8 个工具闭环；service/variables 用脚本化对照移植（函数级逐行），UI 只移植功能清单不移植 DSL |
| Operit 事件语义（after_compose_system_prompt/before_finalize_prompt）在 DSH 无对应 Hook | 注入点收敛到上下文包组装器（写章路径），不依赖全局 prompt Hook；可选增强再挂 `ctx.systemPrompt.section` |
| 变量宏兼容性（SillyTavern 语法）在 DSH 场景价值有限 | 保留语法兼容（低成本），主推 `{{ledger::}}` 新宏；导入警告机制沿用 |
| 关键词扫描在长篇小说场景命中面过宽 | scan 对象默认限"当前章细纲+前 3 章"，`scan_depth` 可配；匹配结果受 `injectionBudget` 裁剪 |
| 数据迁移（夏瑾 JSON → 本插件格式） | P3 提供 `lorebook_import` 兼容导入（夏瑾 entries.json 直接可导），并写迁移文档 |
| ★内置提示词质量参差、AI 味词库误伤 | 提示词全部人工打磨 + 模板渲染单测；AI 味词默认 warning 级不阻断 + 项目级词表可覆盖；P2 灰度统计误报率 |
| ★模型层诊断（黄金三章）不稳定 | 双层设计：规则层离线兜底（评分必出），模型层失败降级为规则层报告 + 提示"深度诊断未完成" |
| ★百万字压测依赖脚本模拟 | `simulate-1m.mjs` 用真实 store/校验器（不 mock），模拟数据确定性生成（seed 固定），保证可回归 |
| ★对话式引导意图误判 | 意图解析高置信才直连工具，低置信走「确认面板」；模型通道仅在规则通道空结果时启用（省额度） |
| ★面向大众的安装门槛（DSH 本身非大众软件） | README 给「一句话安装」+ 截图 + 视频演示链接占位；示例项目保证装完即有可玩内容；发布到开源插件索引（beancookie/awesome-dsh-plugin 等） |

---

## 附录 A：dsh-forge 工程经验借鉴（来源：已被删除的 `zhn1100/dsh-forge` 仓库任务书与源码，本方案分析期恢复）

用户最初提供的 `zhn1100/dsh-forge` 仓库虽与小说无关（是 DSH 插件开发环境，唯一提交为删除 1075 行任务书），但其工程方法论对本插件开发有借鉴价值，已并入本方案：

1. **实验状态机纪律**（REQUEST→…→DELIVER，含 DIAGNOSE/REVISE 回环）→ 本插件 `novel_commit` 门禁与审计日志同构；
2. **验证分级**（quick/package/full：typecheck→lint→test→build→hygiene）→ P3 门禁直接采用；
3. **证据分层**（static/package/runtime）→ 测试策略 §8 沿用；
4. **原子写 + 0600 权限 + 内容寻址** → `store.ts` 写入规范；
5. **卫生检查**（hygiene.mjs：必需文件/ESM/peer optional）→ 发布前检查清单；
6. **HOME 隔离与同步**（Forge Home）→ 本插件不采用（小说数据应留在普通 Home 的 `~/.dsh/dsh-novel-writer/`，因为用户要直接使用），但"配置文件不污染其他 Profile"原则保留。

（以上 6 点在 DEVELOPMENT-PLAN.md 中未提及，是本方案相对 v1 的补充来源。）

---

## 附录 B：方案版本差异总表（v1 → v2 → v3）

| 维度 | v1（DEVELOPMENT-PLAN.md） | v2（夏瑾移植） | ★v3（大众化开箱即用，本版） |
| --- | --- | --- | --- |
| 创作流程 | 九阶段状态机 | 不变 | 不变 + 创作向导（wizard） |
| 世界书/lorebook | 无 | 全量移植（夏瑾）并修复 4 类缺陷 | 不变 + 卷末自动沉淀（百万字场景） |
| 提示词前/后 | 无 | 移植并三合一重构（scope 模型） | 不变 |
| 变量系统 | 事实账本 ledger（仅一致性） | 账本 + 变量引擎融合（JSONPatch/宏/InitVar） | 不变 + 时间线引擎 |
| 上下文注入 | 三层记忆静态组装 | + lorebook 动态命中注入（预算裁剪） | + 检索增强（倒排索引按需抽取） |
| 校验 | 四族规则 | + 注入预算/命中报告 | + AI 味密度评分 + 黄金三章规则层 |
| 新增模块 | 12 项（§3.5） | + 世界书导出/变量查看器/注入预览 | + 提示词库/去味/诊断/一致性引擎/字数统计/工坊助手（§3.4-3.8，N11-N16） |
| 内置提示词 | 阶段模板 9 份 | — | ≥60 模板（创作/文风/去味/润色/诊断/引导/世界书，§3.5） |
| GUI | 侧边栏 + 项目工作台 | + 世界书管理/校验面板/回滚 | + 向导/助手对话/诊断评分卡/去味高亮/统计面板/提示词库浏览器（§3.4） |
| 对话式引导 | 提问式补全（≤3 问） | 不变 | 工坊助手 + 意图解析 + 确认面板（§3.8，参考 AI 酒馆） |
| 章节字数 | 无 | 无 | 自动统计 + 达标徽标 + 全书统计面板（§3.7） |
| 百万字一致性 | 分层记忆 + 预算 | 不变 | + 摘要压缩链/世界书沉淀/一致性巡检/时间线（§3.6） |
| 面向大众 | — | — | 示例项目/新手模式/一键动作流/新手教程/i18n（§3.4） |
| 测试 | core 单测 | + 迁移/组装器 | + 百万字压测脚本/新手路径 E2E/模板渲染单测 |
| 工程纪律 | 有 | + dsh-forge 六项方法论 | 不变 |
