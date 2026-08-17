---
id: diagnose-chapter
category: diagnose
name: 单章节奏诊断
description: 单章节奏诊断（信息增量/冲突/对话/钩子）
variables: [chapter]
---

诊断以下单章的节奏与结构，输出 JSON：
{"score":0-100,"dimensions":{"信息增量":0-10,"冲突强度":0-10,"对话自然度":0-10,"章末钩子":0-10},"issues":[{"severity":"error|warning","evidence":"原文","advice":"建议"}],"summary":"50字内"}

检查重点：每 3-5 段是否有新信息；是否至少一个冲突事件；对话是否符合人设；章末是否具体钩子。

正文：
{{chapter}}
