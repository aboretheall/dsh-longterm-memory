"""longterm-memory — Hermes Agent 原生插件。

设计取舍：**本插件不含检索实现**。记忆引擎（骨架、BM25 中文检索、切片、归档）只有一份，
在 `ports/core/*.mjs`，由 Claude Code / Codex / DSH 三个端口共用；Hermes 这边通过调用
`ports/cli/ltm.mjs`（Node CLI）复用同一份实现。好处：

  · 同一项目无论用哪个宿主打开，读写的是同一份 T1-T4，召回结果一致；
  · 修一处 bug 四个宿主同时受益，不会出现「Claude 版命中了、Hermes 版没命中」。

代价：需要 PATH 上有 `node`（>= 20）。没有 Node 时可以改用 MCP 方式接入：Hermes 的
`config.yaml` 支持 `mcp_servers.<name>`，指向同一个 server.mjs。
"""

from __future__ import annotations

import json
import logging

from .schemas import TOOL_SCHEMAS
from .tools import PLUGIN_DIR, brief_for_session, call_tool, guide_text

log = logging.getLogger("hermes.plugin.longterm_memory")

SLASH_HELP = {
    "lm-brief": "读取长期记忆简报（T1 交接层）",
    "lm-recall": "在长期记忆里检索历史同类问题：/lm-recall 敌人回血",
    "lm-close": "归档本轮结论到 T3/T1 并追加 T2 日志",
    "lm-doctor": "自检长期记忆库（目录是否齐全、简报是否超预算）",
}


def _handler_for(tool_name: str):
    """Hermes 的工具处理函数签名是 (params, **kwargs)。"""

    def handler(params, **kwargs):
        del kwargs
        try:
            return call_tool(tool_name, params or {})
        except Exception as err:  # 工具失败要回给模型，而不是让整轮崩掉
            log.warning("longterm-memory tool %s failed: %s", tool_name, err)
            return json.dumps({"success": False, "error": f"{type(err).__name__}: {err}"})

    return handler


def _command_for(command: str):
    def handler(*args, **kwargs):
        del args
        # 斜杠命令的入参名各家版本可能不同，这里把常见键都收一遍
        raw = kwargs.get("args") or kwargs.get("arguments") or kwargs.get("text") or ""
        if command == "lm-brief":
            return call_tool("memory_brief", {})
        if command == "lm-recall":
            query = raw if isinstance(raw, str) else " ".join(str(a) for a in raw)
            if not query.strip():
                return json.dumps({"success": False, "error": "用法：/lm-recall <关键词>"})
            return call_tool("memory_search", {"query": query})
        if command == "lm-close":
            return json.dumps(
                {
                    "success": True,
                    "instructions": (
                        "请按顺序调用：memory_write（T3，含 现象/根因/改了什么/怎么验证/遗留风险）→ "
                        "memory_log（T2 原始记录）→ memory_write 覆盖更新 T1 的项目进度交接与当前活跃问题。"
                    ),
                },
                ensure_ascii=False,
            )
        if command == "lm-doctor":
            return call_tool("memory_doctor", {})
        return json.dumps({"success": False, "error": f"未知命令 {command}"}, ensure_ascii=False)

    return handler


def _on_session_start(*args, **kwargs):
    """会话开始时把 T1 简报注入上下文；失败一律静默（不能因为记忆没接好就打断会话）。"""
    try:
        text = brief_for_session(kwargs)
        if not text:
            return None
        return {"additional_context": text}
    except Exception as err:  # pragma: no cover - 防御性
        log.debug("session start brief skipped: %s", err)
        return None


def register(ctx):
    registered = []

    # ---- 工具 ----
    for schema in TOOL_SCHEMAS:
        name = schema["name"]
        try:
            ctx.register_tool(
                name=name,
                toolset="longterm_memory",
                schema=schema,
                handler=_handler_for(name),
            )
            registered.append(name)
        except Exception as err:  # 单个工具注册失败不影响其它
            log.warning("register_tool(%s) failed: %s", name, err)

    # ---- 斜杠命令 ----
    for name, description in SLASH_HELP.items():
        try:
            ctx.register_command(name, _command_for(name), description)
        except Exception as err:
            log.warning("register_command(%s) failed: %s", name, err)

    # ---- 会话钩子 ----
    for hook in ("on_session_start",):
        try:
            ctx.register_hook(hook, _on_session_start)
        except Exception as err:
            log.debug("register_hook(%s) skipped: %s", hook, err)

    # ---- 随插件附带的技能 ----
    # 打包版会在插件目录里带一份 skills/longterm-memory（与仓库 skills/ 同源），
    # 注册后模型可以 skill_view("longterm-memory:longterm-memory") 拿到完整流程说明。
    skill_dir = PLUGIN_DIR / "skills" / "longterm-memory"
    if (skill_dir / "SKILL.md").is_file():
        try:
            ctx.register_skill("longterm-memory", str(skill_dir))
            registered.append("skill:longterm-memory")
        except Exception as err:
            log.debug("register_skill skipped: %s", err)

    log.info("longterm-memory: registered %d tools (%s)", len(registered), ", ".join(registered))
