#!/usr/bin/env node
// 技能自带的 CLI 入口（转发到共享实现）。
//
// 技能要能在「没有 MCP 服务器」的宿主里独立工作，所以要自带一份能跑的 CLI。
// 但检索逻辑只能有一份 —— 因此这里只是定位并加载真正的实现：
//   仓库内：<repo>/ports/cli/ltm.mjs        （本文件在 <repo>/skills/longterm-memory/scripts/）
//   打包后：<skill>/scripts/cli/ltm.mjs     （打包脚本会把实现复制进来，保持同级相对结构）
// 也可用环境变量 LTM_CLI 直接钉死路径。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  process.env.LTM_CLI,
  path.join(HERE, 'cli', 'ltm.mjs'),
  path.join(HERE, '..', '..', 'ports', 'cli', 'ltm.mjs'),
  path.join(HERE, '..', '..', '..', 'ports', 'cli', 'ltm.mjs'),
].filter(Boolean);

const found = candidates.find((candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
});

if (!found) {
  process.stderr.write(
    `[ltm] 找不到 CLI 实现。试过：\n  ${candidates.join('\n  ')}\n` +
      `请把 dsh-longterm-memory 仓库放在旁边，或用 LTM_CLI 指向 ports/cli/ltm.mjs。\n`,
  );
  process.exit(1);
}

// 真实现会在加载时读取 argv 并执行（与直接运行 ports/cli/ltm.mjs 等价）
await import(pathToFileURL(found).href);
