# 工具与 CLI 参数全表

两条路等价：有 MCP 就用工具，没有就用自带 CLI。参数名一致（CLI 用 `--下划线或短横线`）。

## MCP 工具

| 工具 | 必填 | 可选 | 说明 |
| --- | --- | --- | --- |
| `memory_init` | — | `project_root`、`layout`(cc/dsh)、`markers`(both/cc/dsh) | 建 T1-T4 骨架，幂等不覆盖；默认写两个标记 |
| `memory_adopt` | — | `project_root`、`layout` | 建骨架 + 扫描目录生成 `项目结构.md` 草稿 + 写标记 |
| `memory_brief` | — | `project_root`、`budget`(默认 12000) | 读 T1 简报，按预算截断 |
| `memory_index` | — | `project_root`、`scope`(T1/T2/T3/T4/hot/all，默认 T3) | 只回清单+标题，不含正文 |
| `memory_search` | `query` | `project_root`、`scope`(默认 hot)、`limit`(默认 8)、`excerpt_chars`(默认 700) | BM25 检索，只回命中片段 |
| `memory_slice` | `file` | `heading`、`lines`("12-40")、`project_root`、`max_chars` | 按标题/行号取一段 |
| `memory_write` | `content` | `title`+`category` 或 `file`、`tags`、`project_root` | 写 T3；同文件自动续「第 N 条记录」 |
| `memory_log` | `content` | `project_root` | 追加 T2 周文件（自动周号/日期/轮次/时间戳） |
| `memory_status` | — | `project_root` | 返回根目录、布局、标记、四层文件数 |
| `memory_doctor` | — | `project_root` | 自检并给「可用 / 需要先 init」结论 |

DSH 别名：`memory_handoff`=`memory_brief`、`memory_read`=`memory_slice`、`memory_list`=`memory_index`。

## CLI

```bash
node scripts/ltm.mjs init    [项目根] [--layout cc|dsh] [--markers both|cc|dsh]
node scripts/ltm.mjs adopt   [项目根] [--layout cc|dsh]
node scripts/ltm.mjs brief   [--root R] [--budget 12000]
node scripts/ltm.mjs index   [--root R] [--scope T3|T1|T2|T4|all|hot]
node scripts/ltm.mjs search  "关键词" [--root R] [--scope hot|all] [--limit 8] [--excerpt 700]
node scripts/ltm.mjs slice   --file "T3-分类整理/..." [--heading "标题"] [--lines 12-40] [--root R] [--max 12000]
node scripts/ltm.mjs write   --title "问题点" --category "修复bug/模块" --content "..." [--tags a,b] [--root R]
node scripts/ltm.mjs write   --path "T3-分类整理/其他/x.md" --content-file ./note.md [--root R]
node scripts/ltm.mjs log     --content "..." | --content-file -            # 从 stdin 读
node scripts/ltm.mjs status  [--root R]        # JSON
node scripts/ltm.mjs doctor  [--root R]
node scripts/ltm.mjs layout  [--root R]        # 打印识别到的布局
node scripts/ltm.mjs guide                     # 打印使用约定（可贴进 AGENTS.md）
```

长正文建议走 `--content-file <路径>`（Windows 命令行约 32k 上限）；`--content-file -` 从 stdin 读。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `LTM_PROJECT_ROOT` | 钉住记忆根目录（会话 cwd 不在项目里时有用） |
| `LONGTERM_MEMORY_ROOT` | 同上（别名） |
| `LTM_CLI` / `LTM_CORE` / `LTM_NODE` | Hermes 插件与钩子定位 CLI / core / node 时用 |

## 边界

- 检索是**确定性 BM25**（中文单字+双字索引），不是向量检索：同一概念换完全不同的词
  （「穿模」vs「模型穿透」）可能命中不到 —— 解法是在 `tags` 里把用户原话一起写上。
- 只命中中文单字（的/在/不）的文档**不算命中**（噪声抑制）；整个查询就是单字时自动退回全量词表。
- `.md` 文件超过 600 KB 时不做全文检索，只按文件名命中（避免把 T2 周日志拖进上下文）。
- Windows 文件名禁用字符会被视觉等价替换（`->` → `→`），所以 T2 周文件名里是箭头。
