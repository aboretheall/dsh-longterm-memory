# 兼容性 / Compatibility

## 0. 形态 × 宿主矩阵

| 形态 \ 宿主 | DSH | Claude Code | Codex | Hermes | 任意 MCP 客户端 | 任意 Agent Skills 宿主 |
| --- | --- | --- | --- | --- | --- | --- |
| DSH 插件（`/`） | ✅ 原生 | — | — | — | — | — |
| Claude Code 插件包（`ports/claude-code/`） | — | ✅ | — | — | — | — |
| MCP 服务器（`ports/mcp/`） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（若宿主支持 MCP） |
| 技能（`skills/longterm-memory/`） | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| CLI（`ports/cli/`） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

记忆数据（T1-T4 与两个标记）在四种宿主之间**完全共享**，切换宿主不需要迁移。

## 1. 宿主版本矩阵

| DSH 版本 | 状态 | 说明 |
| --- | --- | --- |
| `0.2.0-rc.2` | ✅ 实测通过 | 桌面端（Node 24.21）与 Web 端均已验证：6 个工具、系统提示注入、三个 Slot、RPC 通道 |
| `0.1.7-rc.*` | ✅ 预期可用 | 本插件在该系列上开发并使用；所用 API 均非实验性 |
| `>= 0.1.7` | ✅ 声明范围 | `package.json` → `dsh.engines.dsh` |
| `< 0.1.7` | ⚠️ 未声明 | 早期 Loader 的 `dsh.bundle.patch` 行格式与 Slot 名可能不同，不保证 |

运行时要求：

- **Node** `>= 20`（`engines.node`）。只用 `node:path`、`node:fs`、`node:fs/promises` 与标准 ESM。
- **平台**：Windows / macOS / Linux 均可；路径处理统一走 `ctx.fs`，记忆目录名含中文，需要文件系统支持 UTF-8。

## 2. Host 服务依赖

`index.js` 顶部声明：

```js
export const inject = ['tools', 'fs', 'systemPrompt', 'webServer', 'connection'];
```

| 服务 | 是否必需 | 用途 | 缺失后果 |
| --- | --- | --- | --- |
| `tools` | 必需 | 注册 6 个模型工具 | 插件无法提供能力 |
| `fs` | 必需 | `resolve` / `stat` / `readText` / `writeText` / `listDir` | 所有工具失效 |
| `systemPrompt` | 必需 | 注入「长期项目记忆」片段（`order: 300`） | 无自动交接引导 |
| `webServer` | 必需 | 挂载 `/dsh-longterm-memory` RPC 前缀路由 | 设置页与菜单项失效，工具仍可用 |
| `connection` | 必需 | 用 `requestRejection` 给 RPC 通道做同源鉴权 | 同上 |
| `sandboxPolicy` | 可选 | `ctx.get('sandboxPolicy')` 决定写入策略；取不到则退回会话 cwd | 走默认策略，无影响 |
| `sessions` | 可选 | 从 `sessionId` 反查项目路径（`memory.adopt`） | 只能传显式 `path` |

工具执行上下文（`exec`）用到的字段：`exec.agent.session.header.cwd`、`exec.signal`。

## 3. Client Slot 依赖

| Slot | kind | scope | 注册项 id | 作用 |
| --- | --- | --- | --- | --- |
| `settings.section` | list | root | `dsh-longterm-memory` | 设置页：开关、手动初始化、记忆目录树 |
| `conversation.session.header.utilities` | list | session | `dsh-longterm-memory.adopt` | 会话头部「📁 设为长期项目」 |
| `sidebar.workspaces.session.menu.item` | list | root | `dsh-longterm-memory.adopt` | 会话 `⋯` 菜单项（`order: 450`，排在宿主 `archive`(400) 之后） |

- id 一律带包命名空间前缀：Slot 目录规定「新 id 会作为新单元格加入，复用宿主 id 会**替换**那一行」，
  加前缀可避免与其他插件的条目互抢。
- 三者都是 `list` 型追加位，不会覆盖宿主 UI（`replaceRisk: none`）。
- 宿主缺某个 Slot 时，`ctx.slots.inject` 不触发，只有对应入口消失；**工具与系统提示不受影响**。
- Client 半不 import 任何 `@deepseek-ai/dsh-client-*` 包，只使用注入的 React 与 `ctx.connection` / `ctx.slots` / 可选 `ctx.get('locale')`。
- `sidebar.workspaces.session.menu.item` 的 owner props 为 `{ sessionId, displayTitle }`，并注入 `useMenuOpenState` hook；
  本插件只用 `sessionId`，hook 缺失时退化为不主动关闭菜单（不影响点击行为）。

## 4. 与本项目同名的 Claude 侧技能

社区里流传的 `longterm-memory` **技能**（SKILL.md 形式）描述的是一套更粗的工具名。两者思路一致
（T1-T4、检索优先、不读 T2 全文），但**工具名不同**，对照如下：

| `longterm-memory` 技能 | 本插件工具 | 差异 |
| --- | --- | --- |
| `memory_brief` | `memory_handoff` | 语义相同：会话开头读一次 |
| `memory_init` | `memory_init` | 同名 |
| `memory_search` | `memory_search` | 插件版多了 `scope`（hot/all/T1/T2/T3） |
| `memory_slice`（按标题/行号取一段） | `memory_read`（整文件 + 截断） | 插件版按文件读，超出 `maxReadChars` 截断 |
| `memory_write`（结构化写入 + 自动去重） | `memory_write`（overwrite/append） | 插件版不做自动去重，靠「同一问题写同一文件 + append」约定 |
| `memory_log`（追加到 T2 周文件） | `memory_write` 到 `T2-全日志记录文件夹/…` | 插件版不自动生成周文件名 |
| `memory_index`（只列目录不含正文） | `memory_list` | 插件版可指定 `level` 与 `maxDepth` |

如果你的技能文档里写的是左列工具名，请在技能里补充一句「本机实际工具名为右列」，或直接把技能里的
调用改成右列——否则模型会去调不存在的工具。

## 5. 与历史私有版本并存

| 版本 | 装载 id | 说明 |
| --- | --- | --- |
| `@local/dsh-longterm-memory`（0.1.x，私有 link） | `@local/dsh-longterm-memory` | 本机旧版 |
| `dsh-longterm-memory`（0.2.0+，本仓库） | `dsh-longterm-memory` | 开源版 |

**不要同时启用**：两者功能等价，同时挂载会在会话菜单与设置页各出现一套入口。迁移方式：

```bash
# 旧
dsh plugin --profile <profile> remove @local/dsh-longterm-memory
# 新
dsh plugin --profile <profile> add dsh-longterm-memory
```

记忆数据（T1-T4 目录与 `.dsh-longterm.json`）与包名无关，无需迁移。

## 6. 可选：Codex UI 菜单补丁（legacy）

`optional/codex-ui-patch/` 里保留了给 `@michengai/dsh-codex-ui` 用的菜单注入脚本。它**不是本插件的
组成部分**：标准 DSH 不需要它，装的是第三方 Codex UI 且希望在其项目菜单里也出现「设为长期项目」时才用。
第三方包更新后该补丁会被覆盖，重跑脚本即可（脚本本身幂等）。

## 7. 版本支持策略

- **patch**：随时发，无需注意。
- **minor**：可能新增工具、配置键、Slot；已有工具的参数与返回文本保持兼容。
- **major**：仅在工具名、参数或记忆目录结构变更时发布，并在 `CHANGELOG.md` 给出迁移说明。

遇到兼容问题请附上：DSH 版本、操作系统、`dsh --profile <profile> --dump-config` 的相关行，
以及 `settings.section` 或 `⋯` 菜单的报错文本。
