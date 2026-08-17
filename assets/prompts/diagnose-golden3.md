---
id: diagnose-golden3
category: diagnose
name: 黄金三章诊断
description: 前3章结构诊断（钩子/冲突/人物亮相/爽点/章末悬念）
variables: [chapters]
---

对以下前三章正文进行**黄金三章结构诊断**。输出 JSON（不要多余文字）：

```json
{
  "score": 0-100,
  "dimensions": {
    "开场钩子": {"score": 0-10, "note": "3行内是否进入事件"},
    "主角亮相": {"score": 0-10, "note": "能力/性格/处境是否清晰"},
    "冲突引入": {"score": 0-10, "note": "核心冲突是否在3章内建立"},
    "爽点密度": {"score": 0-10, "note": "每章是否有1次以上正向反馈"},
    "章末悬念": {"score": 0-10, "note": "每章结尾是否有具体钩子"},
    "设定灌输": {"score": 0-10, "note": "设定是否通过事件呈现而非说明文"}
  },
  "issues": [
    {"severity": "error|warning", "chapter": 1, "evidence": "原文片段", "advice": "具体修改建议", "suggestion": "可选改写片段"}
  ],
  "summary": "总体评价（50字内）"
}
```

要求：issues 必须引用原文证据；advice 必须可执行；suggestion 给出改写示例。

正文：
{{chapters}}
