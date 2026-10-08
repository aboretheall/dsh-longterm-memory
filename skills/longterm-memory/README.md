# longterm-memory — 技能版（跨宿主）

Agent Skill 形态的长期记忆系统：`SKILL.md` + `references/` + 自带 CLI。
**不依赖 MCP 服务器**，任何支持 Agent Skills 的宿主都能用；有 MCP 时优先用 MCP 工具（同一套实现）。

| 宿主 | 落点 | 安装 |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/longterm-memory/` | `node scripts/install.mjs --host claude` |
| DSH | `~/.dsh/skills/longterm-memory/` | `node scripts/install.mjs --host dsh` |
| Codex | `~/.codex/skills/longterm-memory/` | `node scripts/install.mjs --host codex` |
| Hermes | `<HERMES_HOME>/skills/<分类>/longterm-memory/` | `node scripts/install.mjs --host hermes --category productivity` |

```bash
node scripts/install.mjs --list            # 先看四个落点
node scripts/install.mjs --host claude     # 装
# 目标已存在时会拒绝覆盖；确认替换加 --force（自动备份旧目录）
```

Windows 上 `HERMES_HOME` 默认是 `%LOCALAPPDATA%\hermes`（不是 `~/.hermes`）。

## 技能内容

```
longterm-memory/
├─ SKILL.md                    # 主流程：会话开始 / 动手前 / 收尾 / 硬规则 / 反模式
├─ references/
│  ├─ tools.md                 # MCP 工具与 CLI 参数全表
│  ├─ layout.md                # 目录结构 + cc/dsh 双布局识别规则
│  └─ faq.md                   # 常见问题与边界（token、编造历史、分类拿不准…）
└─ scripts/
   ├─ ltm.mjs                  # CLI 入口（转发到共享实现）
   ├─ install.mjs              # 安装到四个宿主
   ├─ cli/ltm.mjs              # 打包版自带：真正的 CLI
   └─ core/                    # 打包版自带：记忆引擎（fsutil/search/engine）
```

仓库内使用时 `scripts/ltm.mjs` 会指向 `<repo>/ports/cli/ltm.mjs`；
用 `scripts/pack-skills.ps1` 打包后，`cli/` 与 `core/` 会一并复制进去，技能自包含。

## 与另外两种形态的关系

| 形态 | 适合 | 能力 |
| --- | --- | --- |
| **技能（本目录）** | 没有 MCP 支持、或只想让模型"知道怎么做"的宿主 | 指令 + 自带 CLI；零配置，复制即用 |
| 插件 / MCP 服务器（`ports/`） | Claude Code 插件、Codex、Hermes、任意 MCP 客户端 | 原生工具调用、斜杠命令、会话钩子 |

三者**共用同一份 `ports/core/` 引擎与同一份记忆数据**，可以同时装（技能负责"流程与纪律"，
MCP 负责"省事地调用"）。唯一要避免的是装两份**同名**技能到同一个宿主目录。

## 自带 CLI 用法

```bash
node scripts/ltm.mjs init   "<项目根>"
node scripts/ltm.mjs brief  --root "<项目根>"
node scripts/ltm.mjs search "用户的原话" --root "<项目根>"
node scripts/ltm.mjs write  --title "问题点" --category "修复bug/模块" --content "..." --root "<项目根>"
node scripts/ltm.mjs log    --content "本轮记录" --root "<项目根>"
node scripts/ltm.mjs guide                        # 打印可贴进 AGENTS.md / CLAUDE.md 的约定
```

需要 Node ≥ 20。检索、目录布局、写入去重等逻辑与插件/MCP 端口完全一致。

## 打包与发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-skills.ps1
```

产出 `dist/skills/longterm-memory/` 与 `dist/longterm-memory-skills-v<版本>.zip`（可直接作为 Release 资产）。
脚本自带冒烟测试：在临时项目里跑 `init` → `doctor`，并在缺少 `cli/core` 时直接失败（防止打出"空壳技能"）。
