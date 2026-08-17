# AGENTS.md — dsh-novel-writer 开发指引

本文件为在本仓库工作的 AI/人类开发者提供约定。

## 架构分层（必须遵守）

- `src/core/**`：纯业务逻辑。**零 cordis 依赖、零 IO 副作用**（IO 通过注入的 store/依赖），全部可单测。域：workflow（流程状态机）、novel（项目/章节）、lorebook（世界书）、variables（变量引擎）、context（上下文包）、polish（AI 味）、diagnose（黄金三章）、validation（四族校验）、consistency（账本/时间线）、revision/export、aux（伏笔/术语/灵感）、prompts（提示词库）、llm（客户端）、stats、guide（向导/意图）、client-writer（会话驱动）。
- `src/tools/**`：agent 工具注册层。只做「参数解析 → 调 core → asResult 包装」，业务逻辑不得写在这里。
- `src/client/**`：浏览器半区（React）。挂载失败只记日志、绝不抛出（web shell boot 安全）。
- `src/index.ts`：唯一装配点（settings 门禁 / 技能 / 路由 / 服务工厂）。`src/assembly.ts`：可单测的装配控制器。

## 纪律

1. **每模块闭环**：一个独立模块 → 单测 → `npm run typecheck && npm test` → 复盘登记 `docs/MODULE-LOG.md` → 再进下一个模块。禁止一次实现多个模块。
2. **错误契约**：core 层抛 `PluginError`（`{ code, message, details? }`，code 见 `src/core/types.ts` ErrorCode）；工具层用 `asResult` 包装返回 `{ ok, value } | { ok: false, error }`；禁止静默 catch（存储层损坏必须可报告）。
3. **存储**：所有 JSON 落盘用 `atomicWriteFile` + VersionedFile 外壳（schemaVersion）；路径经 `safeFileName`/`assertBookId` 校验；数据按项目隔离（`bookDirOf` 模式）。
4. **状态机**：阶段流转只能走 `workflow/engine.ts` 纯函数；审计事件 append-only。
5. **测试**：core 纯函数用真实临时目录 fixture（mkdtemp）；不 mock core 内部；LLM 依赖注入 fake。
6. **命名**：工具 `novel_*` / `lorebook_*` / `novel_prompts`；技能 `novel-writing-workflow`；预设 `novel-writer`。
7. **门禁**：`npm run verify`（typecheck + test + build）全绿才算完成；`npm run typecheck` 覆盖 host+client 双段。

## 关键契约速查

- 写章两段式：`novel_write_chapter`（上下文包）→ 正文 → `novel_commit_chapter`（统计/账本/审计）
- 一致性数据流：章节 `<JSONPatch>` → 变量（stat_data）+ 账本（entity/field/value）
- 词库/提示词随包分发于 `assets/`，加载走 `loadPromptLibrary` / `mergeDictionaries`
- LLM 辅助调用统一走 `core/llm/client.ts`（路由捕获 + complete），不可用时工具降级

## 路线

P0-P2 已完成（世界书/流程/质量/一致性/GUI v1-v2/压测）。P3 收尾：文档（已完成 README 中英）、发布（npm pack / GitHub Release）、定时连载（规划）。
