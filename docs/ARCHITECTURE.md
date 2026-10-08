# 架构 / Architecture

## 0. 一个引擎，六种形态

```
                        ┌──────────────────── ports/core（唯一实现，零依赖） ────────────────────┐
                        │  fsutil.mjs  布局识别 / 文件工具 / markdown 分块 / 路径净化            │
                        │  search.mjs  BM25 + 中文单字·双字·三字索引 + 噪声抑制                  │
                        │  engine.mjs  骨架 / 简报 / 索引 / 检索 / 切片 / 写入 / 日志 / 自检     │
                        └───────────────┬───────────────────────────┬───────────────────────────┘
                                        │                           │
             ┌──────────────────────────┴─────────┐     ┌───────────┴──────────────────────────┐
             │ ports/cli/ltm.mjs（CLI）           │     │ ports/mcp/server.mjs（stdio MCP）     │
             └───┬──────────────┬─────────────────┘     └───┬───────────┬──────────┬───────────┘
                 │              │                           │           │          │
        ┌────────┴───────┐ ┌────┴──────────────┐   ┌────────┴─────┐ ┌───┴──────┐ ┌─┴────────────┐
        │ Hermes 原生插件│ │ 技能 skills/…      │   │ Claude Code  │ │  Codex   │ │ 任意 MCP 客户端│
        │ (subprocess)   │ │ (自带 CLI 副本)    │   │ 插件包       │ │ config   │ │ (Cursor…)    │
        └────────────────┘ └───────────────────┘   └──────────────┘ └──────────┘ └──────────────┘
                                        │
                       DSH 插件（仓库根 index.js / client.js）走 Cordis 服务，
                       工具面与 MCP 一致，另加设置页 / 会话菜单 / 系统提示片段
```

**契约**：`ports/core/` 之上的一切（CLI、MCP、技能、各宿主适配）都只做"怎么把能力交给模型"，
不复刻记忆逻辑。这条契约有测试守卫（`tests/ports.test.mjs`、`tests/skills.test.mjs`）。

**为什么值得**：同一项目在四个宿主里读写的必须是同一份 T1-T4；一旦某个宿主自己实现一套检索，
用户会遇到「Claude 命中了、Hermes 没命中」这种无法解释的差异。

## 1. DSH 插件：数据流

```
                       ┌──────────────────────────── Client 半 (web) ───────────────────────────┐
   会话 ⋯ 菜单 ───────►│ sidebar.workspaces.session.menu.item  → memory.adopt { sessionId }     │
   会话头部按钮 ──────►│ conversation.session.header.utilities → memory.adopt { sessionId }     │
   设置页 ────────────►│ settings.section → memory.status / memory.init / memory.setLongTerm     │
                       └───────────────────────────────┬────────────────────────────────────────┘
                                                       │ ctx.connection.rpc.call('/dsh-longterm-memory', endpoint, payload)
                                                       ▼  POST /dsh-longterm-memory/<endpoint>  (JSON wire)
                       ┌──────────────────────────────── Host 半 (index.js) ─────────────────────┐
                       │ rpcHttpBridge  → 鉴权(connection.requestRejection) → 尺寸/类型校验 →   │
                       │ rpcHandler     → memoryStatus / adoptProject / setLongTerm / init      │
                       │                                                        │              │
                       │ 6 个模型工具: memory_init/handoff/read/write/search/list ┤              │
                       │ 系统提示片段: 仅在标记存在时返回 MEMORY_GUIDE           │              │
                       └────────────────────────────────────────────────────────┼───────────────┘
                                                                                ▼
                                            <项目根>/T1-交接文件夹、T2-全日志记录文件夹、
                                                     T3-日志分级整理文件夹、T4-项目目录文件夹
                                                     + .dsh-longterm.json
```

## 职责划分

### Host 半（`index.js`）

| 关注点 | 实现 |
| --- | --- |
| 模型工具 | `ctx.tools.register` 注册 6 个工具；参数用 JSON Schema 描述，返回值统一 `{ type: 'text' }` |
| 路径安全 | `normalizeSubPath` 拒绝绝对路径与 `..` 越界，之后交给 `ctx.fs.resolve(rootDir/rel, { cwd })` |
| 沙箱 | `sandbox(exec)` 取 `ctx.get('sandboxPolicy')`；取不到时退回会话工作区 cwd |
| 读盘策略 | T1/T3 走 `ctx.fs`；标记文件与骨架创建走 `node:fs`（Host 进程内，非模型可见路径） |
| 系统提示 | `ctx.systemPrompt.section`，`order: 300`；未标记项目返回 `''` → 零 token |
| Client 通道 | `ctx.webServer.register({ kind: 'prefix' })` + `rpcHttpBridge` 复刻 Connection 的 wire 协议 |
| 生命周期 | 通道注册包在 `ctx.effect` 里，返回 disposer，插件卸载即注销路由 |

**RPC wire 协议**（与 `connection` 的 `/api` 一致）：

```
→ POST /dsh-longterm-memory/<endpoint>
  { "type": "client-request", "rpcId": "...", "method": "<endpoint>", "payload": { ... } }
← 200 { "type": "server-response", "rpcId": "...", "result": { "ok": true, "value": { ... } } }
   或 { ..., "result": { "ok": false, "error": { "code": "bad-request", "message": "..." } } }
```

拒绝路径：非 POST → 404；endpoint 段含 `/`、`.`、`..` 或非法字符 → 404；`content-type` 非 JSON → 415；
body 非 JSON → 400；body > 4 MiB → 413；`method ≠ endpoint` → `bad-request`；`requestRejection` 返回码 → 401/403。

### Client 半（`client.js`）

- 通过 `window.__ModuleLoader__.load({ id: 'dsh-longterm-memory' })` 注册 —— **`id` 必须等于包名**。
- `inject: ['slots', 'connection']`；locale 走 `ctx.get('locale')` **可选**获取（拿不到就用内置中文文案）。
- 只注册三个 Slot，全部是 `list` 型；缺失的 Slot 只会让对应入口消失。
- 样式只用主题 token（`--dsw-alias-*`），因此亮/暗色主题都跟随宿主；不 import 任何 `@deepseek-ai/dsh-client-*`。

## 数据流：一次「设为长期项目」

```
Client: rpcCall('memory.adopt', { sessionId })
  → rpcHttpBridge 校验
  → rpcHandler('memory.adopt')
  → adoptProject: sessionId → sessions.get(id).header.cwd
      ├─ ensureSkeletonAt(cwd)      建 T1-T4 骨架（存在即跳过）
      ├─ scanStructure(cwd)         扫描 3 层目录 → T1/交接文档文件夹/项目结构.md
      └─ writeLongTermAt(cwd, true) 写 .dsh-longterm.json
  → memoryStatusAt(cwd) 返回 { rootDir, longTerm, initialized, tree }
  → Client 更新设置页 / 弹出 toast
```

## 一次典型会话的时序

```
session start → memory_handoff        # 只读 T1 两个文件
before edit   → memory_search "用户原话"  # 只读 T1+T3 的命中片段
on hit        → memory_read "T3-.../x.md"  # 只读一个文件
session end   → memory_write → T3 (追加第 N 次记录)
              → memory_write → T1/项目进度交接.md
```

## 扩展点

- 想加一层（例如 T5-决策记录）：在 `SKELETON` 与 `MEMORY_DIRS` 同时加，并决定它是否参与 `memory_search` 的 scope。
- 想换检索算法：`memory_search` 内部只依赖 `walkMd` + `firstMatchingLines`，替换这两处即可。
- 想加设置项：在 `cordis.patch.yml` 的 `config` 加默认值 → 在 `apply` 里读 → 在 README 配置表登记。

## 已知取舍

- 检索是**确定性关键词匹配**（大小写不敏感、多词 OR），不是向量检索：可预测、零依赖、零网络。
- 超过 600 KB 的 `.md` 不读全文，只按文件名命中——避免把 T2 周日志拖进上下文。
- 标记文件读写走 `node:fs`，因此**不受 DSH 沙箱策略约束**；它只会写工作区内的项目根。
