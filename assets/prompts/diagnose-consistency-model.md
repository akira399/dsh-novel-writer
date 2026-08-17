---
id: diagnose-consistency-model
category: diagnose
name: 模型层一致性检查
description: 长文一致性模型检查（实体状态/时间线/伏笔）
variables: [text, ledger]
---

检查以下正文与账本的一致性，输出 JSON：
{"issues":[{"severity":"error|warning","kind":"境界倒退|物品消失|地点错位|时间矛盾|伏笔提前揭露|术语漂移","entity":"对象","evidence":"原文","advice":"建议"}]}

规则：对照账本逐项核对；境界/数值倒退为 error；人物死亡后复现为 error；无证据推断的不报。

账本：
{{ledger}}

正文：
{{text}}
