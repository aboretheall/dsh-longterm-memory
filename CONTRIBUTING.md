# 贡献指南

感谢愿意改进这个项目。这个仓库同时维护四种宿主适配与一份共享引擎，所以下面几条约束比"风格偏好"重要得多。

## 项目约束（评审会看）

1. **记忆逻辑只有一份**，在 `ports/core/`（`fsutil` 布局与文件工具 / `search` BM25 / `engine` 骨架·简报·切片·写入·日志·自检）。
   新增宿主适配请走 **CLI**（`ports/cli/ltm.mjs`）或 **MCP**（`ports/mcp/server.mjs`），
   不要把检索或目录布局再实现一遍。`tests/ports.test.mjs` 里有守卫断言。
2. **Node 侧零第三方依赖**。只用标准库；能用 `node:fs` / `node:path` 解决就不要引包。
   （Client 半例外：使用宿主注入的 React，不额外声明依赖。）
3. **测试随改动来**。新增工具、参数、宿主或打包产物，都要有对应断言；改动检索行为要补命中/不命中的用例。
4. **CLI 与 SKILL.md 保持同步**。模型实际看到的是这两处：`skills/longterm-memory/SKILL.md` 与
   `skills/longterm-memory/references/tools.md`。加了参数却不写进去，等于没加。
5. **Windows 上的 .ps1 一律 ASCII-only**。本机与多数贡献者的 PowerShell 5.1 会把 BOM-less UTF-8 的脚本按 ANSI 解码，
   中文注释会"吞掉"后面的行（这个坑真的踩过）。需要输出中文时读取外部文件：
   `[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`。

## 开发环境

- Node **≥ 20**（仓库在 24 上开发）
- Python **≥ 3.9**（只有 `tests/hermes-selfcheck.py` 与 Hermes 插件需要）
- Windows / macOS / Linux 均可；路径处理统一走 `node:path` 与 `ports/core/fsutil.mjs` 的净化函数

```bash
node --test "tests/*.test.mjs"        # 37 项：引擎 / 端口 / 技能 / 清单一致性
python tests/hermes-selfcheck.py      # Hermes 插件注册与工具调用自检
node ports/cli/ltm.mjs guide          # 打印可贴进 AGENTS.md 的使用约定
```

## 目录速览

| 路径 | 放什么 |
| --- | --- |
| `index.js` / `client.js` | DSH 插件的 Host / Client 半（工具、设置页、会话菜单、系统提示片段） |
| `ports/core/` | ★ 共享记忆引擎（唯一实现） |
| `ports/cli/` | 命令行入口（Hermes 插件也调用它） |
| `ports/mcp/` | 通用 MCP 服务器 |
| `ports/{claude-code,codex,hermes}/` | 三个宿主适配（清单 / 片段 / 原生插件） |
| `skills/longterm-memory/` | 跨宿主技能（canonical 来源，插件包里的技能由打包脚本复制） |
| `docs/` | 架构、兼容性、市场条目 |
| `tests/` | 测试 |
| `scripts/` | 打包与发布脚本 |

## 新增一个宿主适配的步骤

1. 先确认该宿主支持什么：MCP 服务器？Agent Skills 目录？原生插件 API？（写进 `docs/COMPATIBILITY.md`）
2. 能走 MCP 或技能就不要写原生插件 —— 少一份实现，少一份漂移。
3. 原生插件必须通过 **CLI 子进程** 调用 `ports/cli/ltm.mjs`（参考 `ports/hermes/tools.py`），
   并把 CLI / core 的定位候选路径写成"仓库内 + 打包后"两种都能找到。
4. 在 `scripts/pack-ports.ps1` 里加打包分支，并在 `tests/` 里加清单断言（文件存在、工具名一致、调用不复制实现）。
5. 更新 `README.md`、`README.en.md`、`ports/README.md` 的宿主表。

## 提交规范

- 提交信息用 `feat(scope): …` / `fix(scope): …` / `docs: …` / `chore: …`；scope 用宿主或目录名（`ports`、`hermes`、`skills`…）。
- 一个 PR 只做一件事；重构与功能分开。
- 版本变更同步更新 `CHANGELOG.md`（新增/变更/验证三段），并保证四个宿主包里的版本号一致
  （`package.json`、`ports/claude-code/.claude-plugin/plugin.json`、`ports/hermes/plugin.yaml`、技能 `VERSION.txt` 由打包生成）。

## 发布（维护者）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-skills.ps1     # 技能包 + 冒烟
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-ports.ps1      # 四个宿主包 + 冒烟
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/finish-publish.ps1  # 建库/推 tag/发 Release(+npm)
```

打 tag 触发 `.github/workflows/publish.yml` 时，会先校验 tag 与 `package.json` 版本一致，再 `npm publish` 并建 Release。

## 报告问题

请附：宿主与版本、Node/Python 版本、`ltm doctor` 输出、以及复现步骤。
与检索质量相关的问题，最好给出「记录内容 + 查询语句 + 期望命中」三样。
