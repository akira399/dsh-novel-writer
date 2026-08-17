# DSH 网文创作插件（dsh-novel-writer）开发方案与规划

> 本文档是插件从 0 到上线的完整开发方案，条目化呈现，可直接指导编码实现。
> 所有 DSH 集成机制均基于官方 NPM SDK（`@deepseek-ai/*`）与本机已验证的插件实践
> （dsh-task-board / dsh-aionui-panel / dsh-ssh / dsh-liangshen / dsh-plugin-publisher），
> 不依赖任何 DSH 源码 checkout。

---

## 0. 方案摘要

- **插件名**：`dsh-novel-writer`（npm 包 `@linxin666/dsh-novel-writer`，host + client 双半区单包）
- **核心目标**：让 DSH 按规范化流程创作网络小说——选题 → 核心设定 → 人设 → 全书大纲 → 分卷 → 分章细纲 → 正文撰写 → 修订 → 完本归档，每阶段有模板、有门禁、可校验、可回滚。
- **一句话架构**：核心流程状态机 + 规范模板库跑在 host 半区（文件落盘），通过「运行时技能（软引导）+ agent 工具（硬轨道）+ agent 预设（模式锚定）」三通道约束模型行为，GUI 侧边栏供人机协同，设置页卡片管理配置。
- **关键设计取舍**：小说正文长文存储放 host 文件系统（`~/.dsh/dsh-novel-writer/projects/`），不用 localStorage（容量不足）；上下文管理用「分层记忆 + 事实账本」压缩组装，解决长文超窗问题。

---

## 1. 核心目标与设计原则

### 1.1 核心目标（验收锚点）

1. 模型创作必须走完规定的阶段序列，**不允许跳阶段**（除非用户显式放行）。
2. 每阶段产出物必须符合该类型模板的规范字段，且通过该阶段门禁校验后才能推进。
3. 写作正文时，模型获得的是**受控上下文包**（全书设定 + 大纲 + 人物卡 + 邻近章节 + 事实账本），而非整个项目文件，保证质量和一致性同时控制 token 成本。
4. 人（用户）在任何阶段可介入：补信息、改产物、放行、回退、要求重写。
5. 完本后可一键导出成稿，并按平台投稿格式整理。

### 1.2 设计原则

| 原则 | 含义 | 落地方式 |
| --- | --- | --- |
| 硬轨道 + 软引导 | 阶段流转必须走工具，创作方法用技能引导 | 工具 `novel_commit` 是唯一推进入口；技能 `novel-writing-workflow` 提供全流程方法 |
| 人机协同 | 模型不独占决策 | 选题/设定阶段采用「提问式补全」；门禁可被用户放行/驳回 |
| 上下文预算 | 上下文包有 token 上限，超限降级 | `contextBudget` 配置 + 分层摘要 + 账本压缩 |
| 可校验可回滚 | 一切产物可验证、可回溯 | 纯函数校验器 + 产物版本历史 + 阶段回退 |
| 零侵入 | 不改 DSH 源码，只走 bundle/profile/技能/预设 | 参照 dsh-web-ui 全家桶规范 |
| 可单测 | 核心逻辑与 UI 解耦 | 状态机/校验器/组装器全放 `src/core/` 纯函数 |

---

## 2. 总体架构

### 2.1 分层结构（与全家桶包规范一致）

```text
dsh-novel-writer/
├── package.json             # dsh.bundle.patch + dsh.client 双声明；零依赖运行时
├── cordis.patch.yml         # - insert: - id: dsh-novel-writer / name: '@linxin666/dsh-novel-writer'
├── tsconfig.json / tsconfig.build.json / tsconfig.client.json
├── tsdown.config.ts         # import 仓库共享 shared/tsdown.client.ts（若入全家桶）
├── src/
│   ├── index.ts             # host 半区：插件装配（技能/工具/设置/路由/会话驱动）
│   ├── core/                # 两侧共享纯逻辑（本插件核心资产，全部可单测）
│   │   ├── workflow.ts      #   阶段状态机 + 流转规则 + 门禁判定
│   │   ├── store.ts         #   项目文件读写 + schema 版本迁移 + 索引
│   │   ├── templates.ts     #   类型模板库 + 阶段模板 + 风格约束表
│   │   ├── context.ts       #   章节上下文组装器（分层记忆打包）
│   │   ├── validation.ts    #   校验规则引擎（结构/一致性/内容/剧情）
│   │   ├── ledger.ts        #   事实账本（人物/物品/地点/时间线状态）
│   │   ├── foreshadow.ts    #   伏笔登记与回收跟踪
│   │   ├── revision.ts      #   修订模式（错别字/节奏/文风/全文润色）diff 统计
│   │   └── export.ts        #   成稿导出（txt/markdown/平台排版）
│   └── client/              # browser 半区（Web GUI）
│       ├── index.ts         #   __ModuleLoader__.load 闭包工厂入口
│       ├── sidebar-entry.ts #   侧边栏「小说工坊」入口
│       ├── board/           #   项目面板：阶段流程视图/产物编辑/章节列表/校验报告
│       ├── settings-form.ts #   设置页卡片（web-ui.plugin.item 槽，order 100+）
│       └── locales.ts       #   zh 为 key 源，en 键集完整对照
├── assets/
│   └── presets/novel-writer.json   # 「小说创作模式」agent 预设模板
├── .dsh/skills/novel-writing-workflow/SKILL.md  # 流程技能本体（若走技能文件分发）
├── tests/                   # vitest（core 全覆盖 + client 冒烟）
├── README.md / README.zh.md / README.i18n.yaml   # 中英三件套
└── AGENTS.md                # 包级 AI 指令
```

### 2.2 数据流

```text
用户(GUI) ──创建项目──▶ host store ──▶ 项目目录落盘
用户(GUI) ──生成下一章──▶ host session.prompt(组装好的上下文包) ──▶ agent 写作
agent ──novel_commit──▶ host 状态机校验 ──▶ 推进阶段/写回产物
agent ──novel_validate──▶ core/validation ──▶ 校验报告（GUI 与 agent 双可见）
```

---

## 3. 功能模块设计

### 3.1 流程引擎（核心模块 1）

**阶段状态机**：九阶段线性主链，允许「修订」阶段回环到任意已批准阶段。

```text
topic(选题) → setting(核心设定) → character(人设) → outline(全书大纲)
→ volume(分卷) → chapter(分章细纲) → writing(正文) → revision(修订) → done(完本)
```

每个阶段实例状态：`locked → in_progress → review → approved`（另有 `skipped` 供用户跳过）。

**门禁规则（gate）**：

1. 前一阶段必须 `approved` 或 `skipped`，当前阶段才能进入 `in_progress`。
2. 阶段产物提交（`novel_commit`）时自动跑该阶段绑定的校验器；`error` 级问题未清零则进入 `review` 挂起，不自动推进。
3. 校验通过 → `approved` 并解锁下一阶段；`warning` 级问题仅提示不阻断。
4. 用户可强制放行（`novel_override_phase`）或驳回（回到 `in_progress`）——所有覆盖动作写入项目审计日志。
5. `writing` 阶段特殊：不要求一次提交整本，按章推进（章节级门禁：字数/钩子/账本冲突）。

**版本与回滚**：每阶段产物每次提交存一份版本快照（`versions/<phase>/v<n>.md/json`）；支持回退到任意历史版本（回退也生成新版本，不删除旧数据）。

**审计日志**：`audit.jsonl` 记录每次 commit/override/validate/rollback 的事件（时间、动作、触发方 user|agent、摘要）。

### 3.2 规范模板库（核心模块 2）

**类型模板（GenreTemplate）**：内置 8 类——玄幻、仙侠、都市、科幻、悬疑、历史、游戏、同人；每类定义：

| 模板字段 | 内容示例（玄幻） |
| --- | --- |
| `topicChecklist` | 题材热度/差异化卖点/核心冲突是否成立/读者人群 4 项自检 |
| `settingFields` | 世界观、力量体系（等级表）、地图、时间线、规则（修炼资源/代价） |
| `characterFields` | 主角动机、金手指、成长线、反派弧、配角关系网 |
| `outlineRules` | 黄金三章要求、主线三幕结构、爽点密度、卷间递进 |
| `chapterNorms` | 每章 2000-4000 字、章末钩子必填、每章至少一个事件推进 |
| `validatorIds` | 默认启用的校验规则集合 |
| `stylePreset` | 该类型默认文风（如玄幻：第三人称、过去时、描写密度中） |

**阶段模板（PhaseTemplate）**：每阶段一份「创作指令模板」，含必填字段清单、写作提示、示例片段。模型进入某阶段时，该模板 + 项目现状 + 用户补充被组装成阶段任务提示（见 3.3 上下文包）。

**风格约束表（StyleSheet）**：视角（第一/第三人称）、时态、文风一句话、对话占比区间、描写密度、禁用词表、AI 味词表（内置默认表如「总而言之/不禁/仿佛」等高频 AI 腔，可增删）、「每章必有钩子」开关。

**校验规则模板**：按类型给出默认启用的规则集（如悬疑默认启用「伏笔回收率」规则）。

### 3.3 章节上下文管理（核心模块 3）

解决长篇小说「全书放不进上下文」的核心模块。三层记忆：

| 层 | 内容 | 注入策略 |
| --- | --- | --- |
| L1 全书级 | 书名/类型/风格约束/目标读者 + 全书大纲压缩版 | 每章必带（压缩到 ~500 字内） |
| L2 卷章级 | 本卷细纲全文 + 当前章细纲 + 前 N 章全文（N 可配，默认 3） | 每章必带 |
| L3 记忆级 | 更早章节的 AI 摘要（≤200 字/章）+ 事实账本相关条目 + 涉及人物整卡 + 相关伏笔 | 按需抽取 |

**上下文组装器（context.ts）**：输入当前章号，输出一个 `ContextPacket`（数据结构见 6.4），执行顺序：

1. 读项目配置与大纲 → 压缩 L1。
2. 取当前卷细纲、当前章细纲、前 N 章全文 → L2。
3. 从账本索引取「当前章细纲中出现的人物/地点/物品/伏笔 id」→ 拉取相关摘要、整卡、账本条 → L3。
4. 按 `contextBudget`（token 上限）裁剪：优先保 L2 全文，其次保 L1，最后裁 L3 的摘要条数（超限时把旧摘要再压缩为一条总摘要）。
5. 附加硬约束：字数区间、禁用词表、钩子要求、本期禁止剧透项（如未回收伏笔不得提前揭露）。

**章节摘要生成**：每章提交后由模型生成结构化摘要（摘要 + 关键事件 + 账本变更），存 `summary/` 与 `ledger.json`。摘要生成也走 session，或由 `novel_commit` 的响应中模型自报（工具返回值里要求携带）。

**事实账本（ledger.ts）**：实体-字段-值三级事实表（如 `人物:林远 / 境界 / 筑基三层 / 第12章`），每章提交时以增量（`ledgerDelta`）更新；校验器用它对前后章做一致性比对（见 3.4）。

### 3.4 质量校验（核心模块 4）

校验规则引擎为纯函数（`validate(artifact, book) → ValidationReport`），规则分四族：

| 规则族 | 规则示例 | 级别 |
| --- | --- | --- |
| 结构 | 章节字数在区间内；章标题符合规范；卷章编号连续；产物字段齐全 | error/warning |
| 一致性 | 账本实体状态前后冲突（人物境界倒退、物品消失、地点错位）；时间线矛盾 | error |
| 内容 | 命中禁用词表；AI 味词密度超标；视角/人称漂移；对话占比越界 | warning |
| 剧情 | 本章是否完成细纲目标（偏离度）；章末是否有钩子；伏笔应回收未回收；大纲承诺未兑现 | warning/error |

**触发时机**：`novel_commit` 自动触发（绑定规则集）；`novel_validate` 手动触发（agent 自检或 GUI 点击）；修订后复检。

**校验报告**：`ValidationReport` 结构化输出（规则 id/级别/对象/消息），GUI 面板展示 + 写入项目 `reports/`；agent 端通过工具返回值看到同份报告。

### 3.5 补充功能工具（用户要求「其他还没提到的功能工具」）

| # | 工具模块 | 说明 | 优先级 |
| --- | --- | --- | --- |
| 1 | 灵感库 IdeaBank | 随时记录灵感片段（一句话/桥段/名字），选题阶段可拉取聚合；存储同项目目录 | P1 |
| 2 | 伏笔管理器 Foreshadowing | 登记伏笔（埋设章节/内容/计划回收章节），回收自动核对；悬疑/玄幻必备 | P2 |
| 3 | 术语表 Glossary | 从设定自动生成（力量体系/地名/专有名词），注入上下文包防用词漂移 | P2 |
| 4 | 市场调研辅助 MarketResearch | 选题阶段调用 `web_search` 查热门题材/榜单热词，汇总进选题报告（消耗网络，需确认） | P2 |
| 5 | 导出发布 Export | 完本导出：纯文本、Markdown 合订本、按平台格式（起点/番茄章节排版：标题+正文+作者的话），自动统计总字数 | P2 |
| 6 | 定时连载 Scheduler | 仿 dsh-task-board 浏览器端 cron（如每日 20:00 写一章），纯客户端调度，需 GUI 打开，执行前确认消耗 | P3 |
| 7 | Git 版本管理 | 每章提交一次 git commit（复用 dsh-git-graph 可视化），回滚走 git；不强制，可配 `useGit` | P3 |
| 8 | 复盘报告 Retrospective | 完本后统计：字数曲线、章节字数分布、校验问题分布、修订次数，生成创作复盘 | P3 |
| 9 | 敏感内容过滤 Compliance | 内置平台违禁内容清单，选题/设定阶段即检查，正文校验也挂一条 | P1 |
| 10 | 修订润色模式 RevisionModes | 三种模式：错别字/病句（轻改）、节奏调整（重写段落）、文风统一（全文轻润），逐章或全书批处理 | P2 |
| 11 | 多项目管理 + 模板复制 | 项目列表/归档；支持以「已完本项目」为模板克隆新项目（结构复制，正文不复制） | P2 |
| 12 | 提问式补全（人机协同） | 选题/设定阶段 agent 主动向用户提问（每轮 ≤3 问），答案回填产物字段 | P1 |

---

## 4. 与 DSH 的调用与交互方式

### 4.1 三通道约束模型（核心交互设计）

| 通道 | 机制 | 作用 | 实现依据 |
| --- | --- | --- | --- |
| 软引导 | 运行时技能注册 `ctx.skills.register({ name: 'novel-writing-workflow', description, whenToUse, content, source, resourceBase })` | 用户说「开始写小说」即加载全流程方法（阶段定义/模板用法/工具用法/写作规范） | dsh-plugin-publisher 已验证的 skills 契约；技能可另以 `.dsh/skills/` 文件随包分发 |
| 硬轨道 | 注册 agent 可调用工具 `novel_*`（见 4.2） | 阶段推进/产物提交/校验/导出只能走工具，防止模型口头跳阶段 | 仿 dsh-ssh 工具注册方式 |
| 模式锚定 | 「小说创作模式」agent 预设（写入 `~/.dsh/.agent-presets`，升级插件自动更新） | 新建会话时选择预设即进入创作模式：锚定 persona + 预装工具 + 指向项目工作区 | 仿 dsh-liangshen 预设机制 |

三者优先级：工具（必须走）> 技能（方法指导）> 预设（模式锚定）；预设内容保持最小，避免与技能重复。

### 4.2 agent 工具清单（硬轨道）

| 工具名 | 入参要点 | 用途 | 备注 |
| --- | --- | --- | --- |
| `novel_projects` | 无 | 列出项目与各项目当前阶段 | 只读 |
| `novel_phase` | `projectId, phase?` | 进入/查看某阶段，返回阶段模板 + 必填字段清单 + 项目现状 | 进入阶段时自动组装阶段任务提示 |
| `novel_commit` | `projectId, phase, artifact(结构化内容)` | 提交阶段产物：写盘 → 校验 → 推进状态机 | **唯一推进入口**；返回校验报告 |
| `novel_write_chapter` | `projectId, chapterNo?, brief?` | 按上下文包写一章：返回上下文包 → 模型输出正文 → 写盘 | 正文由模型直接在回复中产出后写入，或走会话执行（4.4） |
| `novel_revise` | `projectId, target(chapter/book), mode` | 进入修订模式（错别字/节奏/文风/全文） | 产出新版本，不覆盖原稿 |
| `novel_validate` | `projectId, target, rules?` | 手动跑校验器 | 模型自检用 |
| `novel_ledger` | `projectId, entity?` | 查询事实账本 | 写作前查一致性 |
| `novel_foreshadow` | `projectId, action(plant/reveal/list)` | 伏笔登记与回收 | P2 |
| `novel_idea` | `projectId, action(add/list)` | 灵感库读写 | P1 |
| `novel_override_phase` | `projectId, phase, action(force/rollback)` | 用户放行或回退阶段 | 记录审计日志 |
| `novel_export` | `projectId, format` | 导出成稿 | P2 |
| `novel_stats` | `projectId` | 字数/进度/校验问题统计 | 只读 |

### 4.3 设置页集成（双端）

- **host（推荐最小模式，本机已验证）**：`ctx.inject(["settings"], (sctx) => { const scope = sctx.settings.register(NS, schema, { base }); sync(scope.get()?.enabled ?? true); scope.watch(() => sync(scope.get()?.enabled ?? true)); })`——照抄 dsh-plugin-publisher `lib/index.js` 的 `sync()` 模式（注册/注销技能、工具随 enabled 联动）。schema 用 schemastery 形状（`Object.assign(fn, { toJSON })`），零依赖。
- **host（SDK 规范模式）**：`installSettingsSection(ctx, settingsNamespace('dsh-novel-writer'), <z-schema>, <composition entry>, { setSource, onChange })`（`@deepseek-ai/dsh-settings`，签名已核实：`(ctx, ns: SettingsNamespace, schema: z<T>, entry: T, hooks: { setSource, onChange })`），自动处理 settings 服务消失时回退 entry 的接线。
- **client**：注入 `settingsScope`（`@deepseek-ai/dsh-client-ui-settings`）读写命名空间；注册设置卡片进 `web-ui.plugin.item` 槽（`declare module '@deepseek-ai/dsh-client-ui-slots'` 声明槽位，`order: 100+` 避开内置卡片）。
- **consent 门禁**：`enabled` 字段驱动技能/工具注册（默认开启，GUI 可停用；停用后技能注销、工具不可用，已有项目文件保留）。
- **onChange 热生效**：配置修改（如默认类型、字数区间）不重启即生效；`enabled=false` 即时注销技能。

### 4.4 会话执行（GUI 驱动写作）

「生成下一章」按钮流程（仿 dsh-task-board `core/execution.ts`，该实现跑在 **client 半区**，经 `sessions.binding(id).session.prompt([{type:'text',text}], 'queue')` + 会话快照订阅至 settle 判定完成）：

1. host 经 `workspaces` 服务取/建一个真实 session（blank-session 复用或 `session.create`）。
2. session 重命名为「书名 · 第 N 章」。
3. 用 `session.prompt` 发送组装好的 `ContextPacket` 转成的写作指令。
4. 订阅会话快照直至本轮 settle，取回正文 → `novel_commit` 等价流程写盘 + 摘要 + 账本。
5. 消耗 API 额度，执行前 GUI 确认弹窗（同 task-board 的确认语义）。

两种驱动位置二选一（推荐 host 侧，agent 工具与 GUI 按钮共用同一执行服务）：
- **host 侧驱动**（推荐）：`ctx.inject(["sessions", "workspaces"])` 注入 host 服务，`novel_write_chapter` 工具内部直接走本流程；GUI 按钮经 `/novel-writer/*` 路由触发同一服务。
- **client 侧驱动**：照抄 dsh-task-board `execution.ts`（已证实可用），但 agent 工具侧需另写一套 host 路径，双份维护。

### 4.5 系统提示词注入（可选增强）

对「已绑定项目工作区的会话」，经 `@deepseek-ai/dsh-system-prompt` 注入一行横幅：「当前会话绑定小说项目 X，当前阶段 Y，创作请遵循 novel-writing-workflow 技能，推进必须使用 novel_* 工具」。P2 实现，避免侵入普通会话。

### 4.6 数据访问路由（client ↔ host）

client 半区经 host 注册的 HTTP 路由 `/novel-writer/*`（仿 dsh-aionui-panel 的 `/aionui-panel/*`）读写项目文件；本地先读缓存索引，变更走路由写回，跨刷新与 dsh 重启数据存活（文件在 host 磁盘，天然满足）。

---

## 5. 配置项设计

### 5.1 全局设置（设置页命名空间 `dsh-novel-writer`）

| 配置键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | true | 插件总开关（consent 门禁） |
| `defaultGenre` | string | `fantasy` | 新建项目默认类型模板 |
| `defaultWordPerChapter` | [number, number] | `[2000, 4000]` | 默认每章字数区间 |
| `defaultStylePreset` | string | `modern-web` | 默认风格预设 id |
| `contextBudget` | number | 12000 | 上下文包 token 预算 |
| `prevChaptersFull` | number | 3 | 注入前 N 章全文 |
| `validationLevel` | 'off' \| 'normal' \| 'strict' | `normal` | 全局校验强度 |
| `storageDir` | string | `~/.dsh/dsh-novel-writer/projects` | 项目存储目录 |
| `aiTasteWords` | string[] | 内置表 | 全局 AI 味词表（项目级可覆盖） |
| `useGit` | boolean | false | 每章提交 git（P3） |

### 5.2 项目级配置（`book.json` 内 `config`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` / `author` / `tags` / `audience` | string[] | 元信息 |
| `genre` | GenreId | 类型模板 id（决定字段/规则/规范） |
| `wordTargets` | { perChapterMin/Max, perVolume?, perBook? } | 字数目标 |
| `style` | StyleSheet | 风格约束（含项目级禁用词/AI 味词覆盖） |
| `phaseGating` | Record<PhaseId, boolean> | 每阶段门禁开关（默认全开） |
| `templateId` | string | 采用哪套模板（可克隆自完本项目） |
| `compliance` | boolean | 敏感内容过滤开关 |

### 5.3 阶段级配置

- 每阶段可独立配置：绑定校验器集合、是否要求人工确认、产物字段白名单（供模板覆盖）。

---

## 6. 数据结构定义

### 6.1 项目目录布局

```text
~/.dsh/dsh-novel-writer/
└── projects/
    └── <projectId>/
        ├── book.json            # 项目元数据 + 配置 + 阶段状态 + 统计（核心状态文件）
        ├── audit.jsonl          # 审计日志
        ├── docs/
        │   ├── topic.md         #   选题报告
        │   ├── setting.md       #   核心设定
        │   ├── characters.md    #   人设（人物卡列表）
        │   ├── outline.md       #   全书大纲
        │   └── volumes/         #   分卷细纲 volume-<n>.md
        ├── chapters/
        │   └── ch<no>.md        # 正文（frontmatter 内嵌章节元数据 JSON）
        ├── summary/             # 每章摘要 summary-<no>.md
        ├── ledger.json          # 事实账本（全量）
        ├── foreshadow.json      # 伏笔登记表
        ├── glossary.json        # 术语表
        ├── versions/<phase>/v<n>.md   # 阶段产物版本历史
        ├── reports/             # 校验报告 validation-<ts>.json
        └── ideas.md             # 灵感库
```

### 6.2 核心类型定义（TS，`src/core/types.ts`）

```ts
// —— 项目与阶段 ——
export interface Book {
  id: string;                     // bk_yyyyMMdd_xxxx
  title: string;
  genre: string;                  // 模板 id
  author?: string;
  status: 'drafting' | 'finished' | 'abandoned';
  currentPhase: PhaseId;
  config: BookConfig;
  phases: Record<PhaseId, PhaseState>;
  stats: { totalWords: number; chapterCount: number; lastWriteAt?: string };
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;          // 迁移用
}

export type PhaseId =
  | 'topic' | 'setting' | 'character' | 'outline'
  | 'volume' | 'chapter' | 'writing' | 'revision' | 'done';

export type PhaseState =
  | 'locked' | 'in_progress' | 'review' | 'approved' | 'skipped';

export interface PhaseState {
  id: PhaseId;
  state: PhaseState;
  validatorIds: string[];         // 本阶段绑定校验器
  report?: ValidationReport;      // 最近一次校验结果
  version: number;                // 产物修订次数
  approvedAt?: string;
}

// —— 章节与记忆 ——
export interface Chapter {
  id: string;                     // ch_001
  no: number;
  volumeId: string;
  title: string;
  status: 'draft' | 'revised' | 'approved';
  version: number;
  words: number;
  hook?: string;                  // 章末钩子自述
  brief?: string;                 // 一句话梗概（细纲对照用）
  summary?: string;               // AI 摘要（≤200 字）
  events: string[];               // 关键事件
  ledgerDelta: LedgerDelta;       // 本章事实变更
  deviations?: string[];          // 与细纲偏离说明
  file: string;
}

export interface LedgerEntry {
  entity: string;                 // 人物/物品/地点/时间线
  field: string;                  // 境界/位置/状态/余额…
  value: string;
  chapterNo: number;              // 记录章节
  confidence: 'high' | 'medium' | 'low';
}
export interface LedgerDelta { set: LedgerEntry[]; }

// —— 校验 ——
export interface ValidationRule {
  id: string;
  level: 'error' | 'warning';
  run(artifact: unknown, book: Book): ValidationIssue[];
}
export interface ValidationIssue {
  rule: string;
  level: 'error' | 'warning';
  target: string;                 // 定位对象（章节/字段/实体）
  message: string;
}
export interface ValidationReport {
  phase: PhaseId;
  passed: boolean;                // 无 error 级问题
  issues: ValidationIssue[];
  ranAt: string;
}

// —— 上下文包（写作时发给模型）——
export interface ContextPacket {
  projectBrief: string;           // L1 压缩（≤500 字）
  style: StyleSheet;
  characters: CharacterCard[];    // 本章涉及人物整卡
  outline: string;                // 本卷细纲全文
  prevChapters: { no: number; title: string; text: string }[];  // 前 N 章全文
  prevSummaries: string[];        // 更早章节摘要
  relatedSummaries: string[];     // 涉及人物/伏笔的相关摘要
  ledger: LedgerEntry[];          // 相关账本条
  foreshadows: Foreshadow[];      // 相关伏笔（未回收的不得剧透）
  currentBrief: string;           // 当前章细纲
  constraints: string[];          // 硬约束（字数/禁用词/钩子/防剧透）
  tokenBudget: number;
}

// —— 模板与风格 ——
export interface GenreTemplate {
  id: string; name: string;
  topicChecklist: string[];
  settingFields: FieldSpec[];
  characterFields: FieldSpec[];
  outlineRules: string[];
  chapterNorms: { words: [number, number]; hook: boolean; pacing: string };
  validatorIds: string[];
  stylePreset?: Partial<StyleSheet>;
}
export interface FieldSpec { key: string; label: string; required: boolean; hint?: string; }
export interface StyleSheet {
  pov: 'first' | 'third';
  tense: 'past' | 'present';
  tone: string;                   // 文风一句话
  dialogueRatio: [number, number];// 0-1 区间
  descriptionDensity: 'low' | 'medium' | 'high';
  forbiddenWords: string[];
  aiTasteWords: string[];         // 缺省合并内置表
  hookEveryChapter: boolean;
}
```

### 6.3 版本化与迁移

- `book.json` 带 `schemaVersion`；`store.ts` 提供 `migrate(raw, fromVersion)` 链式迁移（仿 dsh-task-board `core/store.ts` 的解析/修复逻辑）。
- 章节 frontmatter 解析器容错：缺字段给默认值，未知字段保留不丢。
- 版本快照目录按阶段/序号组织，回滚=复制历史版本回 `docs/` 并 bump 版本号、写审计。

---

## 7. 分阶段开发路线图

### P0 原型（第 1-2 周）—— 验证「引导模型走流程」可行性

**目标**：最小闭环——技能可加载、阶段可流转、产物可落盘、校验可跑、设置可开关。

任务清单：

1. 脚手架：`node scripts/dsh-plugin-new dsh-novel-writer`（全家桶路径）或按 dsh-plugin-publisher 技能 §3 手工骨架（独立路径）。
2. host 装配：`ctx.skills.register` 注册 `novel-writing-workflow` 技能（内容=全流程方法说明书 v1）；`enabled` 设置门禁（最小 schema，仿 dsh-plugin-publisher）。
3. core：`workflow.ts` 状态机（九阶段 + 门禁 + 审计）+ `store.ts`（book.json 读写 + 目录骨架）。
4. 工具：`novel_projects` / `novel_phase` / `novel_commit`（仅结构校验：字段齐全 + 字数）。
5. 硬编码模板：1 个类型（玄幻）+ 9 个阶段模板 v1。
6. 设置页卡片 v1：开关 + 默认类型选择。

验证标准：

- `node --check` 通过；`npx -y @deepseek-ai/dsh plugin --profile scratch add <path>` + `--dump-config` 出现插件行与 client 声明。
- headless profile 实测：「用 novel-writing-workflow 创建一本玄幻小说并推进到设定阶段」→ 技能 AVAILABLE、阶段按序流转、book.json 落盘正确。
- 停用 enabled → 技能 NOT_AVAILABLE。

交付物：可安装的原型包 + 运行验证记录。

### P1 核心流程（第 3-5 周）—— 完整创作闭环

**目标**：一条龙写完一本短篇（30-50 章体量）并完本。

任务清单：

1. 模板库：8 类类型模板 + 每阶段模板补全（含示例片段）；风格约束表 + 内置 AI 味词表。
2. 校验引擎：结构族 + 内容族规则（字数/标题/禁用词/AI 味词/视角漂移）。
3. 章节上下文管理：`context.ts` 组装器 + 摘要/账本增量写入（`novel_write_chapter` 返回上下文包）；`ledger.ts` 事实账本。
4. 会话驱动：`session.prompt` 写章流程（4.4）+ 确认弹窗。
5. GUI v1：侧边栏入口 + 项目列表 + 阶段流程视图（当前阶段/门禁状态）+ 章节列表 + 产物 Markdown 查看。
6. 补充工具：`novel_idea`（灵感库）、`novel_override_phase`、`novel_stats`；敏感内容过滤（compliance 规则）。
7. 提问式补全：选题/设定阶段技能内置「每轮 ≤3 问」交互协议。
8. 「小说创作模式」agent 预设（仿 dsh-liangshen 两阶段锚定思路，内容最小化）。

验证标准：

- 端到端 headless 实测：完整走完 九阶段 写 3 章样章，字数合规、账本无冲突、校验报告正确。
- core 单测：状态机流转 20+ 用例、组装器预算裁剪、账本冲突检测。
- GUI 手工验收：创建项目 → 推进 → 写章 → 校验报告展示 → 放行/回退。

交付物：可用的完整插件 + 3 章样章产物作为演示数据。

### P2 增强校验与上下文（第 6-8 周）—— 长文质量保障

**目标**：支撑 100 章以上长篇的质量与一致性。

任务清单：

1. 一致性族：账本跨章冲突检测（实体状态倒退/物品消失/时间线矛盾）。
2. 剧情族：细纲偏离度报告、章末钩子检测、伏笔回收核对（`foreshadow.ts` 伏笔管理器 + `novel_foreshadow` 工具）。
3. 上下文分层记忆增强：相关摘要抽取（按人物/伏笔索引）、超预算二级压缩。
4. 修订系统：`revision.ts` 三模式（错别字/节奏/文风）+ `novel_revise` 工具 + 版本对比视图。
5. 导出：`export.ts`（txt/markdown/平台排版）+ `novel_export` 工具。
6. GUI v2：产物编辑器（表单 + Markdown 双模式）、校验报告面板、版本回滚界面、术语表视图。
7. 可选：系统提示词横幅注入（4.5）；市场调研辅助（`web_search` 集成）。

验证标准：

- 100 章长文模拟（或用脚本生成 30 章 + 人工植入 5 处冲突）→ 校验器全部检出，上下文包 token 不超预算。
- 修订后 diff 统计正确；伏笔 埋设→回收 闭环可跟踪。
- 导出文件格式抽检通过。

交付物：质量保障完备的插件 + 校验测试夹具（冲突注入样例集）。

### P3 测试上线（第 9-10 周）—— 发布与收尾

任务清单：

1. 测试补全：core 全覆盖（状态机/迁移/校验/组装器/导出）、client 冒烟（`vitest.setup.ts` 的 `__ModuleLoader__` stub 或 `vi.mock`）、`server.deps.inline: [/@deepseek-ai\//]`。
2. 门禁全绿：`pnpm typecheck && pnpm test && pnpm build`；全家桶路径另跑 `pnpm aggregate:check` / `docs:check`。
3. 文档：README 中英三件套（功能/安装/配置/已知限制/安全模型）+ AGENTS.md；提交信息 Conventional Commits、无 emoji。
4. 隐私扫描（token/邮箱/绝对路径）+ 版本号与 tag 校验。
5. 发布：`dsh plugin --profile web add github:<owner>/<repo>` 安装验证；npm 发布（tag 触发）；可选登记全家桶/社区插件索引。
6. 灰度：真实小项目走完全流程，收集校验误报率，调规则级别。

验证标准：全部门禁绿、克隆发布产物复测通过、README 安装路径 3 分钟可跑通。

交付物：npm 可安装的正式版 + 发布说明 + 已知限制清单。

---

## 8. 测试策略

| 层 | 工具 | 覆盖点 |
| --- | --- | --- |
| core 单测 | vitest | 状态机全转移矩阵；门禁放行/驳回；store 迁移与损坏恢复；校验器各规则正反例；上下文组装器预算裁剪与降级；导出格式 |
| 校验夹具 | 静态 JSON | 冲突注入样例（境界倒退/伏笔未回收/禁用词/字数越界），保证校验器可回归 |
| client 冒烟 | vitest + jsdom | 侧边栏挂载、阶段视图渲染、设置卡片读写（mock settingsScope） |
| 组合测试 | dsh CLI scratch profile | `--dump-config` 插件行与 client 声明 |
| 运行时测试 | dsh CLI headless profile | 技能 AVAILABLE / 门禁 off→on；端到端写章 |
| 手工验收 | dsh web GUI | 侧边栏全流程、设置热生效、回滚、导出 |

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 长文超窗：全书注入上下文 | 质量下降/成本飙升 | 分层记忆 + 账本 + 预算裁剪（3.3），`contextBudget` 可调 |
| 模型口头跳阶段、不调用工具 | 流程失效 | 硬轨道唯一推进入口 + 门禁 + 校验报告打回；技能明确「未 commit 不得自称完成」 |
| 上下文包被模型忽略 | 一致性漂移 | 硬约束列进 `constraints`；校验器事后兜底检出 |
| API 额度消耗 | 用户不满 | 会话执行前确认弹窗；写章频率限制可配 |
| 平台合规（违禁内容） | 作品无法发布 | 选题/设定即检查 + 正文校验挂 compliance 规则 |
| 校验误报（AI 味词误伤） | 创作受阻 | 级别默认 warning 不阻断；项目级词表可覆盖；误报率在 P3 灰度统计 |
| 设置页/技能在升级时漂移 | 行为不一致 | 预设与技能随包分发、插件升级自动更新（仿 dsh-liangshen）；设置变更走 settings 文档热生效 |
| 单测依赖 DSH 源码 | 构建断裂 | 类型只来自官方 SDK；测试 fixture 自包含 |

---

## 10. 编码落地指引

### 10.1 参考实现（照抄模式，不照抄代码）

> 本机 `E:/deepseekwork/dsh-web-ui` 为部分检出（无 `packages/`），完整源码以**已安装包**为准：
> `~/.dsh/profiles/web/node_modules/@linxin666/<pkg>/src/`（含 TS 源）与 `lib/`（编译产物）。

| 参考 | 借鉴点 |
| --- | --- |
| `packages/dsh-task-board/`（本机：`dsh-client-ui-task-board/`） | package.json 双端声明形态、core/client 分层、`core/execution.ts` 会话驱动、`core/store.ts` 解析修复、sidebar-entry、settings 卡三件套、`core/scheduler.ts`（P3 定时连载） |
| `packages/dsh-aionui-panel/`（本机：`dsh-client-ui-aionui-panel/`） | host 路由 `/novel-writer/*` 提供文件数据、client 读取真实文件系统的模式 |
| `packages/dsh-ssh/`（本机：`dsh-ssh/`） | agent 工具注册方式（`ctx.tools.register(tool)`，tool = `{ name, description, schema(JSON Schema), ... }`）与工具入参 schema、安全模型文档 |
| `packages/dsh-liangshen/`（本机：`dsh-liangshen/`） | agent 预设写入 `~/.dsh/.agent-presets/<id>/{preset.yml,agent.cordis.yml,tool-bootstrap.mjs}`、升级自动更新 |
| `dsh-plugin-publisher/`（本机工作区 `E:/deepseekwork/dsh-plugin-publisher/`） | `ctx.skills.register` 契约与设置 consent 门禁（`ctx.inject(["settings"])` + `sync()` 模式）、零依赖 host-only 骨架、HTTP 路由注册（`webServer.register({kind, path, handler})`） |
| `packages/dsh-remote-web-ui/`（本机：`dsh-remote-web-ui/`） | `installSettingsSection` + `settingsScope.bind` + `web-ui.plugin.item` 卡片样板、`slots-augment.ts` 模块增强 |

### 10.2 关键命令速查

```sh
# 脚手架（全家桶路径，脚本位于完整仓库；本机 E:/deepseekwork/dsh-web-ui 为部分检出时改用下一条）
node scripts/dsh-plugin-new dsh-novel-writer
# 脚手架（本机可用）：DSH 会话内 dev_scaffold_plugin 工具直接生成骨架
#   dev_scaffold_plugin(dir=E:/deepseekwork/dsh-novel-writer, name=dsh-novel-writer, form=hybrid)
# 构建/测试/类型
pnpm --filter @linxin666/dsh-novel-writer build
pnpm --filter @linxin666/dsh-novel-writer test
pnpm typecheck
# 组合验证（scratch 无 agent 运行器，只查配置）
npx -y @deepseek-ai/dsh plugin --profile scratch add <包路径>
npx -y @deepseek-ai/dsh --profile scratch --dump-config
# 运行时验证（headless 真实激活）
npx -y @deepseek-ai/dsh plugin --profile headless add <包路径>
npx -y @deepseek-ai/dsh --profile headless "询问可用技能目录是否包含 novel-writing-workflow"
# 安装到 web
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:<owner>/<repo>
# 发布前门禁（全家桶路径）
pnpm aggregate:check && pnpm docs:check && pnpm test:scripts
```

### 10.3 实现顺序建议（首个迭代）

1. `src/core/types.ts`（6.2 类型）→ 2. `src/core/workflow.ts` 状态机 + 单测 → 3. `src/core/store.ts` 落盘 + 单测 → 4. `src/index.ts` 技能注册 + 2 个工具 → 5. headless 组合验证 → 6. 设置卡 → 7. GUI 只读面板 → 8. 进入 P1。

### 10.4 命名与仓库约定

- 仓库/包名 `dsh-novel-writer`；npm `@linxin666/dsh-novel-writer`（单包双半区，host 主逻辑 + `exports["./client"]`）。
- 技能名 `novel-writing-workflow`；预设名「小说创作模式」（id `novel-writer`）。
- 全部文案中英双语；代码/注释/文档禁 emoji；提交信息 Conventional Commits。

---

## 11. 成功标准（整体验收）

1. 用户从零创建项目，在纯对话 + GUI 辅助下完成一本 ≥30 章小说，全程阶段有序、可校验、可回滚、可导出。
2. 中断恢复：任何阶段重启 DSH 后项目状态完整（文件即状态）。
3. 上下文包 token 恒 ≤ 配置预算；账本冲突检出率（人工植入 5 处 ≥ 检出 5 处）。
4. 插件可独立安装（`dsh plugin add github:...`），设置页开关热生效，技能/工具按 consent 注册注销。
5. 全部门禁（typecheck/test/build/docs）绿，README 安装指引 3 分钟可跑通。

---

## 12. API 依据核实表（本机实测证据，编码前必读）

> 下表每行均在本机环境逐一验证（SDK 位于 `C:\Users\xiy\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai\`，
> 参考插件源码位于 `~/.dsh/profiles/web/node_modules/@linxin666/<pkg>/src|lib/`）。
> 凡与本文档冲突处，以本表为准。

| # | 集成点 | 已验证事实 | 证据位置 |
| --- | --- | --- | --- |
| 1 | 技能注册 | `ctx.skills.register({ name, description, whenToUse?, content, source, resourceBase:{kind:'directory',path} })` 返回 disposer；重复名仅告警不覆盖 | `dsh-skill/lib/index.js:193`；`dsh-plugin-publisher/lib/index.js:127-164` |
| 2 | 设置命名空间（最小模式） | `ctx.inject(["settings"], sctx => sctx.settings.register(NS, schema, { base }))`；`scope.get()/watch()/update()`；schema 为 schemastery 形状（`Object.assign(fn,{toJSON})` 零依赖可手写） | `dsh-plugin-publisher/lib/index.js:66-178` |
| 3 | 设置命名空间（SDK 规范模式） | `installSettingsSection(ctx, ns: SettingsNamespace, schema: z<T>, entry: T, hooks:{setSource, onChange})`，settings 服务消失自动回退 entry | `dsh-settings/lib/index.js:618-636`、`lib/types/index.d.ts:341` |
| 4 | agent 工具注册 | `ctx.tools.register(tool)`，tool = `{ name, description, schema(JSON Schema 对象), ... }`；批量 `tools.map(t => ctx.tools.register(t))` 返回 disposer 数组 | `dsh-ssh/lib/index.js:2706-3370`（`src/tools.ts`） |
| 5 | agent 预设 | 用户预设根 = harness home `.agent-presets`（本机 `~/.dsh/.agent-presets/<id>/{preset.yml,agent.cordis.yml,<bootstrap>.mjs}`）；dsh-liangshen 升级时自动同步 | `dsh-agent-presets/lib/index.js:160`（`USER_PRESET_DIR=".agent-presets"`）；`~/.dsh/.agent-presets/liangshen/` |
| 6 | HTTP 路由 | `ctx.inject(["webServer"], wctx => wctx.webServer.register({ kind:'exact'|'prefix', path, handler }, ...))`；handler 为原生 `(req,res)`；自定义头防 CSRF | `dsh-plugin-publisher/lib/index.js:182-213` |
| 7 | 会话驱动（client 侧） | `sessions.binding(id).session.prompt([{type:'text',text}], 'queue')` + 订阅快照至 settle；workspaces 取/建 session；先 baseline turn 计数再 prompt | `dsh-client-ui-task-board/src/core/execution.ts:56-260` |
| 8 | 会话驱动（host 侧） | host 半区经 `ctx.inject(["sessions","workspaces"])` 注入同名服务（`@deepseek-ai/dsh-session`、`dsh-workspace` 已装机） | SDK 包存在性确认 |
| 9 | client 半区装配 | `__ModuleLoader__.load` 闭包工厂入口；`web-ui.plugin.item` 槽位经 `declare module '@deepseek-ai/dsh-client-ui-slots'` 增强 | `dsh-client-ui-task-board/src/client/*`、`src/client/slots-augment`（remote-web-ui） |
| 10 | 工具链 | 全家桶用 tsdown 构建（`tsdown@^0.22.2`），门禁 `pnpm typecheck && pnpm -r test && pnpm -r build` + `aggregate:check`/`docs:check` | `E:/deepseekwork/dsh-web-ui/package.json:7-30` |
| 11 | 本机参考源码位置 | `E:/deepseekwork/dsh-web-ui` 为部分检出（无 `packages/`、`scripts/`）；完整 TS 源码读已安装包 `~/.dsh/profiles/web/node_modules/@linxin666/<pkg>/src/` | 本机目录实测 |
| 12 | 运行时验证 | `dsh plugin --profile scratch|headless add <path>` + `--dump-config` 组合/运行时两档验证 CLI 存在（`@deepseek-ai/dsh-cmdline` 已装机） | SDK 包存在性确认 |
