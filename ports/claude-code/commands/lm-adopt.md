---
description: 把当前项目「收养」为长期项目：建骨架 + 扫描目录生成项目结构草稿 + 写标记
---

调用 MCP 工具 `memory_adopt`（省略 `project_root` 即当前项目）。

它会：生成 T1-T4 骨架（不动已有文件）→ 扫描项目目录写出 `T1-交接/交接文档/项目结构.md` 草稿
→ 写入 `.longterm-memory.json` 与 `.dsh-longterm.json` 两个标记（这样 Claude Code / Codex / Hermes / DSH
四个宿主打开同一项目时，认的是同一份记忆）。

完成后汇报：根目录、新增文件数、结构草稿路径；并提示用户可以编辑 `用户习惯.md` 与 `用户强调.md`，
把常驻上下文打磨成自己的样子（T1 越精炼，每次会话越省 token）。
