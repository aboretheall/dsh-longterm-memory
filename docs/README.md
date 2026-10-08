# 文档索引

| 文档 | 内容 |
| --- | --- |
| [README.md](../README.md) | 项目主页（中文）：功能总览、六种形态、快速开始、工具表、工作原理 |
| [README.en.md](../README.en.md) | English mirror of the project home page |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更（新增 / 变更 / 验证） |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献指南与项目硬约束 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构：四种形态的职责划分、RPC 协议、数据流、扩展点、已知取舍 |
| [COMPATIBILITY.md](COMPATIBILITY.md) | 兼容性矩阵：宿主版本、服务/Slot 依赖、工具名对照、与旧版本共存 |
| [market-entry.yml](market-entry.yml) | 提交到插件市场的目录条目（awesome-dsh-plugin PR 用） |
| [../ports/README.md](../ports/README.md) | 多宿主端口总览与打包说明 |
| [../ports/claude-code/README.md](../ports/claude-code/README.md) | Claude Code 插件包：安装、命令、钩子、验证 |
| [../ports/codex/README.md](../ports/codex/README.md) | Codex 接入：config.toml、AGENTS.md、自定义提示 |
| [../ports/hermes/README.md](../ports/hermes/README.md) | Hermes 原生插件：安装、启用、工具、斜杠命令、钩子 |
| [../skills/longterm-memory/README.md](../skills/longterm-memory/README.md) | 技能版：四宿主安装器、包内容、与插件/MCP 的关系 |
| [../skills/longterm-memory/SKILL.md](../skills/longterm-memory/SKILL.md) | 技能主文件（模型实际读的流程与纪律） |
| [../skills/longterm-memory/references/tools.md](../skills/longterm-memory/references/tools.md) | 工具与 CLI 参数全表 |
| [../skills/longterm-memory/references/layout.md](../skills/longterm-memory/references/layout.md) | 目录结构与 cc/dsh 双布局识别规则 |
| [../skills/longterm-memory/references/faq.md](../skills/longterm-memory/references/faq.md) | 常见问题与边界 |
| [../examples/README.md](../examples/README.md) | 可直接复制的使用配方（CLI / MCP / 各宿主 / CI） |

## 该从哪里开始

| 你想做的事 | 先读 |
| --- | --- |
| 只是想让项目"记住东西" | [README 快速开始](../README.md#快速开始) 的第 0 节 |
| 在某个宿主里装起来 | 上面表格里对应宿主的 README |
| 理解为什么这样设计 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 判断能不能用在你的环境 | [COMPATIBILITY.md](COMPATIBILITY.md) |
| 改代码 / 提 PR | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| 想知道「记忆该怎么写」 | [SKILL.md](../skills/longterm-memory/SKILL.md) 与 [faq.md](../skills/longterm-memory/references/faq.md) |
