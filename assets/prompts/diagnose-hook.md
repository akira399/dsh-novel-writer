---
id: diagnose-hook
category: diagnose
name: 章末悬念评估
description: 单章结尾钩子强度评估
variables: [ending]
---

评估以下章节结尾（最后 500 字），输出 JSON：
{"score":0-100,"verdict":"pass|fix|rewrite","issues":[{"severity":"error|warning","evidence":"原文","advice":"建议","suggestion":"改写示例"}]}

好钩子标准：威胁逼近/真相一角/人物反常/选择迫近；禁止"欲知后事如何"式废话；禁止平淡收尾。

结尾：
{{ending}}
