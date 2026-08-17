---
name: novel-writing-workflow
description: 网络小说创作全流程（九阶段门禁式创作）：选题→设定→人设→大纲→分卷→细纲→正文→修订→完本。使用 novel_* 工具推进、lorebook_* 管理世界书，模型不得口头跳阶段。
whenToUse: 用户要求开始创作小说、写章节、设定世界观、生成大纲、润色或诊断章节时。
---

# 网络小说创作工作流（dsh-novel-writer）

本技能定义小说创作的标准流程。**阶段推进必须走工具，未 commit 不得自称完成。**

## 1. 九阶段流程（按序推进，禁止跳阶段）

`topic(选题) → setting(核心设定) → character(人设) → outline(全书大纲) → volume(分卷) → chapter(分章细纲) → writing(正文) → revision(修订) → done(完本)`

- 进入阶段：`novel_phase { projectId, phase }`（前置阶段必须 approved/skipped，否则工具报 INVALID_STATE）。
- 提交产物：`novel_commit { projectId, phase, artifact, errorCount }`——产物写入 docs/<phase>.md 与版本快照；errorCount>0 会挂起 review，需要修改后重新提交。
- 用户覆盖：`novel_override { action: force|reopen|skip|rollback }`（force 放行、reopen 驳回、skip 跳过、rollback 在修订期回退）。

## 2. 世界书（lorebook）纪律

- **写作前必查**：开始写正文前，先确认本书已绑定足够的世界书设定（`lorebook_list_entries` 按 `book_id` 核对）。若某书没有绑定设定，**主动提醒用户先创建设定**（主角/世界观/力量体系/关键地点），再开始写正文。
- **设定即时沉淀**：创作过程中出现的任何关键设定——无论来自用户描述还是生成内容（人物/地名/势力/境界/规则/物品/功法）——**立即用 `lorebook_create_entry` 保存**，并传 `book_id` 绑定当前书。不要等用户要求。
- 条目按 `book_id` 绑定具体小说：每本书拥有自己的世界书条目集合；不同书之间设定隔离，互不干扰。
- 确立的关键设定用关键词触发 + 常驻条目（always_active）配合：主角/体系/核心规则建议常驻；次要人物/地点用关键词。
- 写作前查询相关条目：`lorebook_list_entries` / `lorebook_get_entry`。
- GUI：小说工坊 → 世界书（按书分栏管理；新建条目时选择绑定书籍）。

## 3. 正文写作协议（两段式）

1. `novel_write_chapter { projectId, chapterNo, brief? }` → 返回上下文包（L1 全书设定 + L2 卷章细纲与前文 + L3 摘要/变量/世界书命中 + 硬约束）。
2. 在回复中直接输出本章正文（遵守上下文包的 constraints：字数/视角/禁用词/钩子）。
3. `novel_commit_chapter { projectId, chapterNo, title, text, brief? }` → 落盘并自动统计字数与达标判定。
4. 正文需要模型维护状态时，可在文末输出 `<JSONPatch>[{"op":"replace","path":"/stat_data/境界","value":"筑基"}]</JSONPatch>` 更新书级变量。

## 4. 质量自检（提交前）

- 一致性：人物境界/地点/物品与账本、世界书条目一致，不冲突。
- 结构：本章完成细纲目标；章末留钩子。
- 文风：避免 AI 味表达（"不禁/仿佛/缓缓/眼底闪过一丝"等），口语自然。
- 字数：达标 `novel_wordcount`（或 commit 后 stats 提示）。

## 5. 修订与完本

- 修订阶段用 `novel_override { action: 'rollback', phase: <目标> }` 回退到已批准阶段重新走。
- 全部完成后提交 revision → done，用 `lorebook_export_entries` + 章节文件完成成稿归档。
