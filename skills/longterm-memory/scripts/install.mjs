#!/usr/bin/env node
// 把本技能安装到指定宿主的技能目录。
//
//   node scripts/install.mjs --list                      # 看四个宿主的落点
//   node scripts/install.mjs --host claude               # 装到 ~/.claude/skills/longterm-memory
//   node scripts/install.mjs --host hermes --category productivity
//   node scripts/install.mjs --dest /custom/skills/longterm-memory
//   node scripts/install.mjs --host codex --dry-run      # 只打印计划，不动文件
//
// 已存在同名技能时会拒绝覆盖，除非加 --force（会先备份成 <目标>.bak-<时间戳>）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(HERE, '..');
const SKILL_NAME = 'longterm-memory';

function home() {
  return os.homedir();
}

function hermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'hermes');
  }
  return path.join(home(), '.hermes');
}

function hostTargets(category = 'productivity') {
  return {
    claude: {
      dir: path.join(home(), '.claude', 'skills', SKILL_NAME),
      note: 'Claude Code：重启会话后生效（skills 目录在启动时扫描）',
    },
    dsh: {
      dir: path.join(home(), '.dsh', 'skills', SKILL_NAME),
      note: 'DSH：技能目录在会话启动时加载；也可用 skills-manager 插件管理',
    },
    codex: {
      dir: path.join(home(), '.codex', 'skills', SKILL_NAME),
      note: 'Codex：与内置 skills/.system 同级放置，重启 Codex 生效',
    },
    hermes: {
      dir: path.join(hermesHome(), 'skills', category, SKILL_NAME),
      note: `Hermes：放在 skills/${category}/ 分类下；用 hermes skills list 确认`,
    },
  };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

// 从仓库安装时，技能目录里没有自带 CLI（它指向 <repo>/ports/cli）。装到别处以后
// 那份引用就断了 —— 所以安装时把真正的 CLI + 引擎复制进目标，让技能变成自包含。
function hydrate(dest) {
  const cliDest = path.join(dest, 'scripts', 'cli', 'ltm.mjs');
  const coreDest = path.join(dest, 'scripts', 'core');
  if (fs.existsSync(cliDest)) return null; // 打包版已经自带

  const cliCandidates = [
    process.env.LTM_CLI,
    path.join(SKILL_SRC, 'scripts', 'cli', 'ltm.mjs'),
    path.join(SKILL_SRC, 'scripts', '..', '..', 'ports', 'cli', 'ltm.mjs'),
    path.join(SKILL_SRC, 'scripts', '..', '..', '..', 'ports', 'cli', 'ltm.mjs'),
  ].filter(Boolean);
  const cliSrc = cliCandidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!cliSrc) return null;

  // 真实现里 CLI 用 ../core/index.mjs 找引擎，层级要保持一致
  const coreSrc = path.join(path.dirname(cliSrc), '..', 'core');
  fs.mkdirSync(path.dirname(cliDest), { recursive: true });
  fs.copyFileSync(cliSrc, cliDest);
  if (fs.existsSync(coreSrc) && !fs.existsSync(coreDest)) copyTree(coreSrc, coreDest);
  return { cliSrc, coreSrc };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const targets = hostTargets(typeof flags.category === 'string' ? flags.category : 'productivity');

  if (flags.list) {
    console.log(`技能源目录: ${SKILL_SRC}`);
    for (const [host, info] of Object.entries(targets)) {
      const exists = fs.existsSync(info.dir) ? ' [已存在]' : '';
      console.log(`  --host ${host.padEnd(7)} -> ${info.dir}${exists}`);
      console.log(`  ${' '.repeat(13)}   ${info.note}`);
    }
    return;
  }

  let dest = typeof flags.dest === 'string' ? path.resolve(flags.dest) : null;
  if (!dest) {
    const host = typeof flags.host === 'string' ? flags.host : null;
    if (!host || !targets[host]) {
      console.error('用法: node scripts/install.mjs --host claude|dsh|codex|hermes [--category <分类>] [--dry-run] [--force]');
      console.error('      node scripts/install.mjs --dest <目录> | --list');
      process.exit(2);
    }
    dest = targets[host].dir;
  }

  if (!fs.existsSync(path.join(SKILL_SRC, 'SKILL.md'))) {
    console.error(`技能源目录缺少 SKILL.md: ${SKILL_SRC}`);
    process.exit(1);
  }

  const exists = fs.existsSync(dest);
  console.log(`源:   ${SKILL_SRC}`);
  console.log(`目标: ${dest}${exists ? '（已存在）' : ''}`);

  if (flags['dry-run']) {
    console.log('[dry-run] 未写入任何文件。');
    return;
  }

  if (exists && !flags.force) {
    console.error('目标已存在同名技能。确认要替换就加 --force（会先备份）。');
    const existing = path.join(dest, 'SKILL.md');
    if (fs.existsSync(existing)) {
      const head = fs.readFileSync(existing, 'utf8').split('\n').slice(0, 3).join('\n');
      console.error(`现有技能开头：\n${head}`);
    }
    process.exit(3);
  }

  if (exists && flags.force) {
    const backup = `${dest}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(dest, backup);
    console.log(`已备份旧版本 -> ${backup}`);
  }

  copyTree(SKILL_SRC, dest);
  const hydrated = hydrate(dest);
  if (hydrated) {
    console.log(`已内置 CLI 与引擎（自包含）：${path.relative(dest, hydrated.cliSrc) ? hydrated.cliSrc : 'packaged'}`);
  }
  console.log('安装完成。');

  const host = Object.entries(targets).find(([, info]) => info.dir === dest);
  if (host) console.log(`提示：${host[1].note}`);
  console.log('验证：node "<目标目录>/scripts/ltm.mjs" doctor --root "<你的项目>"');
}

main();
