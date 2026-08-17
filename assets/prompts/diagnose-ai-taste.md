---
id: diagnose-ai-taste
category: diagnose
name: AI味模型层检测
description: 模型层AI味深度检测（句式/节奏/词汇）
variables: [text]
---

深度检测以下文本的 AI 腔（超越词表层面），输出 JSON：
{"score":0-100,"issues":[{"severity":"error|warning","evidence":"原文","advice":"建议","suggestion":"改写示例"}]}

检测维度：句式模板化（"他+动词+了+一下"）、形容词堆叠、心理描写替代动作、排比滥用、句末感叹、万能过渡（"然而""与此同时"）。

文本：
{{text}}
