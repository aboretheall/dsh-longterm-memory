// tests/skills.test.mjs — 技能版（跨宿主 Agent Skill）的验收测试
//
// 覆盖：SKILL.md 规范（frontmatter/触发词/描述长度）、引用文件存在、自带 CLI 可独立工作、
// 安装器（--list / --dry-run / --force 保护 / 真装到一个临时目录后能跑）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'longterm-memory');

function run(args, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  assert.ok(match, 'SKILL.md 必须有 YAML frontmatter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

test('SKILL.md 符合 Agent Skills 规范（name/description/license）', async () => {
  const raw = await readFile(join(SKILL, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(raw);
  assert.equal(fm.name, 'longterm-memory', 'name 必须与技能目录同名');
  assert.ok(fm.description && fm.description.length > 40, 'description 必须足够具体');
  assert.ok(fm.description.length <= 1024, 'description 超过 1024 字符会导致部分宿主截断/拒绝');
  assert.equal(fm.license, 'MIT');
});

test('description 带上真实触发词（决定这个技能会不会被加载）', async () => {
  const raw = await readFile(join(SKILL, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(raw);
  for (const trigger of ['接着上次', '以前修过吗', '归档', '省 token']) {
    assert.ok(fm.description.includes(trigger), `description 缺少触发词：${trigger}`);
  }
});

test('SKILL.md 里引用的参考文件都真实存在', async () => {
  const raw = await readFile(join(SKILL, 'SKILL.md'), 'utf8');
  const refs = [...raw.matchAll(/references\/([a-z]+)\.md/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3, 'SKILL.md 应引用三个参考文件');
  for (const name of new Set(refs)) {
    await stat(join(SKILL, 'references', `${name}.md`));
  }
});

test('技能必需文件齐备（SKILL.md + references + scripts）', async () => {
  const entries = await readdir(SKILL);
  for (const required of ['SKILL.md', 'README.md', 'references', 'scripts']) {
    assert.ok(entries.includes(required), `缺少 ${required}`);
  }
  await stat(join(SKILL, 'scripts', 'ltm.mjs'));
  await stat(join(SKILL, 'scripts', 'install.mjs'));
});

test('自带 CLI 能在没有 MCP 的情况下独立工作', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ltm-skill-'));
  try {
    const cli = join(SKILL, 'scripts', 'ltm.mjs');
    const init = await run([cli, 'init', dir]);
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /骨架已就绪/);

    const write = await run([cli, 'write', '--root', dir, '--title', '技能版验证', '--category', '修复bug/技能', '--content', '现象：无']);
    assert.match(write.out, /技能版验证\.md/);

    const search = await run([cli, 'search', '技能版验证', '--root', dir]);
    assert.match(search.out, /技能版验证\.md/);

    const brief = await run([cli, 'brief', '--root', dir]);
    assert.match(brief.out, /项目进度交接/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('安装器：--list 列出四个宿主，--dry-run 不写文件', async () => {
  const installer = join(SKILL, 'scripts', 'install.mjs');
  const list = await run([installer, '--list']);
  assert.equal(list.code, 0, list.err);
  for (const host of ['claude', 'dsh', 'codex', 'hermes']) {
    assert.match(list.out, new RegExp(`--host ${host}`), `--list 缺少 ${host}`);
  }

  const target = await mkdtemp(join(tmpdir(), 'ltm-skill-install-'));
  await rm(target, { recursive: true, force: true });
  try {
    const dry = await run([installer, '--dest', target, '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /dry-run/);
    await assert.rejects(() => stat(target), '--dry-run 不应该创建目录');
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('安装器：装到指定目录后技能可跑；同名冲突需 --force', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ltm-skill-dest-'));
  const target = join(base, 'longterm-memory');
  try {
    const installer = join(SKILL, 'scripts', 'install.mjs');
    const first = await run([installer, '--dest', target]);
    assert.equal(first.code, 0, first.err);
    await stat(join(target, 'SKILL.md'));

    // 再次安装应被拒绝（保护用户已有的同名技能，可能是他自己改过的版本）
    const second = await run([installer, '--dest', target]);
    assert.equal(second.code, 3);
    assert.match(second.err, /--force/);

    // --force 会备份旧版本
    const third = await run([installer, '--dest', target, '--force']);
    assert.equal(third.code, 0, third.err);
    assert.match(third.out, /已备份/);

    // 装出来的技能自带 CLI 应当能跑（仓库内布局下转发到 ports/cli）
    const dir = await mkdtemp(join(tmpdir(), 'ltm-skill-proj-'));
    try {
      const cli = join(target, 'scripts', 'ltm.mjs');
      const init = await run([cli, 'init', dir]);
      assert.equal(init.code, 0, init.err);
      assert.match(init.out, /骨架已就绪/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('打包脚本存在且只依赖 ports 里的实现（不复制第二套引擎）', async () => {
  const script = await readFile(join(ROOT, 'scripts', 'pack-skills.ps1'), 'utf8');
  assert.match(script, /ports\\cli\\ltm\.mjs/);
  assert.match(script, /ports\\core/);
  // 打包版会把实现复制进 scripts\cli + scripts\core，层级必须与 cli 里的 ../core 引用一致
  assert.match(script, /scripts\\cli/);
  assert.match(script, /scripts\\core/);
});

test('技能与插件/MCP 端口共用同一份引擎（不重复实现检索）', async () => {
  const shim = await readFile(join(SKILL, 'scripts', 'ltm.mjs'), 'utf8');
  assert.match(shim, /ports['"],\s*['"]cli['"],\s*['"]ltm\.mjs/);
  assert.doesNotMatch(shim, /BM25|def tokenize/, '技能侧不应复制检索实现');
});
