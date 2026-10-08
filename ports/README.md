# ports — 一套记忆引擎，四个宿主

`ports/` 里放的是**同一份记忆系统的多宿主适配层**。检索、骨架、切片、归档只有一份实现
（`ports/core/*.mjs`，零第三方依赖），宿主差异只体现在「怎么把工具交给模型」：

| 宿主 | 接入方式 | 落点 | 端口目录 |
| --- | --- | --- | --- |
| **DSH**（DeepSeek Harness） | Cordis 插件（本仓库根目录） | `dsh plugin add dsh-longterm-memory` | `/`（index.js + client.js） |
| **Claude Code** | 插件包：MCP 服务器 + 斜杠命令 + SessionStart 钩子 + Skill | `~/.claude/plugins/longterm-memory/` | `ports/claude-code/` |
| **Codex** | MCP 服务器 + AGENTS.md 约定 + 自定义提示 | `~/.codex/config.toml`、`~/.codex/AGENTS.md`、`~/.codex/prompts/` | `ports/codex/` |
| **Hermes** | 原生 Python 插件（内部调用同一个 Node CLI） | `<HERMES_HOME>/plugins/longterm-memory/` | `ports/hermes/` |
| 任意 MCP 客户端 | 通用 MCP 服务器（stdio） | 客户端自己的 MCP 配置 | `ports/mcp/` |
| 任意 Agent Skills 宿主 | 技能形态（复制目录即用，不需要 MCP） | `node skills/longterm-memory/scripts/install.mjs --host <claude\|dsh\|codex\|hermes>` | `skills/longterm-memory/` |

## 为什么不让每个宿主各写一套

同一项目在四个宿主里读写的必须是**同一份 T1-T4**，否则「开新会话不失忆」这个目标直接失效。
所以：

- **一份核心**：`ports/core/engine.mjs`（骨架/简报/索引/检索/切片/写入/日志/自检）。
- **一份传输层**：`ports/mcp/server.mjs`（stdio JSON-RPC），Claude Code / Codex / Hermes / 任意 MCP 客户端共用。
- **一份命令行**：`ports/cli/ltm.mjs`，Hermes 的 Python 插件通过 subprocess 调用它 —— 不复制检索实现。
- **布局自动识别**：`T1-交接/`（Claude Code 命名）与 `T1-交接文件夹/`（DSH 命名）都能认，
  标记文件默认**同时写两个**（`.longterm-memory.json` + `.dsh-longterm.json`）。
  于是四个宿主打开同一项目时，认的是同一份记忆，不会各存一套。

工具名同时提供两套叫法（主名 + 别名），模型在哪个宿主里看到的名字都不陌生：

| 主名（Claude Code / Hermes 端口） | 别名（DSH 插件的叫法） |
| --- | --- |
| `memory_brief` | `memory_handoff` |
| `memory_slice` | `memory_read` |
| `memory_index` | `memory_list` |
| `memory_status` | `memory_status` |

## 快速验证（不启动任何宿主）

```bash
node ports/cli/ltm.mjs init  "<项目根>"
node ports/cli/ltm.mjs brief --root "<项目根>"
node ports/cli/ltm.mjs search "某个历史问题" --root "<项目根>"
node ports/cli/ltm.mjs doctor --root "<项目根>"
```

MCP 服务器自测（发一行 JSON，收一行 JSON）：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ports/mcp/server.mjs
```

## 打包与发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-ports.ps1
```

产出 `dist/` 下四个可独立分发的包 + 四个 zip：

| 包 | 内容 | 给谁 |
| --- | --- | --- |
| `dist/claude-code/longterm-memory/` | `.claude-plugin/`、`.mcp.json`、`commands/`、`hooks/`、`skills/`、`mcp/`、`core/` | 放进 `~/.claude/plugins/` 或作为插件市场条目 |
| `dist/codex/longterm-memory-codex/` | `config.toml.snippet`、`AGENTS.md.snippet`、`prompts/` | 手动合并进 `~/.codex/` |
| `dist/hermes/longterm-memory/` | `plugin.yaml`、`__init__.py`、`schemas.py`、`tools.py`、`bin/ltm.mjs`、`core/` | `hermes plugins install <路径>` |
| `dist/mcp/longterm-memory-mcp/` | `server.mjs`、`core/` | 任何 MCP 客户端 |

四个 zip 都在 `dist/` 根下，可直接挂到 GitHub Release 资产上。

## 依赖与限制

- 需要 **Node.js >= 20**（四个宿主共用；Hermes 侧也走 Node，Python 侧不含检索实现）。
- 检索是**确定性 BM25**（中文单字+双字索引），不是向量检索：可预测、零依赖、零联网。
- T2 超过 600 KB 的周文件不读全文，只按文件名命中（避免把日志拖进上下文）。
- Windows 文件名禁用字符会被视觉等价替换（`->` → `→`），所以 T2 周文件名里是箭头而不是 `->`。
