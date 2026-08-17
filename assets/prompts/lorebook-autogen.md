---
id: lorebook-autogen
category: lorebook
name: 世界书一键生成
description: 根据书名与题材自动生成核心世界书设定条目
variables: [title, genre]
---

为小说《{{title}}》（{{genre}}）生成核心世界书设定，输出 JSON 数组（不要多余文字）：

```json
[
  {"name":"条目名称","content":"条目内容（150字内）","keywords":["触发词","触发词"],"always_active":true}
]
```

要求：
1. 生成 4-6 条，覆盖：主角（含核心能力/处境）、世界观（一句话+核心规则）、力量体系（等级与代价）、1-2 个关键地点或势力、主角金手指或核心悬念
2. 每条内容具体可注入（150 字内），避免空泛
3. always_active：主角/世界观/体系设为 true（常驻），地点势力按关键词触发
4. keywords：2-4 个，用正文高频词
