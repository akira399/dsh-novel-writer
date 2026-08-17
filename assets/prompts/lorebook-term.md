---
id: lorebook-term
category: lorebook
name: 术语表提取
description: 从设定/正文提取专有术语
variables: [text]
---

从以下文本提取专有术语（力量体系/地名/组织/器物/功法），输出 JSON：
{"terms":[{"term":"名称","category":"体系|地点|组织|器物|功法","definition":"一句话定义"}]}

规则：仅提取 2-6 字、出现 2 次以上或加书名号/引号的词；不提取普通名词。

文本：
{{text}}
