# Claude Code 端口：长期项目记忆

Claude Code 插件包，四个部分：

| 部分 | 文件 | 作用 |
| --- | --- | --- |
| 插件清单 | `.claude-plugin/plugin.json` + `.mcp.json` | 声明插件并挂上 MCP 服务器 |
| MCP 服务器 | `mcp/server.mjs` + `core/` | 暴露 `memory_*` 工具（13 个，含 DSH 别名） |
| 斜杠命令 | `commands/lm-*.md` | `/lm-init`、`/lm-brief`、`/lm-recall`、`/lm-close`、`/lm-adopt` |
| 会话钩子 | `hooks/session-start.mjs` | 会话开始自动把 T1 简报并入上下文（非记忆项目静默） |
| 技能 | `skills/longterm-memory/SKILL.md` | 让 Claude 知道「什么时候该读写记忆」 |

## 安装

### 方式 1：本地目录（开发/自用）

```bash
# 仓库内直接指向 ports/claude-code；或解压 Release 里的 longterm-memory-claude-code-*.zip
cp -r ports/claude-code ~/.claude/plugins/longterm-memory        # macOS/Linux
xcopy /E /I ports\claude-code "%USERPROFILE%\.claude\plugins\longterm-memory"   # Windows
```

插件自带的 `.mcp.json` 会把 MCP 服务器注册为 `longterm-memory`，重启 Claude Code 后生效。

### 方式 2：作为插件市场条目

把本仓库（或 `ports/claude-code` 子目录）指给 Claude Code 的插件市场来源即可，
`.claude-plugin/plugin.json` 已包含 `name` / `version` / `description` / `mcpServers`。

### 会话钩子（可选）

`hooks/session-start.mjs` 需要显式挂到 `SessionStart` 上。写入 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["~/.claude/plugins/longterm-memory/hooks/session-start.mjs"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

> Windows 上 `command` 用 node 可执行文件全路径（例如 `E:\\语言\\NODEJS\\node.exe`）更稳，路径里的反斜杠要写双份。

钩子行为：在长期记忆项目里输出 T1 简报 + 使用约定（stdout 会被并入上下文）；
**不在记忆项目里则什么都不输出**，不会打扰普通目录的会话。

## 与旧版（v1.0.0）的关系

v1.0.0 是独立实现（自带 `mcp/lib/*.mjs` 检索与工具逻辑）；本端口把它抽成共享内核：
Claude Code / Codex / Hermes / DSH 共用 `ports/core/`，**检索行为保持一致**（同一套 BM25 + 中文单字/双字索引），
并新增了双布局识别与 DSH 工具别名。记忆目录与文件格式**完全兼容**，可以直接换装，不需要迁移数据。

## 验证

```bash
# 1) MCP 握手（应返回工具清单）
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.claude/plugins/longterm-memory/mcp/server.mjs

# 2) 钩子（在记忆项目里应输出 T1 简报；在普通目录应无输出）
echo '{"cwd":"/path/to/your/project"}' | node ~/.claude/plugins/longterm-memory/hooks/session-start.mjs

# 3) 引擎自检
node ~/.claude/plugins/longterm-memory/../path-to/core/../cli/ltm.mjs doctor  # 用仓库里的 ports/cli/ltm.mjs 更快
```
