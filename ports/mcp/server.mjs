#!/usr/bin/env node
// ports/mcp/server.mjs — 通用 MCP 服务器（stdio，换行分隔 JSON-RPC）
//
// 三个宿主都能直接用它：
//   Claude Code  .mcp.json             -> "${CLAUDE_PLUGIN_ROOT}/../mcp/server.mjs"
//   Codex        ~/.codex/config.toml  -> [mcp_servers.longterm_memory]
//   Hermes       ~/.hermes/config.yaml -> mcp_servers.longterm_memory
// 任意 MCP 客户端同理。stdout 只出现 JSON，日志一律走 stderr。

import readline from 'node:readline';
import path from 'node:path';
import process from 'node:process';

import {
  adoptProject,
  brief,
  doctor,
  findRoot,
  guideText,
  indexOutline,
  initProject,
  logSession,
  search,
  slice,
  status,
  writeMemory,
} from '../core/index.mjs';

const SERVER_INFO = { name: 'longterm-memory', version: '2.0.0' };
const DEFAULT_PROTOCOL = '2024-11-05';

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const OBJ = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const ROOT_PARAM = S('string', '项目根目录（默认从 cwd 向上自动查找 T1-* 或标记文件）');

// 工具表：主名沿用 Claude Code 插件 v1.0.0（memory_brief/index/slice/log…），
// 同时保留 DSH 插件的名字作为别名（memory_handoff/read/list/status），
// 这样同一台机器上几套宿主用的是同一份记忆、同一套叫法。
const TOOL_DEFS = [
  {
    name: 'memory_init',
    description: '在项目根创建 T1-T4 记忆骨架（幂等，不覆盖已有文件），并写入长期项目标记。首次接入长期项目时调用。',
    inputSchema: OBJ({ project_root: ROOT_PARAM, layout: S('string', '目录命名：cc（默认）或 dsh'), markers: S('string', '标记文件：both（默认）/cc/dsh') }),
    run: (args) => initProject(args.project_root || rootFor(args), { layout: args.layout, markers: args.markers }),
    format: (r) => `骨架已就绪（根：${r.root}，布局：${r.layout}）\n新建 ${r.created.length} 个，跳过 ${r.skipped.length} 个\n标记：${r.markers.join(', ')}`,
  },
  {
    name: 'memory_adopt',
    description: '把一个已有项目「收养」为长期项目：建骨架、扫描目录生成项目结构草稿、写标记。',
    inputSchema: OBJ({ project_root: ROOT_PARAM, layout: S('string', '目录命名：cc（默认）或 dsh') }),
    run: (args) => adoptProject(args.project_root || rootFor(args), { layout: args.layout }),
    format: (r) => `已收养：${r.root}（布局：${r.layout}）\n骨架新建 ${r.created.length} 个；项目结构草稿：${r.structure}`,
  },
  {
    name: 'memory_brief',
    description: '会话冷启动：返回 T1 交接层（进度交接 / 当前活跃问题 / 用户强调 / AI 经常踩的坑），受预算截断。新会话开头调用一次。',
    inputSchema: OBJ({ project_root: ROOT_PARAM, budget: S('number', '总字符预算，默认 12000') }),
    run: (args) => brief(rootFor(args), { budget: args.budget }),
  },
  {
    name: 'memory_index',
    description: '只返回记忆的文件清单与标题大纲（不含正文），用极低成本知道「有什么记忆」，再决定是否深入。',
    inputSchema: OBJ({ project_root: ROOT_PARAM, scope: S('string', 'T1/T2/T3/T4/hot/all，默认 T3') }),
    run: (args) => indexOutline(rootFor(args), { scope: args.scope || 'T3' }),
  },
  {
    name: 'memory_search',
    description: '在记忆里做 BM25 检索（中文按单字+双字索引，口语也能命中），返回命中的章节片段而非整文件。修 bug / 做新功能前先调用。',
    inputSchema: OBJ(
      {
        query: S('string', '检索关键词，可直接用用户的原话'),
        project_root: ROOT_PARAM,
        scope: S('string', 'hot（默认，T1+T3）/ all（含 T2）/ T1 / T2 / T3 / T4'),
        limit: S('number', '最多返回多少节，默认 8'),
        excerpt_chars: S('number', '每节摘录字符数，默认 700'),
      },
      ['query'],
    ),
    run: (args) => {
      if (!args.query) throw new Error('query 不能为空');
      return search(rootFor(args), args.query, { scope: args.scope || 'hot', limit: args.limit, excerpt_chars: args.excerpt_chars });
    },
  },
  {
    name: 'memory_slice',
    description: '按标题或行号从一个大文件里精确取一段，避免整文件读入上下文。',
    inputSchema: OBJ({ file: S('string', '记忆根目录内的相对路径'), heading: S('string', '标题（支持部分匹配）'), lines: S('string', '行范围，如 12-40'), project_root: ROOT_PARAM, max_chars: S('number', '最大字符数，默认 12000') }, ['file']),
    run: (args) => slice(rootFor(args), { file: args.file, heading: args.heading, lines: args.lines, max_chars: args.max_chars }),
  },
  {
    name: 'memory_write',
    description: '把结论写回 T3（结构化知识库）。同一问题反复出现时续写同一个文件（自动编「第 N 条记录」），不要新建文件。',
    inputSchema: OBJ({
      content: S('string', '记录正文，建议含：现象 / 根因 / 改了什么 / 怎么验证 / 遗留风险'),
      title: S('string', '问题点标题（会变成文件名）'),
      category: S('string', '分类，如 "修复bug/游戏机制/NPC相关问题"；大类只取 修复bug / 新功能 / 疑问咨询 / 回顾重构'),
      file: S('string', '直接指定相对路径，优先级高于 title'),
      tags: S('array', '关键词数组（用户的原话也写进来，便于日后命中）', { items: { type: 'string' } }),
      project_root: ROOT_PARAM,
    }, ['content']),
    run: (args) => writeMemory(rootFor(args), { title: args.title, category: args.category, path: args.file, content: args.content, tags: args.tags }),
  },
  {
    name: 'memory_log',
    description: '把本轮原始记录追加到 T2 周文件（自动带周号、日期、轮次、时间戳）。人类回溯用，AI 不主动读。',
    inputSchema: OBJ({ content: S('string', '本轮原始记录') , project_root: ROOT_PARAM }, ['content']),
    run: (args) => logSession(rootFor(args), { content: args.content }),
  },
  {
    name: 'memory_status',
    description: '返回项目记忆状态：根目录、布局、标记文件、四层文件数。',
    inputSchema: OBJ({ project_root: ROOT_PARAM }),
    run: (args) => JSON.stringify(status(rootFor(args)), null, 2),
  },
  {
    name: 'memory_doctor',
    description: '自检：检查四层目录是否齐全、简报是否在预算内，给出「可用 / 需要先 init」的结论。',
    inputSchema: OBJ({ project_root: ROOT_PARAM }),
    run: (args) => doctor(rootFor(args)),
  },
  {
    name: 'memory_guide',
    description: '返回本插件的使用约定（可直接写进 AGENTS.md / CLAUDE.md）。',
    inputSchema: OBJ({}),
    run: () => guideText(),
  },
];

// DSH 插件的叫法作为别名，指向同一实现
const ALIASES = [
  { name: 'memory_handoff', target: 'memory_brief', description: 'memory_brief 的别名（DSH 插件的叫法）' },
  { name: 'memory_read', target: 'memory_slice', description: 'memory_slice 的别名（DSH 插件的叫法）', mapArgs: (a) => ({ ...a, file: a.path || a.file }) },
  { name: 'memory_list', target: 'memory_index', description: 'memory_index 的别名（DSH 插件的叫法）' },
];

function rootFor(args) {
  return findRoot(process.cwd(), args && args.project_root);
}

function findTool(name) {
  const direct = TOOL_DEFS.find((t) => t.name === name);
  if (direct) return direct;
  const alias = ALIASES.find((a) => a.name === name);
  if (!alias) return null;
  const target = TOOL_DEFS.find((t) => t.name === alias.target);
  return { ...target, name: alias.name, mapArgs: alias.mapArgs };
}

function toolsList() {
  const list = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  for (const a of ALIASES) {
    const target = TOOL_DEFS.find((t) => t.name === a.target);
    list.push({ name: a.name, description: a.description, inputSchema: target.inputSchema });
  }
  return list;
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function log(...parts) {
  process.stderr.write('[longterm-memory-mcp] ' + parts.join(' ') + '\n');
}
function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL;
      ok(id, { protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
      return;
    }
    case 'notifications/initialized':
    case 'initialized':
      return;
    case 'ping':
      ok(id, {});
      return;
    case 'tools/list':
      ok(id, { tools: toolsList() });
      return;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) {
        fail(id, -32602, 'tools/call 缺少 name');
        return;
      }
      const tool = findTool(name);
      if (!tool) {
        fail(id, -32602, `未知工具: ${name}`);
        return;
      }
      try {
        const value = await tool.run(tool.mapArgs ? tool.mapArgs(args) : args);
        const text = tool.format ? tool.format(value) : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        ok(id, { content: [{ type: 'text', text: String(text) }] });
      } catch (err) {
        ok(id, {
          content: [{ type: 'text', text: `[${name}] 失败: ${err && err.message ? err.message : String(err)}` }],
          isError: true,
        });
      }
      return;
    }
    case 'resources/list':
      ok(id, { resources: [] });
      return;
    case 'prompts/list':
      ok(id, { prompts: [] });
      return;
    default:
      if (!isNotification) fail(id, -32601, `未实现的方法: ${method}`);
  }
}

export function startServer({ cwd } = {}) {
  if (cwd) process.chdir(path.resolve(cwd));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log('忽略非 JSON 输入行');
      return;
    }
    handle(msg).catch((err) => log('处理异常:', err && err.stack ? err.stack : String(err)));
  });
  rl.on('close', () => process.exit(0));
  process.on('uncaughtException', (err) => log('uncaughtException:', err && err.stack ? err.stack : String(err)));
  process.on('unhandledRejection', (err) => log('unhandledRejection:', err && err.stack ? err.stack : String(err)));
  log(`已启动 v${SERVER_INFO.version}，暴露 ${toolsList().length} 个工具`);
  return rl;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('ports/mcp/server.mjs');
if (invokedDirectly) startServer();
