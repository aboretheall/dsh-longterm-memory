// 清单一致性测试：包名 ⇄ Client 装载 id ⇄ bundle 补丁行 id 必须一致，
// 且 package.json 声明的每个文件都真实存在、locale 是合法 UTF-8 JSON。
// Manifest consistency: the package name, the Client module-loader id and the bundle
// patch row id must agree, and every declared file must exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(rel) {
  return JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
}

test('package.json 是市场可收录的形态', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.name, 'dsh-longterm-memory');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, undefined, '公开包不能带 private');
  assert.ok(pkg.keywords.includes('dsh-plugin'), 'keywords 必须含 dsh-plugin 才能被市场检索到');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.match(pkg.dsh.engines.dsh, /^>=/);
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.repository.url, `git+https://github.com/${'aboretheall'}/dsh-longterm-memory.git`);
  assert.ok(pkg.icon, 'icon 字段决定插件卡片图标');
});

test('files 与 exports 里声明的文件全部存在（icon 也是）', async () => {
  const pkg = await readJson('package.json');
  for (const rel of pkg.files) {
    if (rel.includes('*')) continue; // 通配由 publish 时展开
    await stat(join(ROOT, rel));
  }
  await stat(join(ROOT, pkg.icon));
  assert.equal(pkg.exports['.'], './index.js');
  assert.equal(pkg.exports['./client'], './client.js');
  assert.deepEqual(pkg.exports['./locale/*.json'], './locale/*.json');
});

test('Client 装载 id 与包名一致', async () => {
  const pkg = await readJson('package.json');
  const client = await readFile(join(ROOT, 'client.js'), 'utf8');
  const match = client.match(/__ModuleLoader__\.load\(\{\s*\n?\s*id:\s*'([^']+)'/);
  assert.ok(match, 'client.js 必须通过 window.__ModuleLoader__.load 注册');
  assert.equal(match[1], pkg.name, '装载 id 必须等于包名，否则 Client 半不会挂载');
});

test('bundle 补丁行指向本包，且 config 键与文档一致', async () => {
  const pkg = await readJson('package.json');
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8');
  const nameMatch = patch.match(/^\s*name:\s*(\S+)\s*$/m);
  const idMatch = patch.match(/^\s*-\s*id:\s*(\S+)\s*$/m);
  assert.equal(nameMatch[1], pkg.name);
  assert.equal(idMatch[1], pkg.name);
  for (const key of ['rootDir', 'maxReadChars', 'maxSearchFiles', 'maxSearchLines']) {
    assert.match(patch, new RegExp(`^\\s*${key}:`, 'm'), `补丁 config 缺少 ${key}`);
  }
});

test('Client 半只注册已存在的 Slot，且不 import Harness Client 包', async () => {
  const client = await readFile(join(ROOT, 'client.js'), 'utf8');
  for (const slot of ['settings.section', 'conversation.session.header.utilities', 'sidebar.workspaces.session.menu.item']) {
    assert.match(client, new RegExp(slot.replace(/\./g, '\\.')), `缺少 slot ${slot}`);
  }
  assert.doesNotMatch(client, /@deepseek-ai\/dsh-client-/, '不应 import Harness Client 包');
  assert.doesNotMatch(client, /require\(\s*['"]@deepseek-ai/, '不应 require Harness Client 包');
  // Slot 目录要求 id 带包命名空间前缀：复用宿主 id 会替换那一行
  for (const id of [...client.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])) {
    assert.match(id, /^dsh-longterm-memory/, `注册项 id "${id}" 必须带包名前缀`);
  }
});

test('locale 字典是合法 UTF-8 JSON，且中英双语齐备', async () => {
  const zh = await readJson('locale/zh.json');
  const en = await readJson('locale/en.json');
  assert.ok(zh.meta.title && zh.meta.description);
  assert.ok(en.meta.title && en.meta.description);
  assert.match(zh.meta.title, /[\u4e00-\u9fa5]/, 'zh.json 必须是中文（曾出现乱码）');
  assert.equal(zh.meta.description.includes('\uFFFD'), false, 'zh.json 不得含替换字符');
});

test('Host 半零运行时依赖', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.dependencies, undefined, '零依赖是本插件的卖点之一');
  assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), ['react']);
});
