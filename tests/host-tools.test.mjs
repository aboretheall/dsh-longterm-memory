// 冒烟测试：用 stub ctx 驱动 Host 半的 6 个工具与 RPC 通道。
// Smoke test for the host half: a stub Context drives all six tools and the RPC channel.
//
//   node --test tests/
//
// 这里不启动真实 Host —— 目的只有一个：保证包的公开契约（工具名、参数、返回值、
// 路径越界拒绝、RPC wire 协议）在改动后没有悄悄变化。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat as fsStat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { apply, inject } from '../index.js';

// ---------------------------------------------------------------------------
// stub ctx
// ---------------------------------------------------------------------------
function makeFs() {
  return {
    async resolve(p, opts = {}) {
      return { path: resolve(opts.cwd ?? process.cwd(), p) };
    },
    async stat(target) {
      try {
        const s = await fsStat(target.path);
        return { type: s.isDirectory() ? 'directory' : 'file', size: s.size };
      } catch {
        return undefined;
      }
    },
    async readText(target) {
      return readFile(target.path, 'utf8');
    },
    async writeText(target, content) {
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, content, 'utf8');
      return { version: 1 };
    },
    async listDir(target) {
      const entries = await readdir(target.path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        target: { path: join(target.path, e.name) },
      }));
    },
  };
}

function makeCtx() {
  const tools = new Map();
  const routes = [];
  const sections = [];
  const disposers = [];
  const ctx = {
    tools: { register: (def) => { tools.set(def.name, def); return () => tools.delete(def.name); } },
    fs: makeFs(),
    systemPrompt: { section: (s) => { sections.push(s); return () => {}; } },
    webServer: {
      register: (r) => { routes.push(r); return () => { const i = routes.indexOf(r); if (i >= 0) routes.splice(i, 1); }; },
    },
    connection: { requestRejection: () => undefined },
    get: () => undefined,
    effect: (fn) => { const d = fn(); disposers.push(d); return () => {}; },
  };
  return { ctx, tools, routes, sections, disposers };
}

function execIn(cwd) {
  return { agent: { session: { header: { cwd } } }, signal: undefined };
}

async function callTool(tools, name, args, exec) {
  const def = tools.get(name);
  assert.ok(def, `tool ${name} 未注册`);
  return def.execute(args, exec);
}

// ---------------------------------------------------------------------------
// fake HTTP req/res for the RPC bridge
// ---------------------------------------------------------------------------
function fakeReq({ url, body, method = 'POST' }) {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield body; },
  };
}
function fakeRes() {
  const res = { status: null, body: '', writeHead(s) { res.status = s; }, end(b) { res.body = b ?? ''; } };
  return res;
}

// ---------------------------------------------------------------------------
const CHANNEL = '/dsh-longterm-memory';

test('inject 声明覆盖工具、文件系统、系统提示、webServer 与 connection', () => {
  for (const key of ['tools', 'fs', 'systemPrompt', 'webServer', 'connection']) {
    assert.ok(inject.includes(key), `inject 缺少 ${key}`);
  }
});

test('6 个工具全部注册，且参数 schema 与文档一致', async () => {
  const { ctx, tools } = makeCtx();
  apply(ctx, {});
  for (const name of ['memory_init', 'memory_handoff', 'memory_read', 'memory_write', 'memory_search', 'memory_list']) {
    assert.ok(tools.has(name), `缺少工具 ${name}`);
  }
  assert.deepEqual(Object.keys(tools.get('memory_write').parameters.properties).sort(), ['content', 'mode', 'path']);
  assert.deepEqual(tools.get('memory_search').parameters.properties.scope.enum, ['hot', 'all', 'T1', 'T2', 'T3']);
  assert.deepEqual(tools.get('memory_list').parameters.properties.level.enum, ['all', 'T1', 'T2', 'T3', 'T4']);
});

test('memory_init 建骨架且幂等', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, tools } = makeCtx();
    apply(ctx, { rootDir: '.' });
    const first = await callTool(tools, 'memory_init', {}, execIn(dir));
    assert.match(first, /新建 9 个文件/);
    const second = await callTool(tools, 'memory_init', {}, execIn(dir));
    assert.match(second, /跳过已存在的 9 个文件/);
    // 骨架关键文件确实落盘
    await fsStat(join(dir, 'T1-交接文件夹', '项目进度交接.md'));
    await fsStat(join(dir, 'T1-交接文件夹', '交接文档文件夹', 'AI经常踩的坑.md'));
    await fsStat(join(dir, 'T3-日志分级整理文件夹', 'README.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory_write/read/handoff/list/search 形成闭环', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, tools } = makeCtx();
    apply(ctx, { maxReadChars: 200 });
    const exec = execIn(dir);
    await callTool(tools, 'memory_init', {}, exec);

    await callTool(tools, 'memory_write', {
      path: 'T3-日志分级整理文件夹/修复bug/游戏机制/NPC相关问题/NPC穿模.md',
      content: '现象：NPC 穿模。\n根因：碰撞层错配。\n',
    }, exec);
    await callTool(tools, 'memory_write', {
      path: 'T3-日志分级整理文件夹/修复bug/游戏机制/NPC相关问题/NPC穿模.md',
      content: '第 2 次：同样的碰撞层问题。',
      mode: 'append',
    }, exec);

    const read = await callTool(tools, 'memory_read', {
      path: 'T3-日志分级整理文件夹/修复bug/游戏机制/NPC相关问题/NPC穿模.md',
    }, exec);
    assert.match(read, /现象：NPC 穿模/);
    assert.match(read, /第 2 次/);

    const handoff = await callTool(tools, 'memory_handoff', {}, exec);
    assert.match(handoff, /项目进度交接\.md/);
    assert.match(handoff, /当前活跃问题\.md/);

    const searched = await callTool(tools, 'memory_search', { query: 'NPC穿模' }, exec);
    assert.match(searched, /NPC穿模\.md/);

    const allScope = await callTool(tools, 'memory_search', { query: '碰撞层', scope: 'all' }, exec);
    assert.match(allScope, /匹配 1 个文件/);

    const listed = await callTool(tools, 'memory_list', { level: 'T3', maxDepth: 4 }, exec);
    assert.match(listed, /T3-日志分级整理文件夹/);
    assert.match(listed, /NPC穿模\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory_read 拒绝绝对路径与越界路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, tools } = makeCtx();
    apply(ctx, {});
    const exec = execIn(dir);
    await assert.rejects(() => callTool(tools, 'memory_read', { path: 'C:/windows/win.ini' }, exec), /绝对路径/);
    await assert.rejects(() => callTool(tools, 'memory_read', { path: '../../secrets.md' }, exec), /越出记忆根目录/);
    await assert.rejects(() => callTool(tools, 'memory_read', { path: '' }, exec), /path 不能为空/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory_read 超过 maxReadChars 时截断并提示', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, tools } = makeCtx();
    apply(ctx, { maxReadChars: 50 });
    const exec = execIn(dir);
    await callTool(tools, 'memory_write', { path: 'T2-全日志记录文件夹/big.md', content: 'x'.repeat(200) }, exec);
    const out = await callTool(tools, 'memory_read', { path: 'T2-全日志记录文件夹/big.md' }, exec);
    assert.match(out, /已截断：全文 200 字符/);
    assert.ok(out.length < 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('系统提示片段默认不注入，标记为长期项目后才注入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, routes, sections } = makeCtx();
    apply(ctx, {});
    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'dsh-longterm-memory');
    const contextFor = (cwd) => ({ agent: { session: { header: { cwd } } } });

    assert.equal(sections[0].text(contextFor(dir)), '', '未标记时必须是空字符串（省 token）');

    // 通过 RPC「收养」项目后，提示片段出现
    const route = routes[0];
    const res = fakeRes();
    await route.handler(
      fakeReq({ url: `${CHANNEL}/memory.adopt`, body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'memory.adopt', payload: { path: dir } }) }),
      res,
    );
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).result.ok, true);
    assert.match(sections[0].text(contextFor(dir)), /长期项目记忆/);
    // 项目结构由收养动作自动生成
    const structure = await readFile(join(dir, 'T1-交接文件夹', '交接文档文件夹', '项目结构.md'), 'utf8');
    assert.match(structure, /# 项目结构/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('RPC 通道：wire 协议、方法名校验、非 JSON 与超大 payload 的拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, routes } = makeCtx();
    apply(ctx, { rootDir: dir });
    assert.equal(routes.length, 1);
    const route = routes[0];
    assert.equal(route.kind, 'prefix');
    assert.equal(route.path, CHANNEL);

    // memory.status → server-response
    let res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: JSON.stringify({ type: 'client-request', rpcId: 'a1', method: 'memory.status' }) }), res);
    const status = JSON.parse(res.body);
    assert.equal(status.type, 'server-response');
    assert.equal(status.rpcId, 'a1');
    assert.equal(status.result.ok, true);
    assert.equal(status.result.value.longTerm, false);
    assert.equal(status.result.value.tree.length, 4);

    // method 与 endpoint 不一致 → bad-request
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: JSON.stringify({ rpcId: 'a2', method: 'memory.init' }) }), res);
    assert.equal(JSON.parse(res.body).result.error.code, 'bad-request');

    // 未知 endpoint
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.nope`, body: JSON.stringify({ rpcId: 'a3', method: 'memory.nope' }) }), res);
    assert.match(JSON.parse(res.body).result.error.message, /Unknown endpoint/);

    // 非 JSON body → 400
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: 'not json' }), res);
    assert.equal(res.status, 400);

    // 越界 endpoint 段 → 404
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/../etc/passwd`, body: '{}' }), res);
    assert.equal(res.status, 404);

    // 错误方法 → 404
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: '{}', method: 'GET' }), res);
    assert.equal(res.status, 404);

    // 超过 4 MiB → 413
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: JSON.stringify({ rpcId: 'a4', method: 'memory.status', payload: { pad: 'y'.repeat(4 * 1024 * 1024) } }) }), res);
    assert.equal(res.status, 413);

    // memory.setLongTerm 会建骨架并持久化标记
    res = fakeRes();
    await route.handler(fakeReq({ url: `${CHANNEL}/memory.setLongTerm`, body: JSON.stringify({ rpcId: 'a5', method: 'memory.setLongTerm', payload: { enabled: true } }) }), res);
    const on = JSON.parse(res.body).result.value;
    assert.equal(on.longTerm, true);
    const marker = JSON.parse(await readFile(join(dir, '.dsh-longterm.json'), 'utf8'));
    assert.equal(marker.enabled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('markerFile 可配置，避免与项目自带文件重名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-'));
  try {
    const { ctx, routes } = makeCtx();
    apply(ctx, { rootDir: dir, markerFile: '.my-longterm.json' });
    let res = fakeRes();
    await routes[0].handler(fakeReq({ url: `${CHANNEL}/memory.status`, body: JSON.stringify({ rpcId: 'b1', method: 'memory.status' }) }), res);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).result.value.rootDir, resolve(dir));

    res = fakeRes();
    await routes[0].handler(fakeReq({ url: `${CHANNEL}/memory.setLongTerm`, body: JSON.stringify({ rpcId: 'b2', method: 'memory.setLongTerm', payload: { enabled: true } }) }), res);
    assert.equal(JSON.parse(res.body).result.value.longTerm, true);
    assert.equal(JSON.parse(await readFile(join(dir, '.my-longterm.json'), 'utf8')).enabled, true);
    await assert.rejects(() => fsStat(join(dir, '.dsh-longterm.json')), '默认标记文件不应被创建');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
