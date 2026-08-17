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
| **Novel Creation Mode preset** | agent preset ("大肥鱼的小说工坊") selectable when creating a new session — anchors the creation persona and auto-installs the `novel-writing-workflow` skill + 41 `novel_*`/`lorebook_*` tools (three-channel model: preset anchors the mode, skill guides the method, tools enforce the gated workflow). Zero setup: pick it in the new-session preset picker and start chatting ("create a xianxia novel project", "write the next chapter"). |

## Install

> Prerequisites: a machine with **DeepSeek Harness (DSH)** installed and a terminal.
> Works on Windows / macOS / Linux.

### Option A — Let an AI install it (easiest)

If your AI assistant can run commands, paste this into it:

> **Install the DSH plugin "大肥鱼的小说工坊" (dsh-novel-writer) and confirm it is enabled. Steps:**
> **1) Download**: get `https://github.com/akira399/dsh-novel-writer/releases/download/v0.1.1/dsh-external-dsh-novel-writer-0.1.1.tgz` (a prebuilt `.tgz`, no build needed). If unavailable, open `https://github.com/akira399/dsh-novel-writer/releases` and grab the latest `dsh-external-dsh-novel-writer-*.tgz`.**
> **2) Install**: run `dsh plugin --profile web add <absolute path to that tgz>`.**
> **3) Verify**: run `dsh plugin list` and confirm `dsh-novel-writer` is listed & enabled.**
> **4) Remind the user**: refresh the DSH web page (Ctrl+Shift+R), and the sidebar entry "大肥鱼的小说工坊" should appear.**
> **On any permission/network error, report the exact error first — do not silently skip.**

### Option B — Manual install from Release

```bash
# 1) Download dsh-external-dsh-novel-writer-0.1.1.tgz from
#    https://github.com/akira399/dsh-novel-writer/releases
#    (pick the .tgz whose name starts with "dsh-external-", not Source code archives)
# 2) Open a terminal (PowerShell on Windows / Terminal on macOS / any on Linux)
dsh plugin --profile web add <path-to-downloaded-tgz>
# 3) Confirm
dsh plugin list
```

If `dsh` is "not found", make sure DSH is installed and `dsh` is on PATH. On a "permission denied" error, run the terminal as administrator (Windows) or prefix with `sudo` (macOS/Linux).

### Option C — Build from source (advanced)

Requires **Node.js ≥ 20** and **Git**:

```bash
git clone https://github.com/akira399/dsh-novel-writer.git
cd dsh-novel-writer
npm install
npm run verify          # typecheck + 291 tests + build
npm run build
npm pack                # produces dsh-external-dsh-novel-writer-0.1.1.tgz
dsh plugin --profile web add ./dsh-external-dsh-novel-writer-0.1.1.tgz
```

> On Windows the build script is Shell — use Git Bash if `bash` is missing.

After any install method: the sidebar "大肥鱼的小说工坊" entry, the settings card, the `novel-writing-workflow` skill, and the "大肥鱼的小说工坊" agent preset (new-session mode picker) all become available.

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
