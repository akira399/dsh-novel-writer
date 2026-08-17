---
id: lorebook-sediment
category: lorebook
name: 世界书沉淀条目生成
description: 从账本/卷摘要生成世界书条目草稿
variables: [facts]
---

将以下事实生成 1-3 条世界书条目（每条独立，供 lorebook_create_entry 使用）：
- 格式：【条目名】+ 内容（150 字内）
- 关键词：从内容提取 2-4 个触发词
- 常驻条件：核心设定（人物/体系/组织）建议 always_active

事实：
{{facts}}
