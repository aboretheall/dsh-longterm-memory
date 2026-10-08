// dsh-longterm-memory — T1-T4 长期项目记忆系统 (Host 半)
// T1-T4 long-term project memory for DeepSeek Harness (host half).
//
// 注册 6 个模型工具（memory_init / memory_handoff / memory_read / memory_write /
// memory_search / memory_list）+ 冷启动交接 + 已标记项目的系统提示片段 + Client RPC 通道。
// Registers six model-facing tools, the cold-start handoff, an opt-in system-prompt
// section, and the Client RPC channel used by the settings panel and the session menu.
//
// 纯 ESM，零运行时依赖；所有文件读写走 ctx.fs（尊重沙箱与执行世界）。
// Plain ESM, zero runtime dependencies; every file access goes through ctx.fs so the
// sandbox policy and the execution world are respected.
//
// License: MIT. Docs: README.md (中文) / README.en.md.

import { join, resolve, dirname } from 'node:path';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

export const inject = ['tools', 'fs', 'systemPrompt', 'webServer', 'connection'];

// ---------------------------------------------------------------------------
// T1-T4 目录骨架（相对记忆根目录）
// T1-T4 skeleton, relative to the memory root.
// ---------------------------------------------------------------------------
const SKELETON = [
  ['T1-交接文件夹/项目进度交接.md', `# 项目进度交接

> 每次会话结束时更新。只写「当前状态 + 下一步 + 关键约束」，控制在 200 行以内。

## 当前状态
（项目进行到哪一步，最近一次改动）

## 下一步
（接下来要做什么，按优先级）

## 关键约束
（不可违背的规则、未完成的遗留问题、需要审批的操作）
`],
  ['T1-交接文件夹/当前活跃问题.md', `# 当前活跃问题

> 正在修复/开发中的问题清单，含状态与下一步。会话开始时读它，结束时更新它。

## 进行中
- （问题描述 + 当前进度 + 下一步）

## 已解决待验证
- （问题 + 待验证的验收方式）

## 阻塞
- （问题 + 阻塞原因 + 需要的外部信息）
`],
  ['T1-交接文件夹/交接文档文件夹/项目结构.md', `# 项目结构

> 用树状图描述项目目录与关键模块，让新会话无需逐个文件读取就能理解全貌。
> 结构变化时更新，控制在 100 行以内。
`],
  ['T1-交接文件夹/交接文档文件夹/用户习惯.md', `# 用户习惯

> 用户的会话习惯、输出格式、关键词（问题可归纳为什么关键词）、要求等。
> 用于快速定位问题和保持一致的回答风格。
`],
  ['T1-交接文件夹/交接文档文件夹/用户强调.md', `# 用户强调

> 用户多次强调的问题、要求、红线。逐条记录，避免遗忘。
`],
  ['T1-交接文件夹/交接文档文件夹/AI经常踩的坑.md', `# AI 经常踩的坑

> 工作中经常踩坑、常犯的错误、多次重复犯的错误。第二次犯同一错误时写入。
> 会话开始前扫一眼，避免重蹈覆辙。
`],
  ['T2-全日志记录文件夹/README.md', `# T2 全日志记录

> 原始会话日志存档，按周一个文件。仅用于人类回溯或数据恢复，AI 不主动全文读取。

命名格式：第X周-YYYY年-MM月-DD日->YYYY年-MM月-DD日.md
内容：完整会话日志，含操作、改动、时间（精确到分+时间戳）、当日第几轮会话。
`],
  ['T3-日志分级整理文件夹/README.md', `# T3 日志分级整理

> 对每次会话做结构化整理，按「大类 → 问题类型 → 具体问题点」分级，方便精准检索。

分类示例：
- 修复bug/（游戏NPC / 游戏机制 / 游戏数值 / 游戏玩家 …）
- 新功能/（对应模块）
- 其他/

每个问题点一个 .md，文件名体现「用户习惯关键词」，内容记录每一次对该问题的修复与思考。
`],
  ['T4-项目目录文件夹/README.md', `# T4 项目目录

> 放项目目录/代码资产。记忆工具不读写这里，代码仍用 read/edit/glob 等原生工具操作。
`],
];

// ---------------------------------------------------------------------------
// 工具注册 / Tool registration
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const rootDir = typeof cfg.rootDir === 'string' && cfg.rootDir !== '' ? cfg.rootDir : '.';
  const maxReadChars = Number.isSafeInteger(cfg.maxReadChars) ? cfg.maxReadChars : 12000;
  const maxSearchFiles = Number.isSafeInteger(cfg.maxSearchFiles) ? cfg.maxSearchFiles : 12;
  const maxSearchLines = Number.isSafeInteger(cfg.maxSearchLines) ? cfg.maxSearchLines : 3;
  // 允许把标记文件改到别处，避免与项目自带文件冲突。Marker file name, configurable.
  const markerName = typeof cfg.markerFile === 'string' && cfg.markerFile !== ''
    ? cfg.markerFile
    : '.dsh-longterm.json';

  const text = (value) => [{ type: 'text', text: value }];

  // 沙箱策略：拿不到就返回 undefined，交给 ctx.fs 按默认策略处理。
  function sandbox(exec) {
    const sp = ctx.get('sandboxPolicy');
    if (sp === undefined) return undefined;
    const session = exec && exec.agent ? exec.agent.session : undefined;
    return sp.resolve(session === undefined ? {} : { session });
  }

  function workspaceRoot(exec) {
    const policy = sandbox(exec);
    if (policy !== undefined) return policy.workspaceRoot;
    const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header
      ? exec.agent.session.header.cwd
      : undefined;
    if (cwd === undefined) throw new Error('memory 工具需要会话工作区（session workspace）');
    return cwd;
  }

  // 把用户给的子路径规范化为相对路径，拒绝绝对路径与越界（..）。
  // Normalize a caller-supplied sub-path; reject absolute paths and escapes.
  function normalizeSubPath(subPath) {
    if (typeof subPath !== 'string' || subPath.trim() === '') throw new Error('path 不能为空');
    const cleaned = subPath.replace(/\\/g, '/');
    if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
      throw new Error('不允许绝对路径，只能使用记忆根目录内的相对路径');
    }
    const out = [];
    for (const p of cleaned.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (out.length === 0) throw new Error('路径越出记忆根目录');
        out.pop();
      } else {
        out.push(p);
      }
    }
    if (out.length === 0) throw new Error('path 必须指向记忆根目录内的文件');
    return out.join('/');
  }

  async function resolveSub(exec, subPath) {
    const rel = normalizeSubPath(subPath);
    return ctx.fs.resolve(join(rootDir, rel), { cwd: workspaceRoot(exec), signal: exec.signal });
  }

  // 递归列出目录下的 .md 文件。
  async function walkMd(target, depth, maxDepth, signal, out = []) {
    let entries;
    try {
      entries = await ctx.fs.listDir(target, signal);
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.type === 'directory' && depth < maxDepth) {
        await walkMd(e.target, depth + 1, maxDepth, signal, out);
      } else if (e.type === 'file' && e.name.toLowerCase().endsWith('.md')) {
        out.push(e);
      }
    }
    return out;
  }

  // ---- memory_init ------------------------------------------------------
  ctx.tools.register({
    name: 'memory_init',
    description:
      '在项目工作区创建 T1-T4 长期记忆目录骨架与模板文件（幂等，已存在的文件不覆盖）。' +
      '首次接入长期项目、或记忆目录缺失时调用。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(_args, exec) {
      const created = [];
      const skipped = [];
      for (const [rel, content] of SKELETON) {
        const target = await resolveSub(exec, rel);
        const info = await ctx.fs.stat(target, exec.signal);
        if (info === undefined) {
          await ctx.fs.writeText(target, content, { kind: 'createIfAbsent' }, exec.signal, sandbox(exec));
          created.push(rel);
        } else {
          skipped.push(rel);
        }
      }
      return (
        `记忆骨架已就绪（根目录：${rootDir}）\n` +
        `新建 ${created.length} 个文件，跳过已存在的 ${skipped.length} 个文件。\n` +
        (created.length > 0 ? '新建：\n- ' + created.join('\n- ') : '所有模板文件均已存在。')
      );
    },
  });

  // ---- memory_handoff ---------------------------------------------------
  ctx.tools.register({
    name: 'memory_handoff',
    description:
      '冷启动：读取 T1 交接层（项目进度交接 + 当前活跃问题），返回当前项目状态简报。' +
      '每次新会话开始时先调用它，确认状态后再动手。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(_args, exec) {
      const parts = [];
      const files = [
        'T1-交接文件夹/项目进度交接.md',
        'T1-交接文件夹/当前活跃问题.md',
      ];
      let found = 0;
      for (const rel of files) {
        try {
          const target = await resolveSub(exec, rel);
          const info = await ctx.fs.stat(target, exec.signal);
          if (info === undefined || info.type !== 'file') continue;
          const content = await ctx.fs.readText(target, exec.signal);
          found += 1;
          parts.push(`===== ${rel} =====\n${content}`);
        } catch {
          // 单个文件缺失不阻断整体交接 / one missing file never breaks the handoff
        }
      }
      if (found === 0) {
        return (
          'T1 交接文件不存在。请先调用 memory_init 创建记忆骨架，' +
          '或把项目状态写入 T1-交接文件夹/项目进度交接.md。'
        );
      }
      return parts.join('\n\n');
    },
  });

  // ---- memory_read ------------------------------------------------------
  ctx.tools.register({
    name: 'memory_read',
    description:
      '读取记忆根目录内的一个文件（相对路径，例如 "T3-日志分级整理文件夹/修复bug/游戏机制/NPC相关问题/NPC穿模.md"）。' +
      '用于按需取用记忆，避免全文加载无关上下文。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '记忆根目录内的相对路径。' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      const target = await resolveSub(exec, args.path);
      const info = await ctx.fs.stat(target, exec.signal);
      if (info === undefined) throw new Error(`记忆文件不存在：${args.path}`);
      if (info.type !== 'file') throw new Error(`不是文件：${args.path}`);
      const content = await ctx.fs.readText(target, exec.signal);
      if (content.length > maxReadChars) {
        return content.slice(0, maxReadChars) +
          `\n\n[已截断：全文 ${content.length} 字符，用 memory_read 的 path 定位后按需读取]\n`;
      }
      return content;
    },
  });

  // ---- memory_write -----------------------------------------------------
  ctx.tools.register({
    name: 'memory_write',
    description:
      '写入或追加记忆根目录内的一个文件（相对路径）。父目录自动创建。' +
      'mode=overwrite 整体覆盖（默认），mode=append 追加。用于会话结束时把结论写回 T1/T3。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '记忆根目录内的相对路径。' },
        content: { type: 'string', description: '要写入的内容。' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: '写入模式：overwrite 覆盖，append 追加。默认 overwrite。',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      const target = await resolveSub(exec, args.path);
      const mode = args.mode === 'append' ? 'append' : 'overwrite';
      let finalContent = args.content;
      let operation = '创建';
      if (mode === 'append') {
        const info = await ctx.fs.stat(target, exec.signal);
        if (info !== undefined && info.type === 'file') {
          const existing = await ctx.fs.readText(target, exec.signal);
          finalContent = existing.endsWith('\n') ? existing + args.content : existing + '\n' + args.content;
          operation = '追加';
        }
      }
      await ctx.fs.writeText(target, finalContent, undefined, exec.signal, sandbox(exec));
      return `${operation}完成：${args.path}（${finalContent.length} 字符）`;
    },
  });

  // ---- memory_search ----------------------------------------------------
  ctx.tools.register({
    name: 'memory_search',
    description:
      '在 T1/T3 记忆（默认）中按关键词检索历史问题与修复记录。修 bug 或做新功能前先调用，判断是否为老问题。' +
      'scope=hot 仅检索 T1+T3（默认），scope=all 额外包含 T2 全日志，scope=T1/T2/T3 单独指定。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词，可多个，用空格分隔。' },
        scope: {
          type: 'string',
          enum: ['hot', 'all', 'T1', 'T2', 'T3'],
          description: '检索范围。默认 hot（T1+T3）。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      const query = String(args.query || '').trim();
      if (query === '') throw new Error('query 不能为空');
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scope = args.scope || 'hot';

      const scopeDirs = [];
      if (scope === 'all') {
        scopeDirs.push('T1-交接文件夹', 'T2-全日志记录文件夹', 'T3-日志分级整理文件夹');
      } else if (scope === 'T1') scopeDirs.push('T1-交接文件夹');
      else if (scope === 'T2') scopeDirs.push('T2-全日志记录文件夹');
      else if (scope === 'T3') scopeDirs.push('T3-日志分级整理文件夹');
      else scopeDirs.push('T1-交接文件夹', 'T3-日志分级整理文件夹');

      const files = [];
      for (const dir of scopeDirs) {
        let target;
        try {
          target = await resolveSub(exec, dir);
        } catch {
          continue;
        }
        const info = await ctx.fs.stat(target, exec.signal);
        if (info === undefined || info.type !== 'directory') continue;
        await walkMd(target, 0, 8, exec.signal, files);
      }

      const hits = [];
      for (const f of files) {
        const relName = f.name.toLowerCase();
        const nameMatch = terms.some((t) => relName.includes(t));
        let content = '';
        try {
          const info = await ctx.fs.stat(f.target, exec.signal);
          if (info && info.size && info.size > 600000) {
            // 超大日志文件跳过全文读取，仅凭文件名命中
            if (nameMatch) hits.push({ rel: f.name, lines: ['（大文件，未读全文）'] });
            continue;
          }
          content = await ctx.fs.readText(f.target, exec.signal);
        } catch {
          continue;
        }
        if (nameMatch) {
          hits.push({ rel: f.name, lines: firstMatchingLines(content, terms, maxSearchLines) });
          continue;
        }
        const lower = content.toLowerCase();
        if (terms.some((t) => lower.includes(t))) {
          hits.push({ rel: f.name, lines: firstMatchingLines(content, terms, maxSearchLines) });
        }
      }

      const capped = hits.slice(0, maxSearchFiles);
      if (hits.length === 0) {
        return `未在 T${scope === 'hot' ? '1/T3' : scope} 中找到与「${query}」相关的记录。` +
          `若为新问题，请归类后写入 T3；若怀疑是久远历史，可用 scope=all 回查 T2。`;
      }
      const body = capped.map((h, i) => {
        const lines = h.lines.length > 0 ? h.lines.map((l) => `   ${l}`).join('\n') : '   （仅文件名命中）';
        return `${i + 1}. ${h.rel}\n${lines}`;
      }).join('\n');
      const more = hits.length > maxSearchFiles ? `\n（共 ${hits.length} 条，已显示前 ${maxSearchFiles} 条）` : '';
      return `匹配 ${hits.length} 个文件（query: "${query}"）：\n\n${body}${more}`;
    },
  });

  // ---- memory_list ------------------------------------------------------
  ctx.tools.register({
    name: 'memory_list',
    description: '列出记忆目录结构（T1-T4）。level 可指定 T1/T2/T3/T4，maxDepth 控制展开深度。',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['all', 'T1', 'T2', 'T3', 'T4'],
          description: '要列出的层，默认 all。',
        },
        maxDepth: { type: 'integer', description: '最大展开深度，默认 4。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => text(value),
    },
    async execute(args, exec) {
      const level = args.level || 'all';
      const maxDepth = Number.isSafeInteger(args.maxDepth) ? args.maxDepth : 4;
      const dirs = level === 'all'
        ? ['T1-交接文件夹', 'T2-全日志记录文件夹', 'T3-日志分级整理文件夹', 'T4-项目目录文件夹']
        : level === 'T1' ? ['T1-交接文件夹']
          : level === 'T2' ? ['T2-全日志记录文件夹']
            : level === 'T3' ? ['T3-日志分级整理文件夹']
              : ['T4-项目目录文件夹'];

      const lines = [`记忆目录结构（根：${rootDir}）：`];
      for (const dir of dirs) {
        let target;
        try {
          target = await resolveSub(exec, dir);
        } catch {
          continue;
        }
        const info = await ctx.fs.stat(target, exec.signal);
        if (info === undefined || info.type !== 'directory') {
          lines.push(`${dir}/  (不存在)`);
          continue;
        }
        await renderTree(target, dir, 0, maxDepth, exec.signal, lines);
      }
      return lines.join('\n');
    },
  });

  async function renderTree(target, label, depth, maxDepth, signal, lines) {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}${label}/`);
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await ctx.fs.listDir(target, signal);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.type === 'directory') {
        await renderTree(e.target, e.name, depth + 1, maxDepth, signal, lines);
      } else {
        lines.push(`${'  '.repeat(depth + 1)}${e.name}`);
      }
    }
  }

  // ---- 长期项目标记 + RPC / long-term marker + Client RPC ---------------
  const MEMORY_DIRS = ['T1-交接文件夹', 'T2-全日志记录文件夹', 'T3-日志分级整理文件夹', 'T4-项目目录文件夹'];

  function memoryAbs() { return resolve(rootDir); }

  async function readLongTermAt(cwd) {
    try {
      const raw = await readFile(join(cwd, markerName), 'utf8');
      return JSON.parse(raw).enabled === true;
    } catch { return false; }
  }
  async function writeLongTermAt(cwd, enabled) {
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, markerName), JSON.stringify({ enabled, updatedAt: Date.now() }), 'utf8');
  }
  async function dirExists(p) {
    try { return (await stat(p)).isDirectory(); } catch { return false; }
  }
  async function ensureSkeletonAt(cwd) {
    const created = [];
    for (const [rel, content] of SKELETON) {
      const p = join(cwd, rel);
      try { await stat(p); continue; } catch { /* 不存在，往下创建 */ }
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, 'utf8');
      created.push(rel);
    }
    return created;
  }
  async function listTree(p, depth) {
    const out = [];
    let entries;
    try { entries = await readdir(p, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name === markerName) continue;
      if (e.isDirectory()) {
        out.push({ name: e.name, type: 'dir', children: depth > 0 ? await listTree(join(p, e.name), depth - 1) : [] });
      } else {
        out.push({ name: e.name, type: 'file' });
      }
    }
    return out;
  }
  async function memoryStatusAt(cwd) {
    const longTerm = await readLongTermAt(cwd);
    const tree = [];
    let initialized = false;
    for (const d of MEMORY_DIRS) {
      const p = join(cwd, d);
      const exists = await dirExists(p);
      if (exists) initialized = true;
      tree.push({ name: d, exists, children: exists ? await listTree(p, 4) : [] });
    }
    return { rootDir: cwd, longTerm, initialized, tree };
  }
  function memoryStatus() { return memoryStatusAt(memoryAbs()); }

  // 扫描项目目录，生成「项目结构.md」初稿 / scan the project into a structure draft.
  const SCAN_IGNORE = new Set([
    'node_modules', '.git', '.dsh', 'dist', 'build', 'out', 'target',
    '__pycache__', '.venv', 'venv', '.idea', '.vscode', markerName,
    ...MEMORY_DIRS,
  ]);
  async function renderDirTree(p, prefix, depth, lines) {
    let entries;
    try { entries = await readdir(p, { withFileTypes: true }); } catch { return; }
    entries = entries
      .filter((e) => !SCAN_IGNORE.has(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (e.isDirectory()) {
        lines.push(`${prefix}- ${e.name}/`);
        if (depth > 0) await renderDirTree(join(p, e.name), prefix + '  ', depth - 1, lines);
      } else {
        lines.push(`${prefix}- ${e.name}`);
      }
    }
  }
  async function scanStructure(cwd) {
    const lines = ['# 项目结构', '', '> 由「设为长期项目」自动扫描生成，后续可手动补全说明。', ''];
    await renderDirTree(cwd, '', 3, lines);
    return lines.join('\n');
  }

  // 核心：把一个项目目录「收养」为长期项目（建骨架 + 扫描结构 + 标记）
  async function adoptProject(input) {
    let cwd = input && typeof input.path === 'string' && input.path !== '' ? input.path : undefined;
    if (!cwd && input && input.sessionId) {
      const sessions = ctx.get('sessions');
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(input.sessionId) : undefined;
      cwd = session && session.header ? session.header.cwd : undefined;
    }
    if (!cwd) throw new Error('无法确定项目路径：请先打开该项目，再通过「三点菜单 → 设为长期项目」设置');
    const created = await ensureSkeletonAt(cwd);
    await writeFile(join(cwd, 'T1-交接文件夹', '交接文档文件夹', '项目结构.md'), await scanStructure(cwd), 'utf8');
    await writeLongTermAt(cwd, true);
    return { ...(await memoryStatusAt(cwd)), created };
  }

  const rpcHandler = async (endpoint, payload) => {
    try {
      if (endpoint === 'memory.status') return { ok: true, value: await memoryStatus() };
      if (endpoint === 'memory.adopt') return { ok: true, value: await adoptProject(payload) };
      if (endpoint === 'memory.setLongTerm') {
        const enabled = payload && payload.enabled === true;
        await writeLongTermAt(memoryAbs(), enabled);
        if (enabled) await ensureSkeletonAt(memoryAbs());
        return { ok: true, value: await memoryStatus() };
      }
      if (endpoint === 'memory.init') {
        const created = await ensureSkeletonAt(memoryAbs());
        return { ok: true, value: { ...(await memoryStatus()), created } };
      }
      return { ok: false, error: { code: 'bad-request', message: `Unknown endpoint: ${endpoint}`, details: {} } };
    } catch (err) {
      return { ok: false, error: { code: 'bad-request', message: err && err.message ? err.message : String(err), details: {} } };
    }
  };

  // 挂载 RPC 通道到 webServer（设置面板 ⇄ Host 通信）
  // Mount the RPC channel on webServer: settings panel and session menu talk to the Host here.
  const CHANNEL = '/dsh-longterm-memory';
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    ctx.effect(() => {
      const registered = ctx.webServer.register({
        kind: 'prefix',
        path: CHANNEL,
        handler: async (req, res) => {
          let rejection;
          if (typeof ctx.connection?.requestRejection === 'function') {
            try { rejection = ctx.connection.requestRejection(req); } catch { rejection = 403; }
          }
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
            return;
          }
          await rpcHttpBridge(req, res, CHANNEL, rpcHandler);
        },
      });
      return () => { try { if (typeof registered === 'function') registered(); } catch {} };
    }, 'dsh-longterm-memory: rpc channel');
  }

  // ---- 系统提示片段（仅当项目已标记为长期项目时才注入，省 token） --------
  // System-prompt section, injected only for a marked long-term project: zero token cost otherwise.
  const MEMORY_GUIDE =
    '## 长期项目记忆（dsh-longterm-memory）\n' +
    '- 会话开始时，先调用 memory_handoff 读取项目交接与活跃问题，确认状态后再动手。\n' +
    '- 修 bug / 做新功能前，先调用 memory_search 检索 T3 历史同类问题，避免重复踩坑；命中老问题就续写新方案。\n' +
    '- 会话结束时，用 memory_write 把结论写回 T1（项目进度交接/当前活跃问题）和 T3（问题分类）。\n' +
    '- T2 是全量日志存档，不要全文读入上下文；只在 T3 检索不到时用 memory_search scope=all 回查。';
  ctx.systemPrompt.section({
    name: 'dsh-longterm-memory',
    order: 300,
    text: (context) => {
      const cwd = context && context.agent && context.agent.session && context.agent.session.header
        ? context.agent.session.header.cwd
        : undefined;
      if (!cwd) return '';
      try {
        if (JSON.parse(readFileSync(join(cwd, markerName), 'utf8')).enabled !== true) return '';
      } catch { return ''; }
      return MEMORY_GUIDE;
    },
  });
}

// ---------------------------------------------------------------------------
// 小工具 / helpers
// ---------------------------------------------------------------------------
function firstMatchingLines(content, terms, limit) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      out.push(`L${i + 1}: ${lines[i].trim().slice(0, 200)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// RPC HTTP 桥：复刻 Connection /api 的 wire 协议（client-request → server-response）
// RPC HTTP bridge: mirrors the Connection /api wire protocol.
// ---------------------------------------------------------------------------
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/;
async function rpcHttpBridge(req, res, channel, handler) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'POST' || !pathname.startsWith(`${channel}/`)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const endpoint = pathname.slice(channel.length + 1);
  if (endpoint.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || !ENDPOINT_SEGMENT.test(seg))) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('content type must be application/json');
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 4 * 1024 * 1024) {
      res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('payload too large');
      return;
    }
  }
  let envelope;
  try { envelope = JSON.parse(body); } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('body is not JSON');
    return;
  }
  const rpcId = envelope && typeof envelope.rpcId === 'string' ? envelope.rpcId : 'invalid-request';
  const method = envelope && typeof envelope.method === 'string' ? envelope.method : null;
  let result;
  if (method === null) {
    result = { ok: false, error: { code: 'bad-request', message: 'invalid client-request message', details: { issues: [] } } };
  } else if (method !== endpoint) {
    result = { ok: false, error: { code: 'bad-request', message: `method ${JSON.stringify(method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } };
  } else {
    try {
      result = await handler(endpoint, envelope.payload);
    } catch (err) {
      result = { ok: false, error: { code: 'bad-request', message: err && err.message ? err.message : String(err), details: {} } };
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'server-response', rpcId, result }));
}
