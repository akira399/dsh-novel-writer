---
id: lorebook-foreshadow
category: lorebook
name: 伏笔登记建议
description: 识别文本中的潜在伏笔并给出登记建议
variables: [text, chapterNo]
---

从第 {{chapterNo}} 章文本中识别潜在伏笔（反常细节/未解之谜/人物异常/物品来历不明）：
输出 JSON：
{"foreshadows":[{"content":"伏笔内容","plannedRevealChapter":"建议回收章节区间","reason":"为何是伏笔"}]}

规则：伏笔必须可回收（有明确揭晓方向）；单章登记不超过 3 条；常规悬念不算。

文本：
{{text}}
