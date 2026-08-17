# dsh-novel-writer (Novel Workshop)

A web-novel creation plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) (DSH):
**nine-phase gated creation workflow + lorebook injection + AI-taste removal + golden-three-chapters diagnosis + million-word consistency + one-click chapter writing**.

- [中文](./README.md) | English

## Features

| Capability | Description |
| --- | --- |
| **Nine-phase workflow** | topic → setting → characters → outline → volumes → chapters → writing → revision → done; phase gating (no skipping), artifact versioning, audit log, revision rollback |
| **Lorebook** | keyword/regex-triggered + always-active entries; groups & book binding; import from Operit / SillyTavern / character cards; injection token budget |
| **Prompt front/back injection** | constant directives injected at the front/back of the context packet (unified scope model) |
| **AI-taste detection & removal** | built-in 234-word, 5-category lexicon + density scoring + one-click rewrite via built-in prompts |
| **Golden-three-chapters diagnosis** | offline rule layer (hook/opening/conflict/infodump/wordcount/dialogue) + optional model layer |
| **Four-family validation** | structure/content/plot/consistency, run on commit (wordcount/title/forbidden words/POV/hook/brief coverage) |
| **Million-word consistency** | fact ledger (auto-extracted from chapter JSONPatch) + timeline regression detection + overdue foreshadowing + sediment suggestions + consistency audit; budget-constant context packets (stress-tested: 1M words, 0 over-budget, 100% conflict coverage) |
| **Per-chapter word stats** | auto stats on commit (total/CJK/dialogue ratio/sentence length) + target badge + book stats |
| **Chapter context packet** | L1 book brief + L2 volume/chapter briefs & recent chapters + L3 summaries/variables/lorebook hits |
| **Built-in prompt library** | 60 templates: creation/styles (8)/depolish/polish/diagnosis/guide/lorebook |
| **Workshop assistant** | intent parsing (natural language → tool actions) + 5-step creation wizard |
| **GUI** | sidebar "Novel Workshop" + drawer (projects/create/detail/one-click write/diagnosis/demo import) + settings card |
| **Revision & export** | proofread/rhythm/style modes (diff stats, original kept); txt/markdown/platform export |

## Install

```bash
dsh plugin --profile web add <dsh-novel-writer-0.0.1.tgz>
```

Or from this repo:

```bash
npm install && npm run verify && npm run build
dsh plugin --profile web add <path>
```

After install: sidebar "Novel Workshop" entry, settings card, the `novel-writing-workflow` skill, and the "Novel Creation Mode" agent preset become available.

## Quick start

1. Open the drawer → "Import demo 《青云问道》" (or create your own project)
2. Open project detail → "Write chapter" → the session writes from the context packet → review & save
3. Or just chat: "create a fantasy novel project", "write the next chapter", "remove AI taste", "diagnose the opening"

Data lives in `~/.dsh/dsh-novel-writer/` by default.

## Interaction with DSH

- **41 agent tools**: `novel_*` + `lorebook_*` + `novel_prompts`
- **Two-phase chapter protocol**: `novel_write_chapter` (context packet) → model writes → `novel_commit_chapter` (stats/ledger/audit)
- **Skill**: `novel-writing-workflow`
- **GUI API**: `/api/novel-writer/*` (fence-header protected)

## Security

Local-only storage; audit-logged writes; LLM helper calls reuse the session's model route; GUI routes require a custom fence header; disabled plugin returns 503.

## Known limitations

- Model-layer features degrade to detection/rule layers when no model route is available
- One-click chapter text backfill is best-effort (manual paste supported)
- Scheduled serialization (browser cron) not yet implemented
- Sediment suggestions require confirmation before writing to the lorebook

## Development

```bash
npm run typecheck && npm test && npm run build
node scripts/simulate-1m.mjs   # million-word consistency stress test
```

Module discipline: one module → tests → review per step (see [docs/MODULE-LOG.md](./docs/MODULE-LOG.md)).

## License

MIT
