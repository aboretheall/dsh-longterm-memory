<div align="center">

<img src="icon.svg" width="88" alt="dsh-longterm-memory">

# dsh-longterm-memory

**Move a project's memory out of the chat log and onto disk. New sessions keep the context; nobody pays for the old tokens.**

One memory engine (T1 handoff / T2 raw log / T3 structured knowledge / T4 project), six distribution forms, four hosts sharing a single memory store.

[![npm](https://img.shields.io/npm/v/dsh-longterm-memory)](https://www.npmjs.com/package/dsh-longterm-memory)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![tests](https://img.shields.io/badge/tests-37%20passing-success)](tests/)
[![hosts](https://img.shields.io/badge/hosts-DSH%20%7C%20Claude%20Code%20%7C%20Codex%20%7C%20Hermes-ff69b4)](#six-distribution-forms)

English | [中文](README.md)

</div>

---

## Contents

- [The problem](#the-problem)
- [Core idea: T1-T4](#core-idea-t1-t4)
- [Features](#features)
- [Six distribution forms](#six-distribution-forms)
- [Quick start](#quick-start)
- [Tools and CLI reference](#tools-and-cli-reference)
- [How it works](#how-it-works)
- [Memory store layout](#memory-store-layout)
- [Repository layout](#repository-layout)
- [Configuration](#configuration)
- [Compatibility](#compatibility)
- [FAQ](#faq)
- [Development, testing, releasing](#development-testing-releasing)
- [Contributing](#contributing)
- [License](#license)

## The problem

Long projects hit two problems at once, and they pull in opposite directions:

| Problem | Common workaround | Cost |
| --- | --- | --- |
| A new session has amnesia | Paste the whole history back in | Token blow-up, noise in context, hallucination |
| Long sessions burn tokens | Trust the model to remember | Conclusions get lost; summaries lose detail |

This project's answer: **memory does not live in the conversation, it lives in files.** The conversation is
working memory (expensive, short, lost); files are long-term memory (across sessions, months, years).
Files are split into four tiers so the model reads **only the tier it needs right now**.

It also solves a third problem: **multi-agent and multi-person collaboration**. Because the memory lives in
the project rather than in one session, whoever picks it up next — another agent, another person, another
machine — reads the same context instead of asking "what was the previous one thinking?".

## Core idea: T1-T4

| Tier | Directory | Purpose | When it is read | Token cost |
| --- | --- | --- | --- | --- |
| **T1** | `T1-交接/` | Handoff brief: progress + active issues + user habits + AI pitfalls | **Once per session start** | Resident, keep ≤200 lines |
| **T2** | `T2-全日志/` | Raw session archive, one file per week | **Never proactively**; fallback only | Filename-only hits above 600 KB |
| **T3** | `T3-分类整理/` | Structured knowledge: `category/module/issue` | **Only on a search hit** | Only the matched fragments |
| **T4** | `T4-项目/` | The project's own code and assets | Individual files, on demand | Not part of memory |

T1 is the register, T3 the hot cache, T2 the cold store. If a session's conclusions never reach a file, that session is lost.

## Features

### Memory

| Feature | What it does |
| --- | --- |
| **Cold-start handoff** | One call returns "where we are + what is next + what bit us before" instead of reading any file in full |
| **Structured writes** | Three levels (`修复bug`/`新功能`/`疑问咨询`/`回顾重构` → module → issue); a recurring issue **appends `## 第 N 条记录`** to the same file instead of spawning new ones |
| **BM25 retrieval, Chinese-aware** | Chinese is indexed as single characters + adjacent bigrams + trigrams, so **colloquial phrasing still hits**; heading matches are weighted; broader query coverage ranks higher |
| **Noise suppression** | Documents matching only single CJK characters (的/在/不) are not hits; a single-character query falls back to the full term set |
| **Precise slicing** | `memory_slice` takes one section by **heading** or by **line range**, so big files never enter the context whole |
| **Cheap index** | `memory_index` returns filenames + heading outline only — see *what* is remembered before reading anything |
| **Raw log rotation** | `memory_log` writes into the weekly T2 file with week number, date, round and timestamp |
| **One-click adoption** | `memory_adopt` creates the skeleton, scans the project into a `项目结构.md` draft, writes markers |
| **Self-check** | `memory_doctor` / `memory_status` verify the four tiers, markers and brief budget |

### Engineering

| Feature | What it does |
| --- | --- |
| **Zero third-party dependencies** | Plain Node ESM, standard library only; offline, no build step, no lockfile games |
| **One engine, four hosts** | DSH / Claude Code / Codex / Hermes share `ports/core/` — retrieval, skeleton, slicing and archiving exist exactly once |
| **Dual layout detection** | `T1-交接/` (Claude Code naming) and `T1-交接文件夹/` (DSH naming) are both recognized, so one project never ends up with two memory stores |
| **Dual markers** | `memory_init` writes `.longterm-memory.json` **and** `.dsh-longterm.json`; every host recognizes the project |
| **Tool-name compatibility** | Primary names `memory_brief/index/slice/log`, aliases `memory_handoff/read/list` (DSH naming) |
| **Token budget guard** | For an unmarked project the system-prompt section is an empty string — **not installed, zero cost**; when installed, output is truncated to budget |
| **Path safety** | Every memory path must stay inside the memory root; absolute paths and `..` escapes are rejected |
| **Free rollback** | Turning the switch off stops reads/writes and keeps the files; uninstalling never touches data |
| **Bilingual** | Plugin card, settings page and UI strings follow the host language (zh/en) |

### Distribution and operations

- **Six forms**: DSH plugin, Claude Code plugin package, Codex snippets, native Hermes plugin, cross-host skill, generic MCP server.
- **One-command packaging**: `scripts/pack-ports.ps1` + `scripts/pack-skills.ps1` produce five standalone zips, each with syntax checks and a post-pack smoke test.
- **One-command release**: `scripts/finish-publish.ps1` creates the repo, pushes `main` + tag, publishes the Release with all assets, and optionally publishes to npm.
- **CI**: `.github/workflows/ci.yml` runs the full suite on Node 20/22/24 and checks the packaged contents.

## Six distribution forms

| # | Form | For | Install | Source |
| --- | --- | --- | --- | --- |
| 1 | **DSH plugin** | DeepSeek Harness | `dsh plugin --profile <p> add dsh-longterm-memory` | repo root (`index.js` + `client.js`) |
| 2 | **Claude Code plugin** | Claude Code | unpack into `~/.claude/plugins/longterm-memory/` | [`ports/claude-code/`](ports/claude-code/) |
| 3 | **Codex integration** | Codex | append snippets to `~/.codex/config.toml` + `AGENTS.md` | [`ports/codex/`](ports/codex/) |
| 4 | **Native Hermes plugin** | Hermes Agent | copy into `<HERMES_HOME>/plugins/`, then `hermes plugins enable` | [`ports/hermes/`](ports/hermes/) |
| 5 | **Cross-host skill** | any Agent Skills host (no MCP needed) | `node skills/longterm-memory/scripts/install.mjs --host <claude\|dsh\|codex\|hermes>` | [`skills/longterm-memory/`](skills/longterm-memory/) |
| 6 | **Generic MCP server** | any MCP client | `node ports/mcp/server.mjs` (stdio) | [`ports/mcp/`](ports/mcp/) |

All of them **share one engine (`ports/core/`) and one memory store**, and they can be installed side by side:
the skill carries the *process and discipline*, the plugin/MCP carries the *convenient calls*. The only thing to
avoid is installing two **same-named** skills into the same host directory.

## Quick start

```bash
git clone https://github.com/aboretheall/dsh-longterm-memory.git

# Bare bones: no host integration at all
cd your-project
node ../dsh-longterm-memory/ports/cli/ltm.mjs init .      # create the T1-T4 skeleton
node ../dsh-longterm-memory/ports/cli/ltm.mjs adopt .     # or: also scan the project structure
```

- **DSH**: `dsh plugin --profile <profile> add dsh-longterm-memory`, then use **⋯ → 设为长期项目**.
- **Claude Code**: `cp -r ports/claude-code ~/.claude/plugins/longterm-memory` (MCP + `/lm-*` commands + SessionStart hook).
- **Codex**: append [`ports/codex/config.toml.snippet`](ports/codex/config.toml.snippet) and [`AGENTS.md.snippet`](ports/codex/AGENTS.md.snippet).
- **Hermes**: copy the plugin dir, `hermes plugins enable longterm-memory`, `hermes gateway restart`.
- **Skill**: `node skills/longterm-memory/scripts/install.mjs --host <host>`.

## Tools and CLI reference

| Purpose | MCP tool | DSH alias | CLI |
| --- | --- | --- | --- |
| Create skeleton | `memory_init` | — | `ltm init [root] [--layout cc\|dsh]` |
| Adopt a project | `memory_adopt` | — | `ltm adopt [root]` |
| Read the brief | `memory_brief` | `memory_handoff` | `ltm brief [--root R] [--budget N]` |
| List what is remembered | `memory_index` | `memory_list` | `ltm index [--scope T3]` |
| Search | `memory_search` | — | `ltm search "words" [--scope hot\|all]` |
| Take one section | `memory_slice` | `memory_read` | `ltm slice --file F [--heading H \| --lines 12-40]` |
| Write T3 | `memory_write` | — | `ltm write --title T --category C --content "…"` |
| Append T2 | `memory_log` | — | `ltm log --content "…"` |
| Status / self-check | `memory_status` `memory_doctor` | — | `ltm status` / `ltm doctor` |

Full parameter table: [skills/longterm-memory/references/tools.md](skills/longterm-memory/references/tools.md).

## How it works

**Retrieval** is deterministic BM25 over heading-aware chunks. Chinese queries are split into single
characters, adjacent bigrams and trigrams; heading matches are up-weighted; matches that consist only of
noise characters are dropped; results are returned as fragments (default 700 chars per section), never whole
files. The trade-off is deliberate: predictable, dependency-free, offline-reproducible. When a different word
is used in the query than in the record, put the user's own phrasing into `tags` at write time.

**Writes** keep one issue in one file: the first record creates the file, later records append
`## 第 N 条记录 · timestamp`, so the history of a recurring bug stays readable and retrievable.

**Token economics**: unmarked projects cost nothing; a marked project pays T1 (≤200 lines) plus a four-line
usage note; a search costs the matched fragments; T2 never enters the context unless explicitly asked for.

**Dual layout**: the marker files carry the *real* layout, so detection is content-based rather than
"which file happened to exist first" — that is what lets four hosts share one store.

## Memory store layout

```
<project root>/
├─ .longterm-memory.json / .dsh-longterm.json   # long-term markers
├─ T1-交接/           项目进度交接.md · 当前活跃问题.md · 交接文档/{项目结构,用户习惯,用户强调,AI经常踩的坑}.md
├─ T2-全日志/         第42周-2026年10月12日→2026年10月18日.md
├─ T3-分类整理/       修复bug/游戏机制/NPC相关问题/NPC穿模.md
└─ T4-项目/           code and assets (listed, never read by the memory tools)
```

## Repository layout

```
├─ index.js  client.js  cordis.patch.yml   # form 1: DSH plugin
├─ ports/
│  ├─ core/          ← the single memory engine (zero deps)
│  ├─ cli/ltm.mjs    ← CLI (the Hermes plugin calls it too)
│  ├─ mcp/server.mjs ← generic MCP server (13 tools incl. aliases)
│  ├─ claude-code/   ← plugin package
│  ├─ codex/         ← config.toml + AGENTS.md snippets + prompts
│  └─ hermes/        ← native Python plugin
├─ skills/longterm-memory/                 # form 5: cross-host skill
├─ docs/  tests/  scripts/  optional/  .github/workflows/
```

## Configuration

| Key (DSH `cordis.patch.yml`) | Default | Meaning |
| --- | --- | --- |
| `rootDir` | `.` | Memory root, relative to the session workspace |
| `maxReadChars` | `12000` | Maximum characters one read returns |
| `maxSearchFiles` / `maxSearchLines` | `12` / `3` | Retrieval caps |
| `markerFile` | `.dsh-longterm.json` | Marker filename |

CLI/skill side: `LTM_PROJECT_ROOT`, `LTM_CLI`, `LTM_CORE`, `LTM_NODE`, `HERMES_HOME`.

## Compatibility

| Host | Version | Status |
| --- | --- | --- |
| DSH | `>=0.1.7` (verified on `0.2.0-rc.2`) | ✅ plugin, settings page, session menu, RPC channel |
| Claude Code | plugin spec (`.claude-plugin/plugin.json` + `.mcp.json` + commands + hooks + skills) | ✅ port ready; hook and MCP verified |
| Codex | `[mcp_servers]` + `AGENTS.md` + `prompts/` | ✅ snippets and prompts ready |
| Hermes Agent | verified on `0.21.4` | ✅ plugin and skill both `enabled` |
| Node | `>=20` (verified on 24) | ✅ all forms |
| Python (Hermes plugin only) | `>=3.9` (verified on 3.9.6) | ✅ self-check passes |

Details: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) · architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## FAQ

**Will this burn my context?** No — the resident part is T1 (≤200 lines) plus four lines of guidance; T2/T3 are read as fragments only on a hit.

**Does turning it off delete anything?** No. The switch writes a marker; the files stay. Uninstalling never touches data.

**Will the model invent past fixes?** The skill and the AGENTS.md snippet both state the hard rule: if the search finds nothing, say so. Fabricating a "history" is the most expensive mistake this system can make.

**Same issue again — new file or append?** Append. The tool numbers records automatically.

**Can memory be committed to Git?** Yes. Commit T1/T3; decide on T2 by size and privacy; markers can be ignored.

**Why BM25 instead of embeddings?** Predictability, zero dependencies, offline. Record the user's own wording in `tags` when a concept is likely to be rephrased.

More: [skills/longterm-memory/references/faq.md](skills/longterm-memory/references/faq.md).

## Development, testing, releasing

```bash
node --test "tests/*.test.mjs"       # 37 tests, no install needed
python tests/hermes-selfcheck.py     # Hermes plugin self-check
npm pack                             # -> dsh-longterm-memory-<ver>.tgz
powershell -File scripts/pack-ports.ps1
powershell -File scripts/pack-skills.ps1
powershell -File scripts/finish-publish.ps1   # repo + push + release (+ npm)
```

Both pack scripts syntax-check every shipped entry point and run a real smoke test
(`init → write → search → doctor`) on the packaged CLI, so a package that cannot run fails the build.

## Contributing

PRs welcome — new host adapters, retrieval improvements, docs and tests. Please read [CONTRIBUTING.md](CONTRIBUTING.md).

Project constraints reviewers check:

1. **Memory logic exists once** (`ports/core/`). New adapters go through the CLI or MCP; do not copy retrieval.
2. **Zero third-party Node dependencies.** Use the standard library.
3. **Tests come with the change.** New tools or parameters need assertions.
4. **Keep CLI and SKILL.md in sync** — those two are what the model actually sees.

## License

[MIT](LICENSE) © 2026 aboretheall
