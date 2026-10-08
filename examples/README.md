# 使用配方（可直接复制）

四个宿主、六种形态，最常用的动作都在这里。所有命令假定仓库克隆在 `<REPO>`。

## 1. 只要一个项目能记住东西（不装任何宿主集成）

```bash
cd /path/to/your-project

node <REPO>/ports/cli/ltm.mjs init  .        # 建 T1-T4 骨架 + 写两个标记
node <REPO>/ports/cli/ltm.mjs adopt .        # 或者这一步：顺便扫描目录生成「项目结构.md」

node <REPO>/ports/cli/ltm.mjs brief --root .                       # 会话开头：读交接简报
node <REPO>/ports/cli/ltm.mjs search "敌人回血" --root .            # 动手前：检索历史（用原话）
node <REPO>/ports/cli/ltm.mjs slice --file "T3-分类整理/..." --heading "第 2 条记录" --root .
node <REPO>/ports/cli/ltm.mjs write --root . \
  --title "NPC穿模" --category "修复bug/游戏机制/NPC相关问题" \
  --content "现象：…；根因：…；改了什么：…；怎么验证：…；遗留风险：…"
node <REPO>/ports/cli/ltm.mjs log --root . --content "本轮：改了碰撞层，跑通 3 个用例"
node <REPO>/ports/cli/ltm.mjs doctor --root .                      # 自检
```

长正文用文件传，避免命令行长度限制（Windows 约 32k）：

```bash
node <REPO>/ports/cli/ltm.mjs write --root . --title "登录超时" --category "修复bug/登录" \
  --content-file ./note.md
cat ./note.md | node <REPO>/ports/cli/ltm.mjs log --root . --content-file -
```

## 2. 把「记忆约定」写进宿主的常驻说明

```bash
node <REPO>/ports/cli/ltm.mjs guide >> AGENTS.md      # Codex / 其他读 AGENTS.md 的宿主
node <REPO>/ports/cli/ltm.mjs guide >> CLAUDE.md      # Claude Code
```

这样模型每轮都能看到「会话开头先读简报、动手前先检索、收尾写回」这三条纪律。

## 3. MCP 客户端（Cursor / Zed / 自研 / 任意支持 stdio 的客户端）

```json
{
  "mcpServers": {
    "longterm-memory": {
      "command": "node",
      "args": ["<REPO>/ports/mcp/server.mjs"]
    }
  }
}
```

验证（发一行 JSON 收一行 JSON）：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node <REPO>/ports/mcp/server.mjs
```

## 4. Claude Code

```bash
cp -r <REPO>/ports/claude-code ~/.claude/plugins/longterm-memory     # 或解压 Release 里的 zip
```

- 斜杠命令：`/lm-init` `/lm-brief` `/lm-recall <关键词>` `/lm-close` `/lm-adopt`
- `SessionStart` 钩子：会话开头自动把 T1 简报并入上下文（非记忆项目静默）
- 技能也随包附带，Claude 会在「接着上次」这类话出现时加载它

## 5. Codex

```toml
# ~/.codex/config.toml
[mcp_servers.longterm_memory]
command = "node"
args = ["<REPO>/ports/mcp/server.mjs"]
startup_timeout_sec = 20
```

```bash
# 记忆约定 + 三个自定义提示
cat <REPO>/ports/codex/AGENTS.md.snippet >> ~/.codex/AGENTS.md
mkdir -p ~/.codex/prompts && cp <REPO>/ports/codex/prompts/*.md ~/.codex/prompts/
```

## 6. Hermes Agent

```bash
mkdir -p "$LOCALAPPDATA/hermes/plugins"            # Windows；Unix 用 ~/.hermes/plugins
cp -r <REPO>/ports/hermes "$LOCALAPPDATA/hermes/plugins/longterm-memory"
hermes plugins enable longterm-memory
hermes gateway restart
hermes plugins list | grep longterm                # -> enabled
```

斜杠命令：`/lm-brief` `/lm-recall` `/lm-close` `/lm-doctor`。

## 7. 技能（跨宿主，不需要 MCP）

```bash
node <REPO>/skills/longterm-memory/scripts/install.mjs --list
node <REPO>/skills/longterm-memory/scripts/install.mjs --host claude      # 或 dsh / codex / hermes
node <REPO>/skills/longterm-memory/scripts/install.mjs --dest ~/my/skills/longterm-memory
```

安装器会把真正的 CLI 与引擎复制进目标目录（自包含），并在目标已存在时报错（`--force` 会先备份）。

## 8. CI 里当作守门检查

```yaml
- name: memory self-check
  run: |
    node <REPO>/ports/cli/ltm.mjs init "$GITHUB_WORKSPACE" --markers cc
    node <REPO>/ports/cli/ltm.mjs doctor --root "$GITHUB_WORKSPACE" | grep -q "结论: 可用"
```

也可以只校验「记忆库没坏」：`doctor` 会检查四层目录、标记文件与简报预算。

## 9. 在脚本里调用（Node / Python）

```js
// Node：直接复用引擎，不经过 CLI 子进程
import { brief, search, writeMemory } from '<REPO>/ports/core/index.mjs';
console.log(brief(process.cwd(), { budget: 8000 }));
console.log(search(process.cwd(), '敌人回血', { scope: 'hot' }));
writeMemory(process.cwd(), { title: 'X', category: '其他', content: '…' });
```

```python
# Python：走 CLI（与 Hermes 插件同一条路，避免再实现一遍检索）
import json, subprocess
def ltm(*args):
    out = subprocess.run(['node', '<REPO>/ports/cli/ltm.mjs', *args],
                         capture_output=True, text=True, encoding='utf-8')
    return out.stdout.strip() or out.stderr.strip()

print(ltm('doctor', '--root', '.'))
```

## 10. 打包给自己/团队用

```powershell
powershell -File <REPO>/scripts/pack-skills.ps1    # dist/longterm-memory-skills-v<ver>.zip
powershell -File <REPO>/scripts/pack-ports.ps1     # dist/ 四个宿主包 + zip
npm pack                                           # dsh-longterm-memory-<ver>.tgz（含 ports/ 与 skills/）
```

把 zip 直接发给同事即可：技能包自带 CLI 与引擎，解压后 `node scripts/install.mjs --host <宿主>` 就能装。
