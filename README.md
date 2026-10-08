<div align="center">

<img src="icon.svg" width="88" alt="dsh-longterm-memory">

# dsh-longterm-memory

**把项目记忆从对话历史里搬出来，落到文件上。开新会话不失忆，也不烧无关 token。**

一套记忆引擎（T1 交接 / T2 全日志 / T3 分类整理 / T4 项目），六种分发形态，四个宿主共用同一份记忆。

[![npm](https://img.shields.io/npm/v/dsh-longterm-memory)](https://www.npmjs.com/package/dsh-longterm-memory)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![tests](https://img.shields.io/badge/tests-37%20passing-success)](tests/)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.1.7-blueviolet)](docs/COMPATIBILITY.md)
[![hosts](https://img.shields.io/badge/hosts-DSH%20%7C%20Claude%20Code%20%7C%20Codex%20%7C%20Hermes-ff69b4)](#六种分发形态)

[English](README.en.md) | 中文

</div>

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [核心概念：T1-T4](#核心概念t1-t4)
- [功能总览](#功能总览)
- [六种分发形态](#六种分发形态)
- [快速开始](#快速开始)
- [工具与 CLI 参考](#工具与-cli-参考)
- [工作原理](#工作原理)
- [记忆库结构](#记忆库结构)
- [仓库结构](#仓库结构)
- [配置](#配置)
- [兼容性](#兼容性)
- [常见问题](#常见问题)
- [开发、测试与发布](#开发测试与发布)
- [贡献](#贡献)
- [License](#license)

## 它解决什么问题

长项目里两个痛点同时存在，而且互相冲突：

| 痛点 | 常见做法 | 后果 |
| --- | --- | --- |
| 开新会话就失忆 | 把历史全塞进上下文 | token 暴涨、噪声进上下文、模型开始幻觉 |
| 长篇会话烧 token | 靠模型自己记 | 关键结论会丢；总结压缩又丢细节 |

本项目的答案是：**记忆不靠对话历史，靠文件。** 对话是工作内存（贵、短、会丢），
文件是长期记忆（跨会话、跨月、跨年）。文件再分四层，模型**只读当下需要的那一层**。

顺带解决第三件事：**多 agent / 多人协作**。记忆放在项目里而不是某个会话里，谁接手（换一个 agent、
换一个人、换一台机器）读到的都是同一份上下文 —— 不用再"问上一个人当时怎么想的"。

## 核心概念：T1-T4

| 层 | 目录 | 作用 | 什么时候读 | token 成本 |
| --- | --- | --- | --- | --- |
| **T1** | `T1-交接/` | 交接简报：进度 + 活跃问题 + 用户习惯 + AI 踩过的坑 | **每次会话开头读一次** | 常驻，建议 ≤200 行 |
| **T2** | `T2-全日志/` | 原始会话存档，一周一个文件 | **不主动读**，只在 T3 查不到时兜底 | 只按文件名命中 |
| **T3** | `T3-分类整理/` | 结构化知识库：`大类/模块/问题点` | **检索命中才读** | 只读命中片段 |
| **T4** | `T4-项目/` | 项目代码与资源 | 按需读具体文件 | 不进记忆 |

一句话：**T1 是寄存器，T3 是热缓存，T2 是冷存储。** 归档不落文件 = 这次会话白干。

## 功能总览

### 记忆能力

| 功能 | 说明 |
| --- | --- |
| **冷启动交接** | 一个调用拿到「现在什么状态 + 下一步做什么 + 有什么坑」，取代通读任何文件 |
| **结构化写入** | 按 `修复bug/新功能/疑问咨询/回顾重构` + 模块 + 问题点三级归档，同一问题**自动续写「第 N 条记录」**而不是新建文件 |
| **BM25 检索（中文友好）** | 中文按「单字 + 相邻双字 + 三字」建索引 → **用户的口语说法也能命中**；标题命中加权；命中越多查询词越靠前 |
| **噪声抑制** | 只命中中文单字（的/在/不）的文档不算命中；整条查询是单字时自动退回全量词表 |
| **精确取用** | `memory_slice` 按**标题**或**行号**取一段，避免把大文件塞进上下文 |
| **低成本索引** | `memory_index` 只返回文件清单 + 标题大纲，先看「有什么记忆」再决定是否深入 |
| **原始日志轮转** | `memory_log` 自动写进 T2 周文件，带周号、日期、轮次、时间戳 |
| **一键收养** | `memory_adopt` 建骨架 + 扫描项目目录生成 `项目结构.md` 草稿 + 写标记 |
| **自检** | `memory_doctor` / `memory_status` 检查四层目录、标记、简报预算 |

### 工程能力

| 功能 | 说明 |
| --- | --- |
| **零第三方依赖** | 纯 Node ESM，只用标准库；不联网、无构建步骤、无 lockfile 地狱 |
| **一份引擎，四个宿主** | DSH / Claude Code / Codex / Hermes 共用 `ports/core/`（检索、骨架、切片、归档只有一份实现） |
| **双布局自动识别** | `T1-交接/`（Claude Code 命名）与 `T1-交接文件夹/`（DSH 命名）都能认，**同一项目不会出现两套记忆** |
| **双标记** | `memory_init` 默认同时写 `.longterm-memory.json` + `.dsh-longterm.json`，四个宿主打开同一项目都认识它 |
| **工具名双向兼容** | 主名 `memory_brief/index/slice/log`，别名 `memory_handoff/read/list`（DSH 叫法），任何宿主里都不陌生 |
| **token 预算守护** | 未标记为长期项目的项目里，系统提示片段返回空字符串 → **不装即零成本**；装了就按预算截断 |
| **路径安全** | 所有记忆路径强制为记忆根目录内的相对路径；绝对路径与 `..` 越界直接拒绝 |
| **零成本回滚** | 关掉开关只是不读写记忆，T1-T4 文件原样保留；卸载插件也不动数据 |
| **双语** | 插件卡片、设置页、界面文案随宿主语言切换（中/英），无 locale 服务时退回中文 |

### 分发与运维

- **六种形态**：DSH 插件、Claude Code 插件包、Codex 配置片段、Hermes 原生插件、跨宿主技能、通用 MCP 服务器。
- **一键打包**：`scripts/pack-ports.ps1` + `scripts/pack-skills.ps1` 产出 5 个可独立分发的 zip，自带语法检查与打包后冒烟测试。
- **一条命令发布**：`scripts/finish-publish.ps1` 建仓库 → 推 main + tag → 发 Release（自动带全部资产）→ 可选 npm publish。
- **CI**：`.github/workflows/ci.yml` 在 Node 20/22/24 上跑全部测试并检查打包内容。

## 六种分发形态

| # | 形态 | 适合谁 | 安装 | 目录 |
| --- | --- | --- | --- | --- |
| 1 | **DSH 插件** | DeepSeek Harness 用户 | `dsh plugin --profile <p> add dsh-longterm-memory` | 仓库根（`index.js` + `client.js`） |
| 2 | **Claude Code 插件包** | Claude Code 用户 | 解压到 `~/.claude/plugins/longterm-memory/` | [`ports/claude-code/`](ports/claude-code/) |
| 3 | **Codex 接入** | Codex 用户 | 片段追加进 `~/.codex/config.toml` + `AGENTS.md` | [`ports/codex/`](ports/codex/) |
| 4 | **Hermes 原生插件** | Hermes Agent 用户 | 复制到 `<HERMES_HOME>/plugins/` 后 `hermes plugins enable` | [`ports/hermes/`](ports/hermes/) |
| 5 | **跨宿主技能** | 任何 Agent Skills 宿主（不需要 MCP） | `node skills/longterm-memory/scripts/install.mjs --host <claude\|dsh\|codex\|hermes>` | [`skills/longterm-memory/`](skills/longterm-memory/) |
| 6 | **通用 MCP 服务器** | 任意 MCP 客户端（Cursor、Zed、自研…） | `node ports/mcp/server.mjs`（stdio） | [`ports/mcp/`](ports/mcp/) |

**它们共用同一份 `ports/core/` 引擎与同一份记忆数据**，可以同时装：技能负责"流程与纪律"，
MCP/插件负责"省事地调用"。唯一要避免的是往同一个宿主目录装两份**同名**技能。

## 快速开始

### 0. 最短路径：只要一个项目能记住东西（不需要任何宿主集成）

```bash
git clone https://github.com/aboretheall/dsh-longterm-memory.git
cd your-project
node ../dsh-longterm-memory/ports/cli/ltm.mjs init .          # 建 T1-T4 骨架
node ../dsh-longterm-memory/ports/cli/ltm.mjs adopt .         # 或：顺便扫描项目结构
```

### 1. DSH（DeepSeek Harness）

```bash
dsh plugin --profile <profile> add dsh-longterm-memory
```

重启后：**设置 → 插件 → 长期项目记忆** 可见；会话 `⋯` 菜单与会话头部出现 **📁 设为长期项目**，
点一下自动建骨架、扫描结构、写标记，之后每个会话自动交接。

### 2. Claude Code

```bash
cp -r ports/claude-code ~/.claude/plugins/longterm-memory     # macOS/Linux
```

自带 `.mcp.json`（MCP 工具）、5 个斜杠命令（`/lm-init` `/lm-brief` `/lm-recall` `/lm-close` `/lm-adopt`）、
`SessionStart` 钩子（会话开头自动加载 T1 简报）。详见 [ports/claude-code/README.md](ports/claude-code/README.md)。

### 3. Codex

把 [`ports/codex/config.toml.snippet`](ports/codex/config.toml.snippet) 追加进 `~/.codex/config.toml`
（把 `<REPO>` 换成本仓库绝对路径），再把 [`AGENTS.md.snippet`](ports/codex/AGENTS.md.snippet) 写进 `AGENTS.md`。

```toml
[mcp_servers.longterm_memory]
command = "node"
args = ["D:/path/to/dsh-longterm-memory/ports/mcp/server.mjs"]
startup_timeout_sec = 20
```

### 4. Hermes

```bash
# 目录插件（本地）：复制到插件目录后启用
#   Windows: %LOCALAPPDATA%\hermes\plugins\longterm-memory\
#   Unix:    ~/.hermes/plugins/longterm-memory/
hermes plugins enable longterm-memory
hermes gateway restart          # 生效
```

插件提供 13 个工具、4 个斜杠命令（`/lm-brief` `/lm-recall` `/lm-close` `/lm-doctor`）、
`on_session_start` 钩子，并随包附带同名技能。详见 [ports/hermes/README.md](ports/hermes/README.md)。

### 5. 技能（跨宿主，不需要 MCP）

```bash
node skills/longterm-memory/scripts/install.mjs --list           # 看四个宿主落点
node skills/longterm-memory/scripts/install.mjs --host claude    # 或 dsh / codex / hermes
```

技能自带 CLI 与引擎（自包含），装到任何地方都能跑。详见 [skills/longterm-memory/README.md](skills/longterm-memory/README.md)。

## 工具与 CLI 参考

有 MCP 就用工具，没有就用自带 CLI —— **同一套实现，参数名一致**。

| 目的 | MCP 工具 | DSH 别名 | CLI |
| --- | --- | --- | --- |
| 建骨架 | `memory_init` | — | `ltm init [根] [--layout cc\|dsh]` |
| 收养已有项目 | `memory_adopt` | — | `ltm adopt [根] [--layout …]` |
| 读简报 | `memory_brief` | `memory_handoff` | `ltm brief [--root R] [--budget N]` |
| 看有哪些记忆 | `memory_index` | `memory_list` | `ltm index [--scope T3]` |
| 检索 | `memory_search` | — | `ltm search "原话" [--scope hot\|all] [--limit N]` |
| 取某一段 | `memory_slice` | `memory_read` | `ltm slice --file F [--heading H \| --lines 12-40]` |
| 写入 T3 | `memory_write` | — | `ltm write --title T --category C --content "…"` |
| 追加 T2 | `memory_log` | — | `ltm log --content "…"` |
| 状态 / 自检 | `memory_status` `memory_doctor` | — | `ltm status` / `ltm doctor` |
| 使用约定 | `memory_guide` | — | `ltm guide` |

参数全表（含 `scope` 语义、`tags`、`--content-file` 等）见
[skills/longterm-memory/references/tools.md](skills/longterm-memory/references/tools.md)。

### 推荐循环

```
会话开始   → memory_brief                          # 拿到「现在什么状态、下一步做什么」
动手之前   → memory_search "<用户的原话>"            # 命中的老问题优先复用历史结论
需要细节   → memory_slice --heading "某标题"         # 只读那一节
会话收尾   → memory_write → T3（现象/根因/改了什么/怎么验证/遗留风险）
           → memory_log   → T2（本轮原始记录）
           → memory_write → T1（进度交接 ≤200 行 + 当前活跃问题）
```

**搜不到就说搜不到。** 编造一条"历史修复记录"是这套系统里最贵的错误 —— 它会被写回文件，
污染之后所有会话。

## 工作原理

### 检索：确定性 BM25（不是向量检索）

```
中文查询 "敌人回血"
   ↓ 分词：单字 敌/人/回/血 + 双字 敌人/人回/回血 + 三字 敌人回/人回血
   ↓ BM25 打分（标题命中额外加权；命中查询词种类越多越靠前）
   ↓ 噪声抑制：只命中单字（的/在/不）的文档不算命中
   ↓ 返回命中「章节」片段（默认每节 700 字符），而不是整个文件
```

选它的理由：**可预测、零依赖、零联网、可离线复现**。代价是换词可能命中不到 ——
所以写入时把**用户的原话**记进 `tags`，命中率就上来了。

### 写入：同一问题续写而不是散落

```
memory_write(category="修复bug/游戏机制/NPC相关问题", title="NPC穿模", content="…")
   ↓ 文件已存在？
      否 → 创建 # NPC穿模 + "## 第 1 条记录 · 时间戳"
      是 → 追加 "## 第 N 条记录 · 时间戳"（N = 已有记录数 + 1）
```

这样「同一个问题第 3 次出现」时，历史演进（哪版方案失效了）是连续的，检索也不会碎成一片。

### token 经济学

| 动作 | 常驻成本 |
| --- | --- |
| 未接入长期记忆的项目 | **0**（系统提示片段返回空字符串） |
| 已接入：每轮会话 | T1（建议 ≤200 行）+ 约 4 行使用约定 |
| 一次检索 | 命中片段的字符数（默认 ≤8 节 × 700 字符） |
| 一次取片段 | 那一节的字符数 |
| T2 日志 | 不进上下文（除非显式 `scope=all`，且 >600 KB 的文件只按文件名命中） |

### 双布局与双标记

```
memory_init
   ├─ 写 .longterm-memory.json  ┐ 两个标记里都记录「真实布局」，识别结果一致
   ├─ 写 .dsh-longterm.json     ┘
   └─ 建 T1-T4（cc 命名，或 --layout dsh 用 DSH 命名）

detectLayout(root)
   1. 读标记文件里的 layout 字段（以内容为准，不看哪个文件先存在）
   2. 没有标记 → 看根目录 T1-* 的目录名
   3. 都没有 → 默认 cc
```

为什么不一刀切：DSH 插件先落地用的是带「文件夹」后缀的命名，Claude Code 侧沿用短名。
两边都要能读同一份记忆，所以做识别，而不是逼用户迁移数据。

## 记忆库结构

```
<项目根>/
├─ .longterm-memory.json                     # 长期项目标记（Claude Code 侧命名）
├─ .dsh-longterm.json                        # 长期项目标记（DSH 侧命名）
├─ T1-交接/
│  ├─ 项目进度交接.md                         # 当前状态 / 下一步 / 关键约束（≤200 行）
│  ├─ 当前活跃问题.md                         # 进行中 / 已解决待验证 / 阻塞
│  └─ 交接文档/
│     ├─ 项目结构.md                          # init/adopt 时自动扫描生成
│     ├─ 用户习惯.md
│     ├─ 用户强调.md
│     └─ AI经常踩的坑.md                      # 现象 → 根因 → 硬规则（价值最高）
├─ T2-全日志/
│  └─ 第42周-2026年10月12日→2026年10月18日.md  # 一周一文件，AI 不主动读
├─ T3-分类整理/
│  ├─ 修复bug/游戏机制/NPC相关问题/NPC穿模.md   # 同一问题续写同一文件
│  ├─ 新功能/登录模块/扫码登录.md
│  ├─ 疑问咨询/
│  └─ 回顾重构/
└─ T4-项目/                                   # 代码或资源；记忆工具只列不读
```

> Windows 文件名里 `->` 会被替换成 `→`（`>` 是非法字符），所以 T2 周文件名是箭头。

## 仓库结构

```
dsh-longterm-memory/
├─ index.js  client.js  cordis.patch.yml      # 形态 1：DSH 插件（Host 工具 + Client 面板）
├─ locale/{zh,en}.json  icon.svg              # 插件卡片元数据与图标
├─ ports/                                     # 形态 2-4、6：多宿主适配
│  ├─ core/{fsutil,search,engine,index}.mjs    #   ★ 唯一一份记忆引擎（零依赖）
│  ├─ cli/ltm.mjs                              #   命令行（Hermes 插件也调它）
│  ├─ mcp/server.mjs                           #   通用 MCP 服务器（13 工具，含别名）
│  ├─ claude-code/                             #   插件包：.claude-plugin + .mcp.json + commands + hooks
│  ├─ codex/                                   #   config.toml 片段 + AGENTS.md 片段 + prompts
│  └─ hermes/                                  #   原生 Python 插件（plugin.yaml + __init__.py + tools.py）
├─ skills/longterm-memory/                    # 形态 5：跨宿主技能（SKILL.md + references + 自带 CLI）
├─ docs/                                       # ARCHITECTURE / COMPATIBILITY / market-entry
├─ tests/                                      # 37 项测试（引擎、端口、技能、清单一致性、Python 自检）
├─ scripts/                                    # 打包与发布脚本（pack-ports / pack-skills / finish-publish）
├─ optional/codex-ui-patch/                    # 可选：第三方 Codex UI 的菜单注入（legacy）
└─ .github/workflows/                          # CI（Node 20/22/24）与发布（npm + Release）
```

## 配置

DSH 插件在 `cordis.patch.yml` 的 `config` 下（或用设置页 / `plugin_manager` 改）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `rootDir` | `.` | 记忆根目录，相对会话工作区 |
| `maxReadChars` | `12000` | 单次读取返回的最大字符数 |
| `maxSearchFiles` / `maxSearchLines` | `12` / `3` | 检索返回的文件数与每文件行数上限 |
| `markerFile` | `.dsh-longterm.json` | 标记文件名（可与项目自带文件避开重名） |

CLI / 技能侧用环境变量：

| 变量 | 作用 |
| --- | --- |
| `LTM_PROJECT_ROOT` | 钉住记忆根目录（会话 cwd 不在项目里时有用） |
| `LTM_CLI` / `LTM_CORE` / `LTM_NODE` | Hermes 插件与钩子定位 CLI / core / node |
| `HERMES_HOME` | Hermes 数据目录（Windows 默认 `%LOCALAPPDATA%\hermes`） |

> Loader 的 override 语义是**整体替换** `config`：覆盖时请写全字段。

## 兼容性

| 宿主 | 版本 | 状态 |
| --- | --- | --- |
| DSH | `>=0.1.7`（实测 `0.2.0-rc.2`） | ✅ 插件本体、设置页、会话菜单、RPC 通道 |
| Claude Code | 插件规范（`.claude-plugin/plugin.json` + `.mcp.json` + commands + hooks + skills） | ✅ 端口就绪，钩子与 MCP 已实测 |
| Codex | `[mcp_servers]` + `AGENTS.md` + `prompts/` | ✅ 片段与提示就绪 |
| Hermes Agent | `0.21.4` 实测 | ✅ 插件 `enabled`；技能 `enabled` |
| Node | `>=20`（实测 24） | ✅ 全部形态 |
| Python（仅 Hermes 插件侧） | `>=3.9`（实测 3.9.6） | ✅ 自检通过 |

细节（服务/Slot 依赖、工具名对照、与 Claude 侧同名技能的差异）见
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)；架构与数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 常见问题

**会不会把上下文烧掉？**
不会。常驻的只有 T1（建议 ≤200 行）+ 约 4 行使用约定；T2/T3 只在检索命中时读片段。

**关掉开关会丢数据吗？**
不会。开关只写标记文件，T1-T4 原样保留；卸载插件也不动数据。

**模型会不会编造历史修复记录？**
SKILL.md 与 AGENTS.md 片段里都写了硬规则：**搜不到就说没有**，禁止编造。
这是设计上最看重的一条纪律。

**同一个问题又出现了，新建文件还是续写？**
续写同一个文件 —— 工具会自动编「第 N 条记录」。

**多个项目共用一套记忆？**
每个项目根各自一份，天然隔离。跨项目检索不支持（也不建议，那是幻觉来源）。

**能放进 Git 吗？**
能。建议 T1/T3 入库，T2 视体积与隐私决定；两个标记文件可以忽略。

**中文检索为什么不用向量？**
要的是可预测、零依赖、零联网。BM25 + 中文单字/双字索引已经能覆盖口语检索；
换词命中不到的正确解法是写入时把用户原话记进 `tags`。

更多问题（分类拿不准、Windows 文件名、记忆根位置、退出清理…）见
[skills/longterm-memory/references/faq.md](skills/longterm-memory/references/faq.md)。

## 开发、测试与发布

```bash
# 测试：引擎 + 端口 + 技能 + 清单一致性（无需安装任何依赖）
node --test "tests/*.test.mjs"          # 37 项
python tests/hermes-selfcheck.py        # Hermes 插件自检（Python ≥3.9）

# 直接用 CLI 验证
node ports/cli/ltm.mjs init  /tmp/demo
node ports/cli/ltm.mjs brief --root /tmp/demo
node ports/cli/ltm.mjs doctor --root /tmp/demo

# 打包（Node ≥20；Windows 用 PowerShell）
npm pack                                            # -> dsh-longterm-memory-<ver>.tgz
powershell -File scripts/pack-ports.ps1             # -> dist/ 四个宿主包 + zip
powershell -File scripts/pack-skills.ps1            # -> dist/ 技能包 + zip

# 发布：建仓库 → 推 main+tag → 发 Release（带全部资产）→ 可选 npm publish
powershell -File scripts/finish-publish.ps1
```

打包脚本自带语法检查与**打包后冒烟测试**（真跑一遍 `init → write → search → doctor`），
缺文件就直接构建失败 —— 防止打出装不上/跑不动的包。

## 贡献

欢迎 PR：新增宿主适配、改进检索、补文档与测试。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

几条项目约束（评审会看）：

1. **记忆逻辑只有一份**（`ports/core/`）。新宿主适配请走 CLI 或 MCP，不要复制检索实现。
2. **零第三方依赖**（Node 侧）。能用标准库就不要加包。
3. **测试随改动来**：新增工具/参数要有对应断言。
4. **CLI 与 SKILL.md 的说明要同步**：模型看到的就是这两处。

## License

[MIT](LICENSE) © 2026 aboretheall
