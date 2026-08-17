<p align="center">
  <img src="./assets/brand/banner.svg" alt="大肥鱼的小说工坊 — DSH 网络小说创作插件" width="100%">
</p>

# 大肥鱼的小说工坊（dsh-novel-writer）

一个面向 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart)（DSH）的网络小说创作插件：
**九阶段门禁式创作流程 + 世界书（lorebook）设定注入 + 本地书籍导入 + AI 一键润色 + 去 AI 味 + 黄金三章诊断 + 百万字一致性保障**。

- 中文 | [English](./README.en.md)

<p align="center">
  <img src="./assets/brand/logo.png" alt="大肥鱼的小说工坊 Logo" width="120">
</p>

让 DSH 像一位专业的网文编辑与你协同：从选题、设定、人设、大纲到分章、正文、修订、完本，每一步有模板、有门禁、可校验、可回滚；并有世界书把你的设定固化下来，确保百万字不崩设定。

---

## ✨ 功能特性

### 九阶段门禁式创作流程
`选题 → 设定 → 人设 → 大纲 → 分卷 → 细纲 → 正文 → 修订 → 完本`
- **阶段门禁**：未批准不能跳阶段（可用户显式放行/回退），杜绝模型"口头跳阶段"
- **产物版本快照**：每阶段每次提交留档 `versions/<phase>/v<n>`，可回退任意历史版本
- **审计日志**：每次 commit / 放行 / 回滚写入 `audit.jsonl`

### 世界书（lorebook）设定注入
- 关键词 / 正则触发 + 常驻注入，条目按书绑定（每本书独立栏目）
- 导入支持 **Operit / SillyTavern / 角色卡** 三格式，自动兼容警告
- **AI 一键生成设定**：按书名+题材自动生成 4-6 条核心设定并绑定本书
- 注入 token 预算裁剪，长上下文不爆窗

<p align="center">
  <img src="./assets/screenshots/shot-worldbook.png" alt="世界书（设定注入）面板" width="440">
</p>

### 质量保障
- **AI 味检测与去除**：内置 234 词 5 类词库 + 密度评分 + 一键改写
- **黄金三章诊断**：规则层离线必出分（钩子/开场/冲突/灌输/字数/对话）+ 可选模型层深度诊断
- **四族校验**：结构/内容/剧情/一致性，提交即检（字数/标题/禁用词/视角/钩子/细纲覆盖/账本冲突）

### 百万字一致性
- **事实账本**：章节内 `<JSONPatch>` 自动落账（人物境界/物品/地点状态），冲突检测与巡检
- **时间线**：书内时间归一 + 倒挂检测；**伏笔**登记与回收跟踪；**世界书自动沉淀建议**
- **上下文包三层记忆**（L1 全书设定 + L2 卷章细纲前文 + L3 摘要/变量/世界书）预算恒定（压测 100 万字 0 超限）

### 一键写作与润色
- **一键写章**：host 直写（上下文包 → 正文 → 自动落盘），章节统计/账本/审计联动
- **一键润色**：AI 优化文笔（不改情节/人物/走向），**diff 标亮**修改处 + 确认保存/放弃
- **逐步撤销**：可撤销 AI 润色与手动编辑，还原到任意历史状态

<p align="center">
  <img src="./assets/screenshots/shot-writing.png" alt="一键写章界面" width="440">
  <img src="./assets/screenshots/shot-polish.png" alt="一键润色 + diff 标亮预览" width="440">
</p>

### 本地导入 & 配套工具
- **导入本地书籍**：txt/md 自动识别章节并建书（含 md frontmatter 题材/书名）
- **27 类题材**标签（玄幻/仙侠/武侠/西幻/都市/现实/科幻/悬疑/言情/轻小说/流派向…）
- **修订**（校对/节奏/文风三模式）、**导出**（txt/markdown/平台排版）
- **市场调研**辅助（web_search 引导 + 落盘 `reports/market.md`）、**模板复制**（克隆完本品为模板）、灵感库/伏笔/术语表/账本查询

### GUI 工作台 + 41 个 agent 工具
- 侧边栏「大肥鱼的小说工坊」抽屉：项目列表 / 创建 / 详情 / 一键写章 / 润色 / 诊断 / 导入 / 世界书管理
- 抽屉可展开、自动避让聊天框条；润色预览清晰展示
- 内置 60 个提示词模板（创作/文风 8 套/去味/润色/诊断/引导/世界书），`novel_prompts` 可浏览渲染

<p align="center">
  <img src="./assets/screenshots/shot-presets.png" alt="大肥鱼的小说工坊工作台（项目面板）" width="720">
</p>

### 🎭 小说创作模式预设（agent 预设）
插件随包装载一个 **「大肥鱼的小说工坊」agent 预设**，在 DSH 新建会话时的模式选择器里即可选用——选中即"一键进入创作模式"，不需要每次手动交代要写小说、要走流程。

**三通道协同，约束模型行为**：
1. **模式锚定（本预设）**——预设锚定创作 persona（名称为「大肥鱼的小说工坊」，描述声明确创作的九阶段门禁方法），新建会话即进入目标模式；
2. **软引导（技能）**——随 enabling 自动注册的 `novel-writing-workflow` 技能，进入会话后加载完整创作方法论（阶段定义、模板用法、工具写法、写作规范），即使你不用 GUI 也知道每一步该怎么做；
3. **硬轨道（工具）**——host 注册的 41 个 `novel_*` / `lorebook_*` 工具随预设全程可调，阶段推进、产物提交、校验、写章都必须走工具，防止模型"口头跳阶段"。

**为什么用预设**：
- **零初始化成本**：选它开新会话即锚定"资深网文作者"视角，直接开聊「创建项目，写本玄幻小说」就能跑通全流程；
- **不丢流程**：阶段门禁、世界书纪律、账本一致性这些硬约束靠工具与技能自动织入，你只需提出创作意图；
- **与 GUI 互补**：预设适合"对话驱动"创作（说一句写一章、给一段去 AI 味），GUI 工坊适合"可视化操作"（看项目列表、点按钮写章/润色/导入），两者共用同一份项目数据与流程。

**使用方式**：新建会话 → 预设选择器选「大肥鱼的小说工坊」→ 直接开始创作；或安装后自动同步到本地 `~/.dsh/.agent-presets/novel-writer/`（升级插件自动更新）。

<p align="center">
  <img src="./assets/screenshots/shot-gui.png" alt="DSH 主界面（大肥鱼的小说工坊预设工作空间）" width="820">
</p>

---

## 🎯 使用场景

| 场景 | 怎么做 |
| --- | --- |
| 从零开一本新书 | 打开工坊 → 输入书名/选题材 → 或用「五步向导」逐步引导 |
| 已有完本/定好的设定 | 用「模板复制」克隆一本带完整设定骨架的新书，直接开写正文 |
| 想要热门题材方向 | 「市场调研」→ 引导 web_search 查榜单热词 → 落盘选题参考 |
| 把本地网文 txt/md 收进 DSH 续写 | 「导入本地书籍」→ 自动建书分章 → 可直接继续润色/续写 |
| 保证不崩设定 | 世界书固化设定 + 账本巡检 + 一致性校验在写作时自动织入 |
| 写完投稿 | 「导出 txt」或 Markdown / 平台排版下载 |

---

## 📦 安装

> **准备好这些就能开始**：一台装好 **DeepSeek Harness（DSH）** 的电脑（[DSH 快速上手](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart)）、一个能打开「终端 / 命令提示符」的入口即可。版本不挑系统，Windows / macOS / Linux 都支持。

### ✅ 方式一：一句话让 AI 替你装（小白首选）

如果你在用某个能执行命令的 AI 助手（例如 DSH 里的智能体、或你的 AI 工具），**直接复制下面这段话发给它**，它会帮你下载、安装、并确认装好：

> **请帮我安装「大肥鱼的小说工坊」（dsh-novel-writer）这个 DSH 插件，并确认它启用成功。步骤：**
> **1）下载安装包**：访问 `https://github.com/akira399/dsh-novel-writer/releases/download/v0.1.1/dsh-external-dsh-novel-writer-0.1.1.tgz` 下载这个 `.tgz` 文件（这是已编译好的安装包，不需要构建）。如果该版本不可用，就打开 `https://github.com/akira399/dsh-novel-writer/releases` 找到最新版 `dsh-external-dsh-novel-writer-*.tgz` 下载。**
> **2）安装**：在终端执行 `dsh plugin --profile web add <上一步下载的 tgz 绝对路径>`。如果是首次用 DSH，先确认 `dsh` 命令在 PATH 里；若提示没有这个命令，告诉我，我改用绝对路径或帮你配置。**
> **3）确认启用**：执行 `dsh plugin list`（或你能用的查看已装插件命令），确认 `dsh-novel-writer` 在列且已启用。**
> **4）收尾提醒**：告诉用户「在 DSH 网页上刷新页面（必要时强制刷新 Ctrl+Shift+R），侧边栏出现『大肥鱼的小说工坊』就装好了；若没出现，检查 DSH 插件列表里该插件的『启用』开关是否为开」。**
> **遇到权限/网络问题**（下载失败、写权限不足、命令不存在）时，先告诉我具体报错，再动手，不要静默跳过。**

### 🛒 方式二：从 Release 下载安装（动手型）

1. **打开 Release 页**：访问 https://github.com/akira399/dsh-novel-writer/releases ，找到最新版本（如 v0.1.1）。
2. **下载安装包**：在列表里点开「Assets」，下载 `dsh-external-dsh-novel-writer-0.1.1.tgz`（注意不是 Source code 那两个 zip/tar.gz，是名字以 `dsh-external-` 开头、结尾是 `.tgz` 的那个）。
3. **打开终端**：
   - Windows：按 `Win` 键输入 `powershell` 回车，或打开「Git Bash」（若你装过 Git）。
   - macOS：打开「终端」应用（Launchpad 里搜索 Terminal）。
   - Linux：打开任意终端。
4. **执行安装命令**（把 `<文件路径>` 换成你刚下载文件的实际位置，例如桌面上的 `~/Desktop/dsh-external-dsh-novel-writer-0.1.1.tgz`）：

   ```bash
   dsh plugin --profile web add <文件路径>
   ```

   > 💡 `--profile web` 表示装到默认网页 profile。如果你用的不是 `web`（例如自己建的 profile），把 `web` 换成你的 profile 名；不确定就先跑 `dsh plugin list` 看看当前 profile。

5. **确认装好**：

   ```bash
   dsh plugin list
   ```

   看到 `dsh-novel-writer` 即成功；若显示「已禁用」，执行 `dsh plugin enable dsh-novel-writer`（或到 DSH 设置里打开开关）。

6. **回到 DSH 网页**：
   - 刷新页面（建议 `Ctrl+Shift+R` 强制刷新一次，确保加载最新界面）
   - 侧边栏出现「**大肥鱼的小说工坊**」即完成安装 ✅

> ⚠️ **小白注意事项**
> - 报错「command not found / 不是内部或外部命令」= 终端没找到 `dsh`，先确认 DSH 已安装、或改用 DSH 的安装目录里的 `dsh`。
> - 报错「Permission denied / 权限不足」= 当前用户没有**写入**权限，Windows 右键「以管理员身份运行」终端再执行；macOS/Linux 可尝试 `sudo dsh plugin --profile web add ...`。
> - 只要 `dsh plugin add` 成功，**不需要额外装任何依赖**，插件自带的框架依赖由 DSH 提供。

### 🛠 方式三：从源码构建安装（进阶）

适合想改源码 / 参与开发的人。需要先装有 **Node.js ≥ 20** 与 **Git**。

```bash
git clone https://github.com/akira399/dsh-novel-writer.git
cd dsh-novel-writer
npm install
npm run verify          # 自检：类型检查 + 291 个单元测试 + 构建，全过才继续
npm run build           # 编译 host + client
npm pack                # 生成 dsh-external-dsh-novel-writer-0.1.1.tgz
dsh plugin --profile web add ./dsh-external-dsh-novel-writer-0.1.1.tgz
```

> ⚠️ 源码构建需要联网装依赖与较新 Node；若 `npm run build` 因缺 `bash` 报错，Windows 用户请用 Git Bash（项目构建脚本是 Shell）。

### ✅ 三种方式装完后，确认「能用全部功能」

不论用哪种方式，装完都应看到👇，即可正常使用本项目所有功能：

- **侧边栏**出现「大肥鱼的小说工坊」入口（工作台抽屉：项目/创建/写章/润色/诊断/导入/世界书…）
- **设置 → 插件配置**出现「大肥鱼的小说工坊」卡片（启用开关 + 数据目录，默认 `~/.dsh/dsh-novel-writer`）
- **新会话**自动带出技能 `novel-writing-workflow`（创作全流程指导）
- **新建会话的模式选择器**里可选中预设「大肥鱼的小说工坊」（对话驱动创作）

> 💡 若某块没出现：先刷新页面；不行就重启 DSH，再在「设置 → 插件」里确认该插件「启用」开关是打开的。

--

### 装好后

- 侧边栏出现「**大肥鱼的小说工坊**」入口（工作台抽屉）
- 设置 → 插件配置 → **大肥鱼的小说工坊**（启用开关 + 数据目录）
- 新会话出现技能 `novel-writing-workflow`（创作全流程方法）
- agent 预设「大肥鱼的小说工坊」可选（新建会话模式选择器）

---

## 🚀 快速开始（3 分钟）

1. 打开侧边栏「大肥鱼的小说工坊」→ 点「一键导入示例《青云问道》」（或输入书名创建）
2. 进入项目详情 → 「一键写章」→ 按上下文包自动出正文 → 已存盘；不满意可「一键润色」
3. 或直接在对话里说：
   - 「创建项目，写本玄幻小说」
   - 「帮我写下一章」
   - 「把这段去 AI 味」「诊断一下开头」
   - 「克隆《青云问道》当模板」「调研下仙侠市场行情」
   - 「导入本地 txt」

数据目录默认 `~/.dsh/dsh-novel-writer/`：

```
lorebook/       世界书（entries/groups/settings）
projects/      项目（book.json + docs/ + chapters/ + audit.jsonl + ledger.json + ...）
```

---

## ⚙️ 配置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| enabled | true | 插件总开关（关闭即注销工具/技能，数据保留） |
| dataDir | `~/.dsh/dsh-novel-writer` | 数据根目录 |

项目级（创建时/模板复制保留）：**27 题材**、每章字数目标（默认 2000-4000）、风格（视角/禁用词/AI 味词）、阶段门禁开关。

---

## 🔌 与 DSH 的交互

- **41 个 agent 工具**：`novel_*`（项目/阶段/写章/校验/诊断/去味/巡检/账本/克隆/导出/市场调研…）+ `lorebook_*`（世界书 CRUD）+ `novel_prompts`（提示词库）
- **两段式写章协议**：`novel_write_chapter` 返回上下文包 → 模型输出正文 → `novel_commit_chapter` 落盘（统计/账本/审计）
- **技能**：`novel-writing-workflow`（流程纪律与方法指导）
- **GUI 数据面**：`/api/novel-writer/*`（项目/章节/上下文/诊断/润色/导入，fence 头校验）

---

## ❓ 常见问题（FAQ）

**Q：为什么要先发起一次对话才能写章/润色？**
A：本插件复用你的主模型路由（`llm/stream` 捕获），不持有独立密钥。首次请先在会话里发一句话让模型路由就绪。

**Q：导入的书正文会丢吗？**
A：不会。txt/md 按章节标题自动切分（含粘连标题、楔子/番外等），无法识别的按段落分块，内容完整同步。

**Q：润色/写章会覆盖我的原稿吗？**
A：一键写章自动落盘（可撤销）；一键润色先预览 diff，确认才保存，放弃可还原原文。

**Q：世界书 AI 生成的内容安全吗？**
A：生成后是「待确认」的条目，写入前你可编辑/删除；注入时按书隔离。

---

## 🧪 开发

```bash
npm run typecheck   # host + client 双段
npm test            # vitest（291 例）
npm run build       # tsc host + tsdown client
node scripts/simulate-1m.mjs   # 百万字一致性压测
```

模块开发纪律：每模块 → 单测 → 复盘（见 [docs/MODULE-LOG.md](./docs/MODULE-LOG.md)）。

---

## 🛡 安全模型

- 数据仅存本地 `~/.dsh/dsh-novel-writer/`，不联网上传
- 所有写操作走审计日志；LLM 辅助调用复用主模型路由，无独立密钥
- GUI 路由带自定义头校验（防 CSRF/dns-rebinding）；未启用返回 503
- 市场调研仅在你显式调用工具时触发搜索（复用会话 web_search）

## 📄 许可

MIT
