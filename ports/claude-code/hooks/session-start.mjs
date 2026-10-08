#!/usr/bin/env node
// ports/claude-code/hooks/session-start.mjs
//
// SessionStart 钩子：会话开始时把 T1 简报打给 Claude Code（stdout 会被并入上下文）。
// 找不到记忆根目录时保持安静 —— 没接入长期记忆的项目不该被这个钩子打扰。
//
// 路径解析对「仓库内开发」和「安装后的插件包」两种布局都成立：
//   仓库内   hooks/ 的上一级是 ports/claude-code，core 在 ../../core
//   安装后   hooks/ 的上一级是插件根，core 在 ../core
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function loadCore() {
  const candidates = [
    process.env.LTM_CORE,
    path.join(HERE, '..', 'core', 'index.mjs'),
    path.join(HERE, '..', '..', 'core', 'index.mjs'),
    path.join(HERE, '..', '..', '..', '..', 'ports', 'core', 'index.mjs'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  return null;
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (raw += d));
    process.stdin.on('end', () => resolve(raw));
    setTimeout(() => resolve(raw), 1500);
  });
}

async function main() {
  const core = await loadCore();
  if (!core) return; // 静默：装错目录不该污染会话

  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let root;
  try {
    root = core.findRoot(cwd);
  } catch {
    return; // 不是长期记忆项目 → 不输出任何东西
  }

  try {
    const text = core.brief(root, { budget: 8000, per_file: 3000 });
    const guide = core.guideText();
    process.stdout.write(
      `[longterm-memory] 已加载项目记忆（根目录：${root}）\n\n${text}\n\n${guide}\n`,
    );
  } catch (err) {
    process.stderr.write(`[longterm-memory] 读取简报失败: ${err && err.message ? err.message : String(err)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[longterm-memory] hook 异常: ${err && err.stack ? err.stack : String(err)}\n`);
});
