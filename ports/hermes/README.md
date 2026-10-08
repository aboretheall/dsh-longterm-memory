# Hermes Agent 端口：长期项目记忆

Hermes 用**原生 Python 插件**接入：`plugin.yaml` + `__init__.py` + `schemas.py` + `tools.py`。
工具逻辑复用共享的 Node CLI（`ports/cli/ltm.mjs`），Python 侧不含任何检索实现 —— 四个宿主召回结果一致。

## 安装

```bash
# 方式 1：从本仓库目录安装（推荐，Hermes 会处理放置与启用）
hermes plugins install <仓库路径>/ports/hermes

# 方式 2：从 Git 安装（发布到 GitHub 之后）
hermes plugins install aboretheall/dsh-longterm-memory/ports/hermes

# 方式 3：手动放置
#   Windows: %LOCALAPPDATA%\hermes\plugins\longterm-memory\
#   Unix/macOS: ~/.hermes/plugins/longterm-memory/
```

然后启用（Hermes 的第三方插件默认只发现、不加载）：

```bash
hermes plugins enable longterm-memory
# 或编辑 config.yaml：
#   plugins:
#     enabled:
#       - longterm-memory
```

## 打包版目录

用 `scripts/pack-ports.ps1` 打出来的 `dist/hermes/longterm-memory/` 是自包含的：

```
longterm-memory/
├─ plugin.yaml
├─ __init__.py
├─ schemas.py
├─ tools.py
├─ bin/ltm.mjs        ← Node CLI
└─ core/              ← 记忆引擎（fsutil / search / engine）
```

`tools.py` 按 `bin/ltm.mjs` → `../cli/ltm.mjs` → `../../ports/cli/ltm.mjs` 依次查找，
所以仓库内直接安装（`ports/hermes`）和安装打包版都能跑；也可用环境变量钉死：

| 环境变量 | 作用 |
| --- | --- |
| `LTM_CLI` | 直接指定 `ltm.mjs` 的绝对路径 |
| `LTM_NODE` | 指定 node 可执行文件（默认取 PATH 上的 `node`） |
| `LTM_PROJECT_ROOT` | 钉住记忆根目录（会话 cwd 不在项目里时有用） |

## 提供的工具

`memory_init` / `memory_adopt` / `memory_brief`（别名 `memory_handoff`）/ `memory_index`（`memory_list`）/
`memory_search` / `memory_slice`（`memory_read`）/ `memory_write` / `memory_log` / `memory_status` / `memory_doctor`

工具名与 Claude Code / Codex 端口完全一致，schema 描述也在 `schemas.py` 里保持同步。

## 斜杠命令

| 命令 | 作用 |
| --- | --- |
| `/lm-brief` | 读取 T1 交接简报 |
| `/lm-recall <关键词>` | 在 T1+T3 检索（口语也能命中），必要时 `scope=all` 回查 T2 |
| `/lm-close` | 给出归档指令：写 T3 → 追加 T2 → 更新 T1 |
| `/lm-doctor` | 自检记忆库 |

## 会话钩子

`register()` 里注册了 `on_session_start` 钩子：会话开始时尝试读取 T1 简报并作为附加上下文返回。
拿不到记忆根目录时**静默跳过** —— 没接入长期记忆的项目不该被插件打扰。

## 与 MCP 方式的关系

Hermes 也支持 MCP，两种方式等价、可二选一（同时开会出现两套同名工具，别这么做）：

```yaml
# config.yaml —— 只用 MCP 方式时
mcp_servers:
  longterm_memory:
    command: node
    args: ["<REPO>/ports/mcp/server.mjs"]
```

原生插件的额外好处：能用 `/lm-*` 斜杠命令、能挂 `on_session_start` 钩子。
若机器上没有 Node，就只能走 MCP 方式（但 MCP server 本身也是 Node 写的，实际仍需 Node >= 20）。

## 验证

```bash
hermes plugins list                     # 应看到 longterm-memory (enabled)
python -c "import json;from ports.hermes.tools import call_tool;print(call_tool('memory_doctor', {}))"
node ports/cli/ltm.mjs doctor --root "<项目根>"
```

第一条报 `enabled`、后两条都输出「结论: 可用」，说明插件、Node 侧与记忆库三处都通了。
