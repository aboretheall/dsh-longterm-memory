// ports/core/engine.mjs — T1-T4 记忆引擎（三种宿主共用）
//
// Claude Code / Codex / Hermes 三个端口都调用这里的同一套实现；宿主差异只在
// 「怎么把工具暴露给模型」这一层（MCP server / 原生 Python 插件 / CLI）。
//
// 目录语义：
//   T1 交接   常驻上下文：会话开头读一次（简报预算内）
//   T2 全日志 冷存储：一周一文件，不主动读，只在 T3 检索不到时兜底
//   T3 分类   热缓存：按 类型/模块/问题点 组织，检索命中才读
//   T4 项目   代码资产，记忆工具只列不读

import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  MARKERS,
  chunkMarkdown,
  detectLayout,
  ensureDir,
  findRoot,
  fmtDate,
  fmtDateTime,
  isoWeekInfo,
  layerDirs,
  readCapped,
  readTextFile,
  rel,
  safeName,
  safeRelPath,
  walkMarkdown,
  weekRange,
  writeFileIfChanged,
} from './fsutil.mjs';
import { buildIndexForScope, headingOutline, searchChunks } from './search.mjs';

export { detectLayout, findRoot, LAYOUTS, MARKERS };

export const CATEGORIES = ['修复bug', '新功能', '疑问咨询', '回顾重构'];

// ---------------------------------------------------------------------------
// 骨架
// ---------------------------------------------------------------------------
function docDirName(layout) {
  return layout.id === 'dsh' ? '交接文档文件夹' : '交接文档';
}

function skeleton(root, layout) {
  const docDir = docDirName(layout);
  return [
    [`${layout.T1}/项目进度交接.md`, `# 项目进度交接

> 每次会话结束时更新。只写「当前状态 + 下一步 + 关键约束」，控制在 200 行以内。

## 当前状态
（项目进行到哪一步，最近一次改动）

## 下一步
（接下来要做什么，按优先级）

## 关键约束
（不可违背的规则、未完成的遗留问题、需要审批的操作）
`],
    [`${layout.T1}/当前活跃问题.md`, `# 当前活跃问题

> 正在修复/开发中的问题清单。会话开始读它，结束更新它。

## 进行中
- （问题描述 + 当前进度 + 下一步）

## 已解决待验证
- （问题 + 待验证的验收方式）

## 阻塞
- （问题 + 阻塞原因 + 需要的外部信息）
`],
    [`${layout.T1}/${docDir}/项目结构.md`, `# 项目结构

> 用树状图描述项目目录与关键模块，让新会话无需逐个文件读取就能理解全貌。
`],
    [`${layout.T1}/${docDir}/用户习惯.md`, `# 用户习惯

> 用户的会话习惯、输出格式、关键词、要求。用于快速定位问题和保持回答风格一致。
`],
    [`${layout.T1}/${docDir}/用户强调.md`, `# 用户强调

> 用户多次强调的问题、要求、红线。逐条记录，避免遗忘。
`],
    [`${layout.T1}/${docDir}/AI经常踩的坑.md`, `# AI 经常踩的坑

> 经常踩坑、多次重复犯的错误。第二次犯同一错误时写入。
> 会话开始前扫一眼，避免重蹈覆辙。格式：现象 → 根因 → 硬规则。
`],
    [`${layout.T2}/README.md`, `# T2 全日志

> 原始会话日志存档，一周一个文件。仅用于人类回溯或数据恢复，AI 不主动全文读取。
`],
    [`${layout.T3}/README.md`, `# T3 分类整理

> 对每次会话做结构化整理，按「大类 → 模块 → 具体问题点」分级，方便精准检索。

大类只取：${CATEGORIES.join(' / ')}。同一问题反复出现时续写同一个文件，不要新建。
`],
    [`${layout.T4}/README.md`, `# T4 项目

> 放项目代码/资源。记忆工具只列出结构，不读写这里的内容。
`],
  ];
}

export function initProject(root, opts = {}) {
  const abs = path.resolve(root);
  const layout = LAYOUTS[opts.layout] || detectLayout(abs, opts.layout || DEFAULT_LAYOUT);
  ensureDir(abs);
  const created = [];
  const skipped = [];
  for (const [relative, content] of skeleton(abs, layout)) {
    const target = path.join(abs, relative);
    if (fs.existsSync(target)) {
      skipped.push(relative);
      continue;
    }
    writeFileIfChanged(target, content);
    created.push(relative);
  }
  const markers = writeMarkers(abs, opts.markers, layout.id);
  return { ok: true, root: abs, layout: layout.id, created, skipped, markers };
}

// 默认同时写两种标记文件：任何宿主打开都能认出「这是长期记忆项目」，共用同一份 T1-T4。
// 两个标记里都写真实的 layout（而不是各自的名字），detectLayout 才能读出一致的答案。
function writeMarkers(root, mode = 'both', layoutId = DEFAULT_LAYOUT) {
  const wanted =
    mode === 'both' ? MARKERS : mode === 'cc' ? [LAYOUTS.cc.marker] : mode === 'dsh' ? [LAYOUTS.dsh.marker] : MARKERS;
  const written = [];
  for (const marker of wanted) {
    const target = path.join(root, marker);
    try {
      fs.writeFileSync(
        target,
        JSON.stringify({ enabled: true, layout: layoutId, markers: MARKERS, updatedAt: Date.now() }, null, 2),
        'utf8',
      );
      written.push(marker);
    } catch {
      /* 标记写不进去不致命 */
    }
  }
  return written;
}

// 「收养」一个已有项目：建骨架 + 扫描结构 + 写标记
export function adoptProject(root, opts = {}) {
  const abs = path.resolve(root);
  const layout = LAYOUTS[opts.layout] || detectLayout(abs, opts.layout || DEFAULT_LAYOUT);
  const created = initProject(abs, { layout: layout.id, markers: opts.markers || 'both' });
  const structurePath = path.join(abs, layout.T1, docDirName(layout), '项目结构.md');
  writeFileIfChanged(structurePath, scanStructure(abs));
  return { ok: true, root: abs, layout: layout.id, created: created.created, structure: rel(abs, structurePath) };
}

const SCAN_IGNORE = new Set([
  'node_modules', '.git', '.dsh', 'dist', 'build', 'out', 'target', '__pycache__',
  '.venv', 'venv', '.idea', '.vscode', ...MARKERS,
  ...Object.values(LAYOUTS).map((l) => l.T1),
  ...Object.values(LAYOUTS).map((l) => l.T2),
  ...Object.values(LAYOUTS).map((l) => l.T3),
  ...Object.values(LAYOUTS).map((l) => l.T4),
]);

export function scanStructure(root, depth = 3) {
  const lines = ['# 项目结构', '', '> 由 memory_init / lm-adopt 自动扫描生成，后续可手动补全说明。', ''];
  const walk = (dir, prefix, left) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries
      .filter((e) => !SCAN_IGNORE.has(e.name))
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    for (const e of entries) {
      if (e.isDirectory()) {
        lines.push(`${prefix}- ${e.name}/`);
        if (left > 0) walk(path.join(dir, e.name), `${prefix}  `, left - 1);
      } else {
        lines.push(`${prefix}- ${e.name}`);
      }
    }
  };
  walk(root, '', depth);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 读：简报 / 目录 / 检索 / 取片段
// ---------------------------------------------------------------------------
export function brief(root, opts = {}) {
  const layout = detectLayout(root);
  const budget = Number.isFinite(opts.budget) ? opts.budget : 12000;
  const perFile = Number.isFinite(opts.per_file) ? opts.per_file : 4000;
  const targets = [
    `${layout.T1}/项目进度交接.md`,
    `${layout.T1}/当前活跃问题.md`,
    `${layout.T1}/${docDirName(layout)}/用户强调.md`,
    `${layout.T1}/${docDirName(layout)}/AI经常踩的坑.md`,
  ];

  const parts = [];
  let used = 0;
  for (const relative of targets) {
    const abs = path.join(root, relative);
    if (!fs.existsSync(abs)) continue;
    const cap = Math.min(perFile, Math.max(0, budget - used));
    if (cap <= 0) {
      parts.push(`===== ${relative} =====\n（已达简报预算 ${budget} 字符，其余文件略）`);
      break;
    }
    const { text, truncated } = readCapped(abs, cap);
    used += text.length;
    parts.push(`===== ${relative} =====\n${text}${truncated ? '\n…[已按简报预算截断]' : ''}`);
  }
  if (!parts.length) {
    return `项目根 ${root} 下没有 T1 交接文件。先运行 memory_init（或 lm-init / /lm-init）生成骨架。`;
  }
  return parts.join('\n\n');
}

export function indexOutline(root, opts = {}) {
  const scope = opts.scope || 'T3';
  const rows = headingOutline(root, scope === 'hot' ? 'T3' : scope);
  if (!rows.length) return `scope=${scope} 下没有可索引的 markdown 文件。`;
  const lines = [`记忆索引（scope=${scope}，仅清单+标题，不含正文）：`];
  for (const r of rows) {
    lines.push(`\n${r.file}`);
    for (const heading of r.headings) lines.push(`  ${heading}`);
  }
  return lines.join('\n');
}

export function search(root, query, opts = {}) {
  const scope = opts.scope || 'hot';
  const index = buildIndexForScope(root, scope);
  const result = searchChunks(index, query, {
    limit: opts.limit || 8,
    excerpt_chars: opts.excerpt_chars || 700,
  });
  if (!result.hits.length) {
    return (
      `未找到与「${query}」相关的记录（scope=${scope}，索引 ${result.total_chunks} 个章节）。\n` +
      `若确信是久远历史，用 scope=all 回查 T2；若确为新问题，归类后写入 T3。`
    );
  }
  const lines = [`命中 ${result.hits.length} 节（scope=${scope}，query="${query}"）：`];
  result.hits.forEach((h, i) => {
    lines.push(`\n${i + 1}. ${h.file}  [${h.heading}]  行 ${h.lines}  score=${h.score}`);
    lines.push(h.excerpt.split('\n').map((l) => `   ${l}`).join('\n'));
  });
  return lines.join('\n');
}

export function slice(root, opts = {}) {
  const relative = safeRelPath(opts.file || opts.path);
  const abs = path.join(root, relative);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${relative}`);
  const maxChars = Number.isFinite(opts.max_chars) ? opts.max_chars : 12000;
  const chunks = chunkMarkdown(abs, root);

  if (opts.heading) {
    const needle = String(opts.heading).toLowerCase();
    const found =
      chunks.find((c) => c.headingPath.toLowerCase() === needle) ||
      chunks.find((c) => c.headingPath.toLowerCase().includes(needle)) ||
      chunks.find((c) => c.heading.toLowerCase().includes(needle));
    if (!found) {
      const heads = chunks.map((c) => c.headingPath).join('\n  ');
      throw new Error(`该文件里找不到标题「${opts.heading}」。可用标题：\n  ${heads}`);
    }
    const text = found.text.length > maxChars ? `${found.text.slice(0, maxChars)}\n…[已截断]` : found.text;
    return `===== ${relative} · ${found.headingPath} (行 ${found.startLine}-${found.endLine}) =====\n${text}`;
  }

  if (opts.lines) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(opts.lines).trim());
    if (!m) throw new Error('lines 参数格式应为 "起始-结束"，例如 "12-40"');
    const all = readTextFile(abs).split(/\r?\n/);
    const from = Math.max(1, Number(m[1]));
    const to = Math.min(all.length, Number(m[2]));
    const text = all.slice(from - 1, to).join('\n');
    return `===== ${relative} (行 ${from}-${to} / 共 ${all.length} 行) =====\n${
      text.length > maxChars ? `${text.slice(0, maxChars)}\n…[已截断]` : text
    }`;
  }

  const { text, truncated, total } = readCapped(abs, maxChars);
  return `===== ${relative} (${total} 字符${truncated ? '，已截断' : ''}) =====\n${text}`;
}

// ---------------------------------------------------------------------------
// 写：结构化写入 T3 / 追加 T2 日志
// ---------------------------------------------------------------------------
function countRecords(raw) {
  return (raw.match(/^##\s+第\s*\d+\s*条记录/gm) || []).length;
}

export function writeMemory(root, opts = {}) {
  const layout = detectLayout(root);
  const content = String(opts.content || '').trim();
  if (!content) throw new Error('content 不能为空');

  let relative;
  if (opts.path || opts.file) {
    relative = safeRelPath(opts.path || opts.file);
  } else {
    const title = safeName(opts.title || opts.topic || '');
    if (!title) throw new Error('需要提供 title/topic（或直接给 path）');
    const category = opts.category ? safeRelPath(opts.category) : '其他';
    relative = path.join(layout.T3, category, `${title}.md`);
  }

  const abs = path.join(root, relative);
  const stamp = fmtDateTime(new Date());
  ensureDir(path.dirname(abs));

  if (!fs.existsSync(abs)) {
    const head = `# ${opts.title || path.basename(relative, '.md')}\n\n> 创建于 ${stamp}\n`;
    const tags = Array.isArray(opts.tags) ? opts.tags.filter(Boolean) : [];
    const tagLine = tags.length ? `> 关键词：${tags.join(' / ')}\n` : '';
    writeFileIfChanged(abs, `${head}${tagLine}\n## 第 1 条记录 · ${stamp}\n\n${content}\n`);
    return `创建 ${rel(root, abs)}（第 1 条记录）`;
  }

  const raw = readTextFile(abs);
  const n = countRecords(raw) + 1;
  const body = opts.title && !raw.startsWith(`# ${opts.title}`) ? '' : '';
  const next = `${raw.replace(/\s*$/, '')}\n\n## 第 ${n} 条记录 · ${stamp}\n\n${content}\n${body}`;
  fs.writeFileSync(abs, next, 'utf8');
  return `追加 ${rel(root, abs)}（第 ${n} 条记录）`;
}

export function logSession(root, opts = {}) {
  const layout = detectLayout(root);
  const content = String(opts.content || '').trim();
  if (!content) throw new Error('content 不能为空');

  const now = new Date();
  const { week } = isoWeekInfo(now);
  const [mon, sun] = weekRange(now);
  const fileName = `第${week}周-${fmtDate(mon)}→${fmtDate(sun)}.md`.replace(/[/\\]/g, '-');
  const relative = path.join(layout.T2, fileName);
  const abs = path.join(root, relative);
  ensureDir(path.dirname(abs));

  if (!fs.existsSync(abs)) {
    writeFileIfChanged(abs, `# 第${week}周日志 ${fmtDate(mon)} → ${fmtDate(sun)}\n`);
  }
  const raw = readTextFile(abs);
  const rounds = (raw.match(/^##\s+轮次\s+\d+/gm) || []).length + 1;
  const stamp = fmtDateTime(now);
  fs.writeFileSync(abs, `${raw.replace(/\s*$/, '')}\n\n## 轮次 ${rounds} · ${stamp}\n\n${content}\n`, 'utf8');
  return `已追加 ${rel(root, abs)}（轮次 ${rounds}，${stamp}）`;
}

// ---------------------------------------------------------------------------
// 状态 / 自检 / 提示词片段
// ---------------------------------------------------------------------------
export function status(root) {
  const layout = detectLayout(root);
  const dirs = layerDirs(root);
  const tree = {};
  for (const key of ['T1', 'T2', 'T3', 'T4']) {
    const dir = dirs[key];
    tree[key] = { path: dir ? rel(root, dir) : null, files: dir ? walkMarkdown(dir).length : 0 };
  }
  return {
    root,
    layout: layout.id,
    markers: MARKERS.filter((m) => fs.existsSync(path.join(root, m))),
    layers: tree,
  };
}

export function doctor(root) {
  const lines = ['longterm-memory doctor'];
  let ok = true;
  try {
    const s = status(root);
    lines.push(`项目根: ${s.root}`);
    lines.push(`布局: ${s.layout}`);
    lines.push(`标记: ${s.markers.length ? s.markers.join(', ') : '(无)'}`);
    for (const [key, info] of Object.entries(s.layers)) {
      lines.push(`${key}: ${info.path ?? '(缺失)'} · ${info.files} 个 markdown`);
      if (!info.path) ok = false;
    }
    const briefText = brief(root, { budget: 12000 });
    lines.push(`简报字符数: ${briefText.length}（预算 12000）`);
  } catch (err) {
    ok = false;
    lines.push(`失败: ${err && err.message ? err.message : String(err)}`);
  }
  lines.push(ok ? '结论: 可用' : '结论: 需要先运行 memory_init');
  return lines.join('\n');
}

// 给宿主注入的提示词片段（Codex 的 AGENTS.md 片段、Hermes 的插件说明都引用它）
export function guideText() {
  return [
    '## 长期项目记忆（longterm-memory）',
    '- 会话开始时先调用 memory_brief（DSH 里叫 memory_handoff）读取交接与活跃问题，确认状态再动手。',
    '- 修 bug / 做新功能前先调用 memory_search 检索历史同类问题；命中老问题就续写新方案，不要重新发明。',
    '- 会话结束时用 memory_write 写回 T3（现象/根因/改了什么/怎么验证/遗留风险），并更新 T1 的项目进度交接。',
    '- 需要 T2 原始日志时用 scope=all 回查；不要通读 T2 或 T3。',
    '- 搜索不到就明确说「记忆里没有」，禁止编造历史修复记录。',
  ].join('\n');
}
