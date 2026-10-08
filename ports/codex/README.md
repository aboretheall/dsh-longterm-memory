# Codex 端口：长期项目记忆

Codex（CLI / 桌面端）通过 **MCP 服务器**接入同一份 T1-T4 记忆。三个部分，全部可选但建议都做：

| 部分 | 作用 | 落点 |
| --- | --- | --- |
| MCP 服务器 | 把 `memory_*` 工具暴露给模型 | `~/.codex/config.toml` 的 `[mcp_servers.longterm_memory]` |
| AGENTS.md 片段 | 告诉模型「什么时候该读写记忆」 | `~/.codex/AGENTS.md` 或项目根 `AGENTS.md` |
| 自定义提示 | 给你 `/lm-brief`、`/lm-recall`、`/lm-close` 三个快捷入口 | `~/.codex/prompts/*.md` |

## 1. 注册 MCP 服务器

把 `config.toml.snippet` 的内容追加到 `~/.codex/config.toml`，把 `<REPO>` 换成真实路径：

```toml
[mcp_servers.longterm_memory]
command = "node"
args = ["D:/你的路径/dsh-longterm-memory/ports/mcp/server.mjs"]
startup_timeout_sec = 20
```

Windows 路径建议用正斜杠 `D:/...`，或用双反斜杠 `D:\\...`（单反斜杠在 TOML 里是转义符）。
重启 Codex 后，工具列表里会出现 `memory_brief` / `memory_search` / `memory_write` 等。

## 2. 写入记忆约定

把 `AGENTS.md.snippet` 追加到 `~/.codex/AGENTS.md`（全局生效）或项目根 `AGENTS.md`（只对该项目生效）。
它说明：会话开头先 `memory_brief`、动手前先 `memory_search`、收尾写回 T3/T1、以及「查不到就说没有」。

## 3. 自定义提示（可选）

把 `prompts/` 下的三个文件复制到 `~/.codex/prompts/`，即可用 `/lm-brief`、`/lm-recall <关键词>`、`/lm-close`。
如果你的 Codex 版本没有自定义提示目录，用 AGENTS.md 里的约定手动让模型调用工具即可，功能不受影响。

## 验证

```bash
node "<REPO>/ports/cli/ltm.mjs" doctor --root "<你的项目>"
```

`结论: 可用` 表示引擎与记忆库都正常；若报「找不到长期记忆项目根目录」，
说明项目还没接入 —— 在 Codex 里让模型调用 `memory_init`（或先跑 `node <REPO>/ports/cli/ltm.mjs init "<项目>"`）。

## 与其它宿主共存

记忆目录按 `T1-*` 前缀自动识别（`T1-交接/` 与 `T1-交接文件夹/` 都认），标记文件写两个
（`.longterm-memory.json` + `.dsh-longterm.json`）。所以 Claude Code、Codex、Hermes、DSH 插件
打开同一个项目时，读写的是**同一份记忆**，不会各存一套。
