# Changelog

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.3] - 2026-10-09

发布前的隐私清理：仓库里不留个人路径，历史里的提交身份统一。

### Changed

- `optional/codex-ui-patch/reapply-codex-patch.mjs`：默认目标路径里的 Windows 用户名改为占位符
  `C:/Users/<user>/...`（本来也支持 `CODEX_CLIENT` 环境变量覆盖，功能不变）。
- `ports/codex/config.toml.snippet` 与 `UPLOAD.md`：示例路径里的盘符/目录名改为 `<本仓库目录>` / `D:/你的路径/...`。
- `scripts/finish-publish.ps1`：代理地址改为先读 `LTM_GIT_PROXY` 环境变量，未设置时才回落到 `127.0.0.1:7897`。
- **历史重写**：早期提交的作者/提交者身份是 `aboretheall`（按错 owner 写的），
  现已全部改写为 `aboretheall <aboretheall@users.noreply.github.com>`。

### Verified

- 全仓库（tracked 文件）已无 Windows 用户名与盘符目录名残留；37/37 测试通过。
- 历史重写后 tag 一并指向新提交；本地未发布，故无需同步任何远端。

## [0.5.2] - 2026-10-09

更正仓库归属：GitHub owner 从 `aboretheall` 改为 **`aboretheall`**（之前是按 dsh-purge 的作者猜的，猜错了）。

### Changed

- `package.json` 的 `repository` / `homepage` / `bugs` / `author`、`README.md`、`README.en.md`、
  `docs/market-entry.yml`、`ports/claude-code/.claude-plugin/plugin.json`、`ports/hermes/plugin.yaml`、
  打包与发布脚本的默认 owner、`LICENSE` 的版权署名、`tests/manifest.test.mjs` 的断言，
  一律指向 `https://github.com/aboretheall/dsh-longterm-memory`。
- 目标仓库 `aboretheall/dsh-longterm-memory` 已存在且为**空仓库**，因此推送不需要 rebase。

### Verified

- 全仓库（tracked 文件）已无 `aboretheall` 残留；37/37 测试通过；产物按 0.5.2 重新打包。

## [0.5.1] - 2026-10-09

修一个**只有干净环境才会暴露**的 bug：把仓库克隆到没有记忆库的机器上时，`ltm init` 直接报错退出。

### Fixed

- `ports/cli/ltm.mjs`：`init` / `adopt` 是「创建记忆」的命令，不该要求项目里已经有记忆根目录。
  此前 `requireRoot()` 一律向上查找记忆根，找不到就抛错 —— 在开发者本机之所以没暴露，
  是因为父目录恰好有一个记忆库（`T1-交接文件夹/`）。现在 `init` / `adopt` 在找不到时回落到 cwd，
  其余命令保持"找不到就报错并提示三选一"的行为。
- 顺带把 `--root` 显式传入时的处理独立出来，避免 `--root ''` 这类空值被当成"没传"。

### Verified

- 干净克隆（`git clone <repo> /tmp/x && cd /tmp/x && node --test "tests/*.test.mjs"`）在修复后 **37/37 通过**；
  修复前同样的克隆会挂 3 项（CLI 全链路、技能自带 CLI、技能安装后可跑）。

## [0.5.0] - 2026-10-09

完整项目化：文档重写为可直接对外发布的项目主页，补齐贡献指南、示例与文档索引。

### Added

- `README.md` 全面重写：它解决什么问题、T1-T4 核心概念、**功能总览（记忆能力 / 工程能力 / 分发运维）**、
  六种分发形态对照、按宿主的最短路径、工具与 CLI 参考、工作原理（检索 / 写入 / token 经济学 / 双布局）、
  记忆库与仓库结构、配置、兼容性矩阵、FAQ、开发测试发布、贡献约束。
- `README.en.md`：英文镜像（同结构，便于海外用户与市场条目）。
- `CONTRIBUTING.md`：项目硬约束（一份引擎、零依赖、测试随改动、CLI 与 SKILL.md 同步、.ps1 保持 ASCII）、
  新增宿主的五步流程、提交规范、发布流程。
- `docs/README.md`：文档索引 + 「你想做什么 → 先读哪份」对照表。
- `examples/README.md`：10 组可直接复制的配方（纯 CLI、AGENTS.md 注入、MCP 客户端、Claude Code、Codex、
  Hermes、技能安装、CI 守门、Node/Python 脚本调用、打包分发）。
- `docs/ARCHITECTURE.md`：新增「一个引擎，六种形态」总览图与契约说明。
- `docs/COMPATIBILITY.md`：新增「形态 × 宿主」矩阵。

### Changed

- npm 包 `files` 增加 `skills`、`examples`、`CONTRIBUTING.md`：装到任何环境都能拿到技能与示例。

### Verified

- 37/37 测试通过（文档改动不影响行为）；打包脚本与清单测试在 0.5.0 版本号下通过。

## [0.4.0] - 2026-10-09

技能版：把同一套记忆系统做成一份**跨宿主 Agent Skill**（不依赖 MCP 也能用）。

### Added

- `skills/longterm-memory/`：符合 Agent Skills 规范的技能包。
  - `SKILL.md`：主流程（会话开始读简报 / 动手前检索 / 收尾写回 / 硬规则 / 反模式）+ 真实触发词。
  - `references/tools.md`：MCP 工具与 CLI 参数全表（含 DSH 别名对照）。
  - `references/layout.md`：目录结构 + `cc`/`dsh` 双布局识别规则与取舍。
  - `references/faq.md`：token 预算、禁止编造历史、分类拿不准、Windows 文件名等边界问题。
  - `scripts/ltm.mjs`：CLI 转发入口；`scripts/install.mjs`：装到 Claude Code / DSH / Codex / Hermes 四个宿主。
- `scripts/pack-skills.ps1`：产出 `dist/skills/longterm-memory/` 与 `dist/longterm-memory-skills-v<版本>.zip`，
  自带语法检查 + 冒烟测试（init → write → search → doctor），缺 `scripts/cli` 或 `scripts/core` 直接失败。
- `tests/skills.test.mjs`（9 项）：规范校验（name/description ≤1024/触发词/引用文件存在）、
  自带 CLI 独立可用、安装器 `--list`/`--dry-run`/`--force` 保护、安装后可跑。

### Changed

- **安装器自带"注水"能力**：从仓库安装时会把真正的 CLI 与引擎复制进目标目录，
  使技能自包含（否则安装到别处后 `scripts/ltm.mjs` 找不到实现）。
- 技能只有一份 canonical 来源（`skills/longterm-memory/`）：Claude Code 与 Hermes 插件包里的技能
  由打包脚本复制，避免两处漂移。
- Hermes 插件新增 `ctx.register_skill`：打包版会随插件附带技能，
  模型可用 `skill_view("longterm-memory:longterm-memory")` 取完整流程说明。
- npm 包 `files` 增加 `skills`。

### Verified

- 37/37 测试通过（含技能与端口）。
- 技能安装到 Hermes 与 Codex 的技能目录后，宿主能发现它；安装到临时目录后自带 CLI 仍可独立跑通。

## [0.3.0] - 2026-10-09

多宿主版本：同一份 T1-T4 记忆，现在可以被 **Claude Code / Codex / Hermes / DSH** 四个宿主共用。

### Added

- `ports/`：多宿主适配层，共享一份记忆引擎（零第三方依赖）。
  - `ports/core/`：引擎（`fsutil` 布局与文件工具 / `search` BM25 检索 / `engine` 骨架·简报·索引·切片·写入·日志·自检）。
  - `ports/cli/ltm.mjs`：命令行入口，任何终端都能用，也是 Hermes 插件调用的实现。
  - `ports/mcp/server.mjs`：通用 MCP 服务器（stdio），三个宿主共用同一传输层。
  - `ports/claude-code/`：Claude Code 插件（`.claude-plugin/plugin.json`、`.mcp.json`、5 个斜杠命令、
    SessionStart 钩子、Skill）。
  - `ports/codex/`：`config.toml` 片段（`[mcp_servers.longterm_memory]`）、`AGENTS.md` 片段、3 个自定义提示。
  - `ports/hermes/`：Hermes 原生 Python 插件（`plugin.yaml` + `__init__.py` + `schemas.py` + `tools.py`），
    13 个工具、4 个斜杠命令、`on_session_start` 钩子。
- **双布局自动识别**：`T1-交接/`（Claude Code 命名）与 `T1-交接文件夹/`（DSH 命名）都能认；
  `memory_init` 默认**同时写两个标记文件**（`.longterm-memory.json` + `.dsh-longterm.json`），
  标记里记录真实布局，四个宿主打开同一项目时读写同一份记忆。
- **工具名双向兼容**：主名沿用 Claude Code 插件 v1.0.0 的 `memory_brief/index/slice/log`，
  同时提供 DSH 插件的别名 `memory_handoff/read/list`，任何宿主里叫法都不陌生。
- `scripts/pack-ports.ps1`：打出四个可独立分发的包与 zip
  （`longterm-memory-{claude-code,codex,hermes,mcp}-v<ver>.zip`），并自带语法检查与打包后冒烟测试。
- `tests/ports.test.mjs`（12 项）与 `tests/hermes-selfcheck.py`（Hermes 插件自检，Python 3.9 实机通过）。

### Changed

- 检索增加**强词要求**：只命中中文单字（的/在/不…）的文档不再算命中，
  显著减少噪声；单字查询仍然可用（此时退回全量词表）。
- npm 包新增 `ports/`，安装后即可直接使用 CLI 与 MCP 服务器（服务任意宿主，不限于 DSH）。

### Verified

- Hermes Agent v0.21.4：`hermes plugins install` 后 `plugins list` 显示 `longterm-memory 2.0 (user)`，启用后状态 `enabled`。
- Claude Code：SessionStart 钩子在长期记忆项目里输出 T1 简报、在普通目录静默；MCP 握手与 13 个工具注册通过。
- 打包产物在 Python 3.9.6 与 Node 24 上均通过自检；四个 zip 分别 25.5 / 22.9 / 25 / 17.7 KB。

## [0.2.0] - 2026-10-08

首个开源版本。此前的 `0.1.x` 只在本机以 `@local/dsh-longterm-memory` 私有 link 形式存在。

### Added

- 开源仓库结构：`README.md` / `README.en.md` / `CHANGELOG.md` / `LICENSE` (MIT) / `.gitignore`。
- `icon.svg`：插件卡片图标（T1 高亮、T2-T4 逐层变冷），并在 `package.json` 中声明 `icon`。
- `locale/en.json` + `locale/zh.json`：插件市场与设置页的标题 / 描述元数据（修复了 0.1.x 里
  `zh.json` 的中文乱码，现在两种语言都是合法 UTF-8）。
- `tests/host-tools.test.mjs`：用 stub `ctx` 驱动 6 个工具与 RPC 通道的冒烟测试（`node --test`）。
- `tests/manifest.test.mjs`：清单一致性测试（包名 ⇄ Client 装载 id ⇄ 补丁行 id、导出文件存在）。
- `docs/COMPATIBILITY.md`：宿主版本、服务依赖、Slot 依赖、与 Claude 侧 `longterm-memory` 技能的工具名对照。
- `docs/ARCHITECTURE.md`：Host/Client 半的职责、数据流、扩展点。
- `.github/workflows/ci.yml`：push / PR 上跑清单校验与测试。
- `.github/workflows/publish.yml`：打 tag 时 `npm publish --provenance`（需配置 `NPM_TOKEN`）。
- `scripts/publish.ps1`：一条命令改 owner、建仓、提交、推 GitHub、可选发 npm。

### Changed

- 包名由 `@local/dsh-longterm-memory` 改为公共包名 **`dsh-longterm-memory`**；
  Client 装载 id 与 bundle 补丁行 id 同步改名（三者必须一致，否则 Client 半不会挂载）。
- `package.json` 补全 `repository` / `homepage` / `bugs` / `license` / `keywords` / `files` /
  `publishConfig` / `dsh.engines.dsh`，达到可被插件市场收录的形态。
- `cordis.patch.yml` 增加中文注释与可覆盖的 `config` 说明；默认值不变。
- Client 半：接入可选 `ctx.locale`（注册 `zh`/`en` 字典，取不到 locale 服务时退回中文），
  全部界面文案改为可翻译；其余交互与 0.1.x 完全一致。
- Host 半：新增可选配置 `markerFile`（默认 `.dsh-longterm.json`），便于避免与项目自带文件重名；
  其余工具行为、返回文本、目录结构保持向后兼容。
- `dsh.client.inject` 收敛为实际使用的三项（connection / ui-slots / locale）。
- Client 半的注册项 id 改为包命名空间前缀（`dsh-longterm-memory` / `dsh-longterm-memory.adopt`）：
  Slot 目录规定复用宿主 id 会替换那一行，加前缀才不会与其他插件抢同一个 cell。
- 会话三点菜单项对 `useMenuOpenState` hook 做了缺失兜底（拿不到时只是不主动关闭菜单）。

### Fixed

- `locale/zh.json` 的中文曾被写成非 UTF-8 字节，现在为合法 UTF-8。
- Client 半在 `ctx.connection` 缺失时不再直接抛错。

### 兼容性

- 在 DSH `0.2.0-rc.2`（桌面端，Node 24.21）实测通过；`dsh.engines.dsh` 声明为 `>=0.1.7`。
- 细节见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。
