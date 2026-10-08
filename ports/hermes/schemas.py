"""工具 schema（模型看到的部分）。描述保持与 MCP 端口一致，避免两个宿主里模型行为不一致。"""

from __future__ import annotations

ROOT_PARAM = {
    "type": "string",
    "description": "项目根目录（默认从 cwd 向上自动查找 T1-* 或标记文件）",
}


def _obj(properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


TOOL_SCHEMAS: list[dict] = [
    {
        "name": "memory_init",
        "description": "在项目根创建 T1-T4 记忆骨架（幂等，不覆盖已有文件），并写入长期项目标记。首次接入长期项目时调用。",
        "parameters": _obj(
            {
                "project_root": ROOT_PARAM,
                "layout": {"type": "string", "description": "目录命名：cc（默认）或 dsh"},
                "markers": {"type": "string", "description": "标记文件：both（默认）/cc/dsh"},
            }
        ),
    },
    {
        "name": "memory_adopt",
        "description": "把已有项目「收养」为长期项目：建骨架、扫描目录生成项目结构草稿、写标记。",
        "parameters": _obj({"project_root": ROOT_PARAM, "layout": {"type": "string", "description": "cc 或 dsh"}}),
    },
    {
        "name": "memory_brief",
        "description": "会话冷启动：返回 T1 交接层（进度交接 / 当前活跃问题 / 用户强调 / AI 经常踩的坑），受预算截断。新会话开头调用一次。",
        "parameters": _obj(
            {
                "project_root": ROOT_PARAM,
                "budget": {"type": "number", "description": "总字符预算，默认 12000"},
            }
        ),
    },
    {
        "name": "memory_index",
        "description": "只返回记忆的文件清单与标题大纲（不含正文），用极低成本知道「有什么记忆」，再决定是否深入。",
        "parameters": _obj(
            {
                "project_root": ROOT_PARAM,
                "scope": {"type": "string", "description": "T1/T2/T3/T4/hot/all，默认 T3"},
            }
        ),
    },
    {
        "name": "memory_search",
        "description": "在记忆里做 BM25 检索（中文按单字+双字索引，口语也能命中），返回命中的章节片段而非整文件。修 bug / 做新功能前先调用。",
        "parameters": _obj(
            {
                "query": {"type": "string", "description": "检索关键词，可直接用用户的原话"},
                "project_root": ROOT_PARAM,
                "scope": {"type": "string", "description": "hot（默认，T1+T3）/ all（含 T2）/ T1 / T2 / T3 / T4"},
                "limit": {"type": "number", "description": "最多返回多少节，默认 8"},
            },
            ["query"],
        ),
    },
    {
        "name": "memory_slice",
        "description": "按标题或行号从一个大文件里精确取一段，避免整文件读入上下文。",
        "parameters": _obj(
            {
                "file": {"type": "string", "description": "记忆根目录内的相对路径"},
                "heading": {"type": "string", "description": "标题（支持部分匹配）"},
                "lines": {"type": "string", "description": "行范围，如 12-40"},
                "project_root": ROOT_PARAM,
                "max_chars": {"type": "number", "description": "最大字符数，默认 12000"},
            },
            ["file"],
        ),
    },
    {
        "name": "memory_write",
        "description": "把结论写回 T3。同一问题反复出现时续写同一个文件（自动编「第 N 条记录」），不要新建文件。",
        "parameters": _obj(
            {
                "content": {
                    "type": "string",
                    "description": "记录正文，建议含：现象 / 根因 / 改了什么 / 怎么验证 / 遗留风险",
                },
                "title": {"type": "string", "description": "问题点标题（会成为文件名）"},
                "category": {
                    "type": "string",
                    "description": "分类，如 修复bug/游戏机制/NPC相关问题；大类只取 修复bug / 新功能 / 疑问咨询 / 回顾重构",
                },
                "file": {"type": "string", "description": "直接指定相对路径，优先级高于 title"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "关键词（用户原话也写进来，便于日后命中）"},
                "project_root": ROOT_PARAM,
            },
            ["content"],
        ),
    },
    {
        "name": "memory_log",
        "description": "把本轮原始记录追加到 T2 周文件（自动带周号、日期、轮次、时间戳）。人类回溯用，AI 不主动读。",
        "parameters": _obj({"content": {"type": "string", "description": "本轮原始记录"}, "project_root": ROOT_PARAM}, ["content"]),
    },
    {
        "name": "memory_status",
        "description": "返回项目记忆状态：根目录、布局、标记文件、四层文件数。",
        "parameters": _obj({"project_root": ROOT_PARAM}),
    },
    {
        "name": "memory_doctor",
        "description": "自检：四层目录是否齐全、简报是否在预算内，给出「可用 / 需要先 init」的结论。",
        "parameters": _obj({"project_root": ROOT_PARAM}),
    },
    {
        "name": "memory_handoff",
        "description": "memory_brief 的别名（DSH 插件的叫法）。",
        "parameters": _obj({"project_root": ROOT_PARAM, "budget": {"type": "number", "description": "总字符预算，默认 12000"}}),
    },
    {
        "name": "memory_read",
        "description": "memory_slice 的别名（DSH 插件的叫法）。",
        "parameters": _obj(
            {
                "file": {"type": "string", "description": "记忆根目录内的相对路径"},
                "heading": {"type": "string", "description": "标题（支持部分匹配）"},
                "lines": {"type": "string", "description": "行范围，如 12-40"},
                "project_root": ROOT_PARAM,
            },
            ["file"],
        ),
    },
    {
        "name": "memory_list",
        "description": "memory_index 的别名（DSH 插件的叫法）。",
        "parameters": _obj({"project_root": ROOT_PARAM, "scope": {"type": "string", "description": "T1/T2/T3/T4/hot/all"}}),
    },
]
