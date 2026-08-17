---
id: lorebook-import-mapping
category: lorebook
name: 导入映射说明
description: 世界书导入字段说明（Operit/ST/角色卡）
variables: []
---

世界书导入支持三种格式，导入时字段自动映射：
- Operit 条目数组：name/content/keywords/inject_target/inject_position 直接映射
- SillyTavern lorebook：key→keywords、constant→always_active、order→priority、depth→scan_depth、use_regex→is_regex
- 角色卡 character_book：keys→keywords、insertion_order→priority、position→注入位置（before_char→prepend 等）

不支持的字段（keysecondary/selective/preset 宏）会保留并给出兼容警告。
