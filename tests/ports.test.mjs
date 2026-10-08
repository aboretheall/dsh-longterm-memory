// tests/ports.test.mjs — 三宿主端口的行为测试
//
//   node --test "tests/*.test.mjs"
//
// 覆盖：核心引擎（骨架/写入去重/检索/切片/越界拒绝）、CLI、MCP 握手与 tools/call、
// 以及三个宿主的安装清单（Claude Code plugin.json、Codex config 片段、Hermes plugin.yaml）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = join(ROOT, 'ports');

// Windows 上绝对路径必须转成 file:// URL 才能 dynamic import
const engine = await import(pathToFileURL(join(PORTS, 'core', 'index.mjs')).href);

async function tempProject() {
  return mkdtemp(join(tmpdir(), 'ltm-ports-'));
}

test('initProject 建骨架并同时写两种标记，dsh 布局也支持', async () => {
  const dir = await tempProject();
  try {
    const cc = engine.initProject(dir, { layout: 'cc' });
    assert.equal(cc.layout, 'cc');
    assert.equal(cc.created.length, 9);
    assert.deepEqual(cc.markers, ['.longterm-memory.json', '.dsh-longterm.json']);
    await stat(join(dir, 'T1-交接', '当前活跃问题.md'));

    const dshDir = await tempProject();
    const dsh = engine.initProject(dshDir, { layout: 'dsh' });
    assert.equal(dsh.layout, 'dsh');
    await stat(join(dshDir, 'T1-交接文件夹', '交接文档文件夹', '项目结构.md'));
    // 已存在的 DSH 项目必须被识别为 dsh 布局，端口不会另开一套目录
    assert.equal(engine.detectLayout(dshDir).id, 'dsh');
    await rm(dshDir, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeMemory 首次创建、再次追加为「第 N 条记录」', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    const first = engine.writeMemory(dir, { title: 'NPC穿模', category: '修复bug/游戏机制/NPC相关问题', content: '现象：穿模' });
    assert.match(first, /创建 .*第 1 条记录/);
    const second = engine.writeMemory(dir, { title: 'NPC穿模', category: '修复bug/游戏机制/NPC相关问题', content: '第二次：同样的碰撞层' });
    assert.match(second, /追加 .*第 2 条记录/);
    const raw = await readFile(join(dir, 'T3-分类整理', '修复bug', '游戏机制', 'NPC相关问题', 'NPC穿模.md'), 'utf8');
    assert.match(raw, /第 1 条记录/);
    assert.match(raw, /第 2 条记录/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search 中文口语命中（标题与正文都能召回）', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    engine.writeMemory(dir, { title: '暴击溢出', category: '修复bug/数值', content: '暴击伤害超过 32767 后变成负数，敌人回血' });
    const hit = engine.search(dir, '敌人回血');
    assert.match(hit, /暴击溢出/);
    const miss = engine.search(dir, '完全不存在的词汇xyz');
    assert.match(miss, /未找到/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('slice 支持标题与行范围，越界路径被拒绝', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    engine.writeMemory(dir, { title: '多节文档', category: '其他', content: '第一节正文' });
    const byHeading = engine.slice(dir, { file: 'T3-分类整理/其他/多节文档.md', heading: '第 1 条记录' });
    assert.match(byHeading, /第一节正文/);
    const byLines = engine.slice(dir, { file: 'T3-分类整理/其他/多节文档.md', lines: '1-3' });
    assert.match(byLines, /行 1-3/);
    assert.throws(() => engine.slice(dir, { file: '../../etc/passwd' }), /越出记忆根目录|绝对路径/);
    assert.throws(() => engine.slice(dir, { file: 'C:/windows/win.ini' }), /绝对路径/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('logSession 落到 T2 周文件并递增轮次', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    const a = engine.logSession(dir, { content: '第一轮' });
    const b = engine.logSession(dir, { content: '第二轮' });
    assert.match(a, /轮次 1/);
    assert.match(b, /轮次 2/);
    assert.match(a, /T2-全日志/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('brief 受预算截断，guideText 给出使用约定', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    const text = engine.brief(dir, { budget: 120 });
    assert.ok(text.length <= 400, '简报必须受预算约束');
    assert.match(engine.guideText(), /memory_brief/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function runCli(args, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PORTS, 'cli', 'ltm.mjs'), ...args], { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('CLI: init / write / search / doctor 全链路', async () => {
  const dir = await tempProject();
  try {
    const init = await runCli(['init', dir]);
    assert.equal(init.code, 0);
    assert.match(init.out, /骨架已就绪/);

    const write = await runCli(['write', '--root', dir, '--title', '登录超时', '--category', '修复bug/登录', '--content', '现象：Token 过期后不跳登录页']);
    assert.match(write.out, /创建 .*登录超时\.md/);

    const search = await runCli(['search', '登录页', '--root', dir]);
    assert.match(search.out, /修复bug\/登录\/登录超时\.md/);

    const doctor = await runCli(['doctor', '--root', dir]);
    assert.match(doctor.out, /结论: 可用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MCP 握手（三个宿主共用的传输层）
// ---------------------------------------------------------------------------
function mcpSession(messages, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(PORTS, 'mcp', 'server.mjs')], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => resolve({ out, err }));
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    child.stdin.end();
  });
}

test('MCP: initialize / tools/list / tools/call（含别名与错误处理）', async () => {
  const dir = await tempProject();
  try {
    engine.initProject(dir, {});
    const { out } = await mcpSession(
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_brief', arguments: { project_root: dir } } },
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory_handoff', arguments: { project_root: dir } } },
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_search', arguments: { project_root: dir, query: '不存在的xyz' } } },
        { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'memory_nope', arguments: {} } },
        { jsonrpc: '2.0', id: 7, method: 'memory_slice', params: {} },
      ],
      dir,
    );
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    const byId = new Map(lines.map((m) => [m.id, m]));

    assert.equal(byId.get(1).result.serverInfo.name, 'longterm-memory');
    const tools = byId.get(2).result.tools.map((t) => t.name);
    for (const name of ['memory_init', 'memory_brief', 'memory_search', 'memory_slice', 'memory_write', 'memory_log', 'memory_doctor']) {
      assert.ok(tools.includes(name), `缺少工具 ${name}`);
    }
    for (const alias of ['memory_handoff', 'memory_read', 'memory_list']) {
      assert.ok(tools.includes(alias), `缺少别名 ${alias}`);
    }
    assert.match(byId.get(3).result.content[0].text, /项目进度交接/);
    assert.match(byId.get(4).result.content[0].text, /项目进度交接/);
    assert.match(byId.get(5).result.content[0].text, /未找到/);
    assert.equal(byId.get(6).error.code, -32602);
    assert.equal(byId.get(7).error.code, -32601);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 宿主安装清单
// ---------------------------------------------------------------------------
test('Claude Code 插件清单齐备且 MCP 指到共享实现', async () => {
  const dir = join(PORTS, 'claude-code');
  const manifest = JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'longterm-memory');
  assert.equal(manifest.mcpServers, './.mcp.json');
  const mcp = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
  assert.match(mcp.mcpServers['longterm-memory'].args.join(' '), /CLAUDE_PLUGIN_ROOT/);
  await stat(join(dir, 'hooks', 'session-start.mjs'));
  for (const cmd of ['lm-init.md', 'lm-brief.md', 'lm-recall.md', 'lm-close.md', 'lm-adopt.md']) {
    await stat(join(dir, 'commands', cmd));
  }
  // 技能只有一份 canonical 来源（skills/longterm-memory），打包时复制进插件包，避免两处漂移
  await stat(join(ROOT, 'skills', 'longterm-memory', 'SKILL.md'));
  const pack = await readFile(join(ROOT, 'scripts', 'pack-ports.ps1'), 'utf8');
  assert.match(pack, /skills\\longterm-memory/, 'pack-ports 应把 canonical 技能复制进插件包');
});

test('Codex 片段含 mcp_servers 与 AGENTS.md 记忆约定', async () => {
  const cfg = await readFile(join(PORTS, 'codex', 'config.toml.snippet'), 'utf8');
  assert.match(cfg, /\[mcp_servers\.longterm_memory\]/);
  assert.match(cfg, /args\s*=/);
  const agents = await readFile(join(PORTS, 'codex', 'AGENTS.md.snippet'), 'utf8');
  assert.match(agents, /memory_brief/);
  assert.match(agents, /memory_search/);
  for (const p of ['lm-brief.md', 'lm-recall.md', 'lm-close.md']) {
    await stat(join(PORTS, 'codex', 'prompts', p));
  }
});

test('Hermes 原生插件清单齐备，注册的工具与 MCP 一致', async () => {
  const dir = join(PORTS, 'hermes');
  const yaml = await readFile(join(dir, 'plugin.yaml'), 'utf8');
  assert.match(yaml, /^name:\s*longterm-memory/m);
  const init = await readFile(join(dir, '__init__.py'), 'utf8');
  assert.match(init, /def register\(ctx\)/);
  assert.match(init, /register_tool/);
  const schemas = await readFile(join(dir, 'schemas.py'), 'utf8');
  for (const name of ['memory_brief', 'memory_search', 'memory_slice', 'memory_write', 'memory_log', 'memory_status']) {
    assert.match(schemas, new RegExp(`"${name}"`), `Hermes schemas 缺少 ${name}`);
  }
  const tools = await readFile(join(dir, 'tools.py'), 'utf8');
  assert.match(tools, /ltm\.mjs|LTM_CLI/, 'Hermes 工具应调用共享 CLI');
});

test('端口不重复实现记忆逻辑：只调用 ports/core 或 CLI', async () => {
  const hermes = await readFile(join(PORTS, 'hermes', 'tools.py'), 'utf8');
  assert.doesNotMatch(hermes, /def\s+_tokenize|BM25/i, 'Hermes 侧不应复制检索实现');
  const codexReadme = await readFile(join(PORTS, 'codex', 'README.md'), 'utf8');
  assert.match(codexReadme, /ports\/mcp\/server\.mjs|mcp[\\/]server\.mjs/);
});
