// ports/core/search.mjs — BM25 检索 + 中文单字/双字索引
//
// 沿用 Claude Code 插件 v1.0.0 的检索行为（同一个用户写同一份记忆，换宿主不该换召回结果）：
//   · 中文按「单字 + 相邻双字 + 三字」建索引 → 口语说法也能命中
//   · 英文/数字按单词切分，长度 >= 2；带 _ - . 的长词额外拆子词
//   · 标题命中额外加权，命中查询词种类越多越靠前
// 宁可有噪声也不漏历史记录：漏掉一个历史修复的代价远大于多一条低分结果。

import { chunkMarkdown, walkMarkdown, layerDirs } from './fsutil.mjs';

const LATIN_RE = /[a-z0-9_][a-z0-9_.+-]*/g;
const CJK_RUN_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+/g;

export function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(LATIN_RE)) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }
  for (const m of lower.matchAll(CJK_RUN_RE)) {
    const run = m[0];
    for (let i = 0; i < run.length; i++) {
      tokens.push(run[i]);
      if (i < run.length - 1) tokens.push(run.slice(i, i + 2));
    }
    if (run.length >= 3) {
      for (let i = 0; i < run.length - 2; i++) tokens.push(run.slice(i, i + 3));
    }
  }
  return tokens;
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

const K1 = 1.2;
const B = 0.75;

export function buildIndex(chunks) {
  const docs = [];
  const df = new Map();
  let totalLen = 0;

  for (const c of chunks) {
    const bodyTokens = tokenize(`${c.headingPath}\n${c.text}`);
    const tf = termFreq(bodyTokens);
    const headTokens = tokenize(c.headingPath);
    for (const t of headTokens) {
      for (let i = 0; i < 2; i++) {
        tf.set(t, (tf.get(t) || 0) + 1);
        bodyTokens.push(t);
      }
    }
    const len = bodyTokens.length || 1;
    totalLen += len;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ ...c, tf, len });
  }

  const avgdl = docs.length ? totalLen / docs.length : 1;
  return { docs, df, avgdl, n: docs.length };
}

function queryTerms(query) {
  const terms = new Set();
  const lower = String(query || '').toLowerCase();
  for (const m of lower.matchAll(LATIN_RE)) {
    const w = m[0];
    if (w.length >= 2) terms.add(w);
    if (w.includes('_') || w.includes('-') || w.includes('.')) {
      for (const part of w.split(/[_\-.]/)) if (part.length >= 2) terms.add(part);
    }
  }
  for (const m of lower.matchAll(CJK_RUN_RE)) {
    const run = m[0];
    if (run.length <= 3) terms.add(run);
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    for (let i = 0; i < run.length; i++) terms.add(run[i]);
  }
  return [...terms];
}

export function searchChunks(index, query, opts = {}) {
  const limit = opts.limit || 8;
  const excerptChars = opts.excerpt_chars || 700;
  const minScore = opts.min_score != null ? opts.min_score : 0;
  const terms = queryTerms(query);
  if (!terms.length) return { hits: [], terms: [] };

  // 中文单字（的/在/不…）会带来大量噪声命中：只命中单字的文档不算命中，
  // 必须至少命中一个「强词」（>=2 字的中文词 / >=2 字符的英文词）。
  // 若整个查询就是单字（例如「坑」），则退回全量词表，保证短查询仍能工作。
  const strongTerms = terms.filter((t) => t.length >= 2);
  const requireStrong = strongTerms.length > 0;

  const scored = [];
  for (const d of index.docs) {
    let score = 0;
    let matched = 0;
    let strongMatched = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const df = index.df.get(t) || 1;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      const denom = f + K1 * (1 - B + (B * d.len) / index.avgdl);
      score += idf * ((f * (K1 + 1)) / denom);
      matched++;
      if (t.length >= 2) strongMatched++;
    }
    if (requireStrong && strongMatched === 0) continue;
    if (score > 0) {
      score = score * (1 + 0.25 * (matched / terms.length));
      scored.push({ ...d, score, matched });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const hits = scored
    .filter((s) => s.score >= minScore)
    .slice(0, limit)
    .map((s) => ({
      file: s.file,
      heading: s.headingPath,
      lines: `${s.startLine}-${s.endLine}`,
      score: Math.round(s.score * 1000) / 1000,
      excerpt:
        s.text.length <= excerptChars
          ? s.text
          : s.text.slice(0, excerptChars) + `\n…[本节共 ${s.text.length} 字符，可用 memory_slice 取全文]`,
    }));

  return { hits, terms: terms.slice(0, 40), total_chunks: index.n };
}

function scopeTargets(root, scope) {
  const dirs = layerDirs(root);
  const targets = [];
  const s = String(scope || 'hot').toUpperCase();
  const want = (key) => s === key || s === 'ALL' || (s === 'HOT' && (key === 'T3' || key === 'T1'));
  if (want('T1') && dirs.T1) targets.push(dirs.T1);
  if (want('T2') && dirs.T2) targets.push(dirs.T2);
  if (want('T3') && dirs.T3) targets.push(dirs.T3);
  if (want('T4') && dirs.T4) targets.push(dirs.T4);
  return targets;
}

export function buildIndexForScope(root, scope) {
  const chunks = [];
  for (const d of scopeTargets(root, scope)) {
    for (const f of walkMarkdown(d)) chunks.push(...chunkMarkdown(f, root));
  }
  return buildIndex(chunks);
}

export function headingOutline(root, scope) {
  const rows = [];
  for (const d of scopeTargets(root, scope)) {
    for (const f of walkMarkdown(d)) {
      const chunks = chunkMarkdown(f, root);
      const heads = chunks.map((c) => `${'  '.repeat(Math.max(0, c.level - 1))}${c.heading}`);
      rows.push({ file: chunks[0] ? chunks[0].file : f, headings: heads });
    }
  }
  return rows;
}
