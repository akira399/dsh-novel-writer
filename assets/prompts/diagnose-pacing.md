---
id: diagnose-pacing
category: diagnose
name: 爽点密度评估
description: 章节爽点密度与升级展示评估
variables: [chapter]
---

评估以下章节的爽点密度，输出 JSON：
{"score":0-100,"issues":[{"severity":"error|warning","evidence":"原文","advice":"建议"}],"summary":"50字内"}

标准：是否至少 1 次正反馈（打脸/收获/升级/破局）；升级是否有展示时刻；打脸是否当众+有证据+有代价；每 2000 字至少 1 个爽点。

正文：
{{chapter}}
