// ports/core/fsutil.mjs — 文件与布局工具（零第三方依赖）
//
// 关键设计：同一项目只保留一份记忆。既有两种命名方案都要认得：
//   cc  : T1-交接 / T2-全日志 / T3-分类整理 / T4-项目          标记 .longterm-memory.json
//   dsh : T1-交接文件夹 / T2-全日志记录文件夹 / T3-日志分级整理文件夹 / T4-项目目录文件夹
//                                                            标记 .dsh-longterm.json
// 端口（Claude Code / Codex / Hermes）与 DSH 插件共用同一份 T1-T4，靠 detectLayout 自动识别，
// 不会因为换了宿主就凭空多出一套记忆目录。

import fs from 'node:fs';
import path from 'node:path';

export const LAYOUTS = {
  cc: {
    id: 'cc',
    T1: 'T1-交接',
    T2: 'T2-全日志',
    T3: 'T3-分类整理',
    T4: 'T4-项目',
    marker: '.longterm-memory.json',
  },
  dsh: {
    id: 'dsh',
    T1: 'T1-交接文件夹',
    T2: 'T2-全日志记录文件夹',
    T3: 'T3-日志分级整理文件夹',
    T4: 'T4-项目目录文件夹',
    marker: '.dsh-longterm.json',
  },
};

export const MARKERS = [LAYOUTS.cc.marker, LAYOUTS.dsh.marker];
export const DEFAULT_LAYOUT = 'cc';

const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

export function isCJK(ch) {
  return CJK_RE.test(ch);
}

// 识别项目当前使用的布局：
//   1. 读标记文件里的 layout 字段（端口默认会同时写两个标记，所以要以内容为准，不能只看哪个文件在）
//   2. 看已存在的 T1-* 目录名（T1-交接 vs T1-交接文件夹）
//   3. 回落到默认布局
export function detectLayout(root, fallback = DEFAULT_LAYOUT) {
  for (const id of Object.keys(LAYOUTS)) {
    const markerPath = path.join(root, LAYOUTS[id].marker);
    if (!fs.existsSync(markerPath)) continue;
    try {
      const parsed = JSON.parse(readTextFile(markerPath));
      if (parsed && typeof parsed.layout === 'string' && LAYOUTS[parsed.layout]) {
        return LAYOUTS[parsed.layout];
      }
    } catch {
      /* 标记文件坏了就往下看目录 */
    }
    return LAYOUTS[id];
  }
  const t1 = layerDir(root, 'T1');
  if (t1) {
    const name = path.basename(t1);
    for (const id of Object.keys(LAYOUTS)) {
      if (name === LAYOUTS[id].T1) return LAYOUTS[id];
    }
    // 前缀是 T1- 但名字不认识：沿用 cc 目录命名，避免再开一套
    return LAYOUTS[fallback];
  }
  return LAYOUTS[fallback];
}

export function findRoot(startDir, explicit) {
  if (explicit) {
    const abs = path.resolve(explicit);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new Error(`project_root 不是一个存在的目录: ${abs}`);
    }
    return abs;
  }
  for (const envKey of ['LTM_PROJECT_ROOT', 'LONGTERM_MEMORY_ROOT']) {
    if (process.env[envKey]) {
      const abs = path.resolve(process.env[envKey]);
      if (fs.existsSync(abs)) return abs;
    }
  }
  let dir = path.resolve(startDir || process.cwd());
  const seen = [];
  for (;;) {
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    if (layerDir(dir, 'T1')) return dir;
    seen.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `找不到长期记忆项目根目录。已向上查找: ${seen.join(' -> ')}\n` +
      `解决办法(三选一): 在项目根目录调用 memory_init / 传 project_root 参数 / 设置环境变量 LTM_PROJECT_ROOT`,
  );
}

export function layerDir(root, key) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const upper = key.toUpperCase();
  const hit = entries.find((e) => e.isDirectory() && e.name.toUpperCase().startsWith(upper));
  return hit ? path.join(root, hit.name) : null;
}

export function layerDirs(root) {
  return {
    T1: layerDir(root, 'T1'),
    T2: layerDir(root, 'T2'),
    T3: layerDir(root, 'T3'),
    T4: layerDir(root, 'T4'),
  };
}

export function readTextFile(abs) {
  return fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
}

export function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function walkMarkdown(dir, opts = {}) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const skip = new Set(opts.skipDirs || ['node_modules', '.git', '.obsidian', 'dist', 'build', '.next']);
  const maxFiles = opts.maxFiles || 5000;
  const stack = [dir];
  while (stack.length && out.length < maxFiles) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        stack.push(abs);
      } else if (e.isFile() && /\.(md|markdown|txt)$/i.test(e.name)) {
        out.push(abs);
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out.sort();
}

// 把 markdown 按标题切成 chunk。返回 { heading, level, headingPath, startLine, endLine, text }
export function chunkMarkdown(abs, root) {
  const raw = readTextFile(abs);
  const lines = raw.split(/\r?\n/);
  const chunks = [];
  let bodyStart = 0;

  if (lines[0] && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        bodyStart = i + 1;
        break;
      }
    }
  }

  const stack = [];
  let cur = null;
  const push = (endIdx) => {
    if (!cur) return;
    const text = cur.lines.join('\n').trim();
    if (text) {
      chunks.push({
        file: rel(root, abs),
        heading: cur.heading,
        level: cur.level,
        headingPath: cur.headingPath,
        startLine: cur.startLine,
        endLine: endIdx,
        text,
      });
    }
    cur = null;
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) {
      push(i);
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: m[2].trim() });
      cur = {
        heading: m[2].trim(),
        level,
        headingPath: stack.map((s) => s.text).join(' > '),
        startLine: i + 1,
        lines: [],
      };
    } else if (cur) {
      cur.lines.push(lines[i]);
    } else if (lines[i].trim()) {
      cur = { heading: '(顶部)', level: 0, headingPath: '(顶部)', startLine: i + 1, lines: [] };
      cur.lines.push(lines[i]);
    }
  }
  push(lines.length);
  return chunks;
}

// 读取文件但不超过 maxChars，超出则截断并标注
export function readCapped(abs, maxChars) {
  const raw = readTextFile(abs);
  if (raw.length <= maxChars) return { text: raw, truncated: false, total: raw.length };
  return {
    text: raw.slice(0, maxChars) + `\n\n…[已截断，原文件共 ${raw.length} 字符]`,
    truncated: true,
    total: raw.length,
  };
}

export function ensureDir(abs) {
  fs.mkdirSync(abs, { recursive: true });
}

export function writeFileIfChanged(abs, content) {
  ensureDir(path.dirname(abs));
  if (fs.existsSync(abs)) {
    const old = readTextFile(abs);
    if (old === content) return false;
  }
  fs.writeFileSync(abs, content, 'utf8');
  return true;
}

export function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { isoYear: d.getUTCFullYear(), week };
}

export function weekRange(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay() || 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return [mon, sun];
}

export function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
}

export function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Windows 文件名禁字符: < > : " / \ | ? *
// 先用视觉等价字符替换箭头，保证 "A->B" 这种格式仍然可读，再做兜底净化。
export function sanitizeFileName(name) {
  return String(name)
    .replace(/->/g, '→')
    .replace(/<-/g, '←')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

export function safeName(name) {
  const cleaned = sanitizeFileName(name).slice(0, 120).trim();
  return cleaned || 'untitled';
}

// 记忆根目录内的相对路径净化：拒绝绝对路径与 .. 越界
export function safeRelPath(p) {
  const raw = String(p || '').replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('只允许记忆根目录内的相对路径，不接受绝对路径');
  }
  const parts = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) throw new Error('路径越出记忆根目录');
      parts.pop();
      continue;
    }
    parts.push(safeName(seg));
  }
  if (parts.length === 0) throw new Error('路径不能为空');
  return parts.join(path.sep);
}
