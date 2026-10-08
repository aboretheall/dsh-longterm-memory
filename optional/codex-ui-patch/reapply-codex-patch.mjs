// reapply-codex-patch.mjs — 在 @michengai/dsh-codex-ui 的项目三点菜单里加「设为长期项目」。
// Legacy / optional: only for installs that use the third-party Codex UI.
//
// 为什么需要：该第三方包的 client bundle 更新后会覆盖本补丁，重跑本脚本即可恢复。
// 脚本是幂等的：检测到补丁已存在就直接跳过。
//
// 用法 / Usage:
//   node reapply-codex-patch.mjs
// 可用环境变量 CODEX_CLIENT 覆盖目标文件路径（默认见下）。

import { readFileSync, writeFileSync } from 'node:fs';

const TARGET =
  process.env.CODEX_CLIENT ??
  'C:/Users/<user>/.dsh/profiles/web/node_modules/@michengai/dsh-codex-ui/lib/client.js';

let code = readFileSync(TARGET, 'utf8');

// 幂等：已打过补丁就跳过
if (code.includes('设为长期项目')) {
  console.log('[dsh-longterm-memory] Codex UI 补丁已存在，跳过。');
  process.exit(0);
}

const edits = [
  // 1) CodexWorkspaceTree props 解构加 adoptLongTerm
  [
    'startSession, canDeleteSession, panelActive = false }) {',
    'startSession, canDeleteSession, adoptLongTerm, panelActive = false }) {',
  ],
  // 2) projectMenu 数组加菜单项（在 rename 之前）
  [
    '\t\t\t\t\t{\n\t\t\t\t\t\tid: "rename",',
    '\t\t\t\t\t{\n\t\t\t\t\t\tid: "longterm",\n\t\t\t\t\t\tlabel: "设为长期项目",\n\t\t\t\t\t\ticon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconFolderOpenOutlineMedium, { size: 16 })\n\t\t\t\t\t},\n\t\t\t\t\t{\n\t\t\t\t\t\tid: "rename",',
  ],
  // 3) handleProjectMenuAction 加 longterm 分支（确认弹窗 + 调 adoptLongTerm）
  [
    'if (id === "rename") beginRename("workspace", workspace.workspaceId, workspace.title);\n\t\t\t\tif (id === "pin") {',
    'if (id === "rename") beginRename("workspace", workspace.workspaceId, workspace.title);\n\t\t\t\tif (id === "longterm") {\n\t\t\t\t\tsetMenu(void 0);\n\t\t\t\t\tif (adoptLongTerm !== void 0 && window.confirm(`将「${workspace.title}」设为长期项目？确认后会自动生成记忆结构，AI 将在后续会话中持续交接。`)) {\n\t\t\t\t\t\tadoptLongTerm(workspace.path, workspace.title).catch(() => {});\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tif (id === "pin") {',
  ],
  // 4) apply 里定义 adoptLongTerm（调 RPC）
  [
    'Object.assign(globalThis, { __dcuCurrentSessionId: currentSessionId });\n\t\t\tconst widthStorage = browserStorage();',
    'Object.assign(globalThis, { __dcuCurrentSessionId: currentSessionId });\n\t\t\tconst adoptLongTerm = async (path, title) => {\n\t\t\t\ttry {\n\t\t\t\t\tconst res = await ctx.connection.rpc.call("/dsh-longterm-memory", "memory.adopt", { path, title });\n\t\t\t\t\tif (res && res.ok === true) window.alert("已设为长期项目：记忆结构已生成，AI 会在后续会话中持续交接。");\n\t\t\t\t\telse window.alert("设置失败：" + ((res && res.error && res.error.message) || "未知错误"));\n\t\t\t\t} catch (err) {\n\t\t\t\t\twindow.alert("设置失败：" + (err && err.message ? err.message : String(err)));\n\t\t\t\t}\n\t\t\t};\n\t\t\tconst widthStorage = browserStorage();',
  ],
  // 5) inject 加 adoptLongTerm 引用
  [
    'inject: () => ({\n\t\t\t\t\tarchiveSession,',
    'inject: () => ({\n\t\t\t\t\tadoptLongTerm,\n\t\t\t\t\tarchiveSession,',
  ],
];

for (const [from, to] of edits) {
  if (!code.includes(from)) {
    console.error('[dsh-longterm-memory] 补丁目标未找到，Codex UI 版本可能变了：\n  ' + from.slice(0, 80).replace(/\n/g, '\\n'));
    process.exit(1);
  }
  code = code.replace(from, to);
}

writeFileSync(TARGET, code, 'utf8');
console.log('[dsh-longterm-memory] Codex UI 补丁已应用。');
