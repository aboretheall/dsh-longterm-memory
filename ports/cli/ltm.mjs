#!/usr/bin/env node
// ports/cli/ltm.mjs — 命令行入口（零依赖）
//
// 不依赖任何 AI 工具也能用；Hermes 的原生 Python 插件也是通过调用它实现工具逻辑：
//   node ports/cli/ltm.mjs init    [项目根]
//   node ports/cli/ltm.mjs brief   [--root 项目根] [--budget 12000]
//   node ports/cli/ltm.mjs index   [--scope T3|T1|T2|T4|all|hot]
//   node ports/cli/ltm.mjs search  "关键词" [--scope hot|all] [--limit 8]
//   node ports/cli/ltm.mjs slice   --file "T3-分类整理/..." [--heading "..." | --lines 12-40]
//   node ports/cli/ltm.mjs write   --title X --category "修复bug/模块" --content "..."
//   node ports/cli/ltm.mjs log     --content "..."
//   node ports/cli/ltm.mjs adopt   [--layout cc|dsh]
//   node ports/cli/ltm.mjs status | doctor | guide

import fs from 'node:fs';
import process from 'node:process';

import {
  adoptProject,
  brief,
  detectLayout,
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

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) flags[key] = true;
        else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

// init / adopt 是「创建记忆」的命令，不能要求项目里已经有记忆根目录；
// 其余命令才需要向上查找（或显式 --root）。
function requireRoot(flags, command) {
  if (typeof flags.root === 'string' && flags.root !== '') return findRoot(process.cwd(), flags.root);
  if (command === 'init' || command === 'adopt') {
    try {
      return findRoot(process.cwd());
    } catch {
      return process.cwd();
    }
  }
  return findRoot(process.cwd());
}

// 正文来源优先级：--content-file（长文本，Hermes 侧走这里）> --content > 位置参数
function contentFrom(flags, positional) {
  const file = flags['content-file'];
  if (typeof file === 'string') {
    if (file === '-') return fs.readFileSync(0, 'utf8');
    return fs.readFileSync(file, 'utf8');
  }
  if (typeof flags.content === 'string') return flags.content;
  return positional.length ? positional.join('\n') : '';
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift() || 'help';
  const { positional, flags } = parseArgs(argv);
  const root = requireRoot(flags, command);
  const out = [];
  const say = (s) => out.push(s);

  switch (command) {
    case 'init': {
      const r = initProject(positional[0] || root, { layout: flags.layout, markers: flags.markers });
      say(`骨架已就绪（根目录：${r.root}，布局：${r.layout}）`);
      say(`新建 ${r.created.length} 个，跳过 ${r.skipped.length} 个；标记：${r.markers.join(', ')}`);
      if (r.created.length) say(r.created.map((f) => `  + ${f}`).join('\n'));
      break;
    }
    case 'adopt': {
      const r = adoptProject(positional[0] || root, { layout: flags.layout, markers: flags.markers });
      say(`已收养项目：${r.root}（布局：${r.layout}）`);
      say(`新建 ${r.created.length} 个骨架文件；项目结构草稿：${r.structure}`);
      break;
    }
    case 'brief':
      say(brief(root, { budget: flags.budget ? Number(flags.budget) : undefined }));
      break;
    case 'index':
      say(indexOutline(root, { scope: flags.scope || 'T3' }));
      break;
    case 'search': {
      const query = positional.join(' ').trim();
      if (!query) throw new Error('search 需要关键词，例如：ltm search "敌人回血"');
      say(search(root, query, {
        scope: flags.scope || 'hot',
        limit: flags.limit ? Number(flags.limit) : undefined,
        excerpt_chars: flags.excerpt ? Number(flags.excerpt) : undefined,
      }));
      break;
    }
    case 'slice':
      say(slice(root, {
        file: flags.file || flags.path || positional[0],
        heading: flags.heading,
        lines: flags.lines,
        max_chars: flags.max ? Number(flags.max) : undefined,
      }));
      break;
    case 'write':
      say(writeMemory(root, {
        title: flags.title,
        category: flags.category,
        path: flags.file || flags.path,
        content: contentFrom(flags, positional),
        tags: flags.tags ? String(flags.tags).split(/[,，]\s*/) : undefined,
      }));
      break;
    case 'log':
      say(logSession(root, { content: contentFrom(flags, positional) }));
      break;
    case 'status':
      say(JSON.stringify(status(root), null, 2));
      break;
    case 'doctor':
      say(doctor(root));
      break;
    case 'layout':
      say(`检测到布局：${detectLayout(root).id}`);
      break;
    case 'guide':
      say(guideText());
      break;
    default:
      say(guideText());
  }

  process.stdout.write(out.join('\n') + '\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`[ltm] ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
