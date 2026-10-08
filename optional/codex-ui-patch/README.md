# Codex UI 菜单补丁（可选 / legacy）

**标准 DSH 不需要这个目录。** 只有满足下面两条时才用：

1. 你装的是第三方 UI 包 `@michengai/dsh-codex-ui`；
2. 你希望它的项目三点菜单里也出现「设为长期项目」。

`reapply-codex-patch.mjs` 会往该包的 `lib/client.js` 里注入 5 处改动：菜单项、确认弹窗、
`adoptLongTerm` 实现（调用本插件的 `/dsh-longterm-memory` RPC 通道）、props 与 inject 引用。

```bash
node reapply-codex-patch.mjs
# 或指定路径
CODEX_CLIENT=/path/to/@michengai/dsh-codex-ui/lib/client.js node reapply-codex-patch.mjs
```

注意：

- 该第三方包每次更新都会覆盖补丁，**重跑脚本即可恢复**（脚本幂等，已打过就跳过）。
- 补丁目标字符串随第三方包版本变化；找不到目标时脚本以退出码 1 报出未命中的片段。
- pnpm 用硬链接安装，`node_modules` 里的改动可能在下次装插件时被还原——这属于第三方包的维护成本，
  与本插件的工具能力无关。
