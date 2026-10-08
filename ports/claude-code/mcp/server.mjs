#!/usr/bin/env node
// 仓库内开发用的转发入口。
//
// 真正的 MCP 实现在 ports/mcp/server.mjs，三个宿主共用同一份代码，避免各自复制一套检索逻辑。
// 打包脚本（scripts/pack-ports.ps1）会把 ports/mcp + ports/core 复制进插件包，
// 于是安装后的目录结构是 <插件根>/mcp/server.mjs + <插件根>/core/*.mjs，
// .mcp.json 指向的路径在「仓库内」和「安装后」都成立。
import { startServer } from '../../mcp/server.mjs';

startServer();
