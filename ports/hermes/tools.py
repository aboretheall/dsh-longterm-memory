"""Hermes 侧的工具实现：把工具调用翻译成对共享 Node CLI 的调用。

只做三件事：定位 Node、定位 ltm.mjs、把参数转成命令行。检索与文件布局逻辑一律不在这里重复。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent

# Hermes 的工具调用超时（秒）。检索大库时可能慢一点，别设太小。
DEFAULT_TIMEOUT = 60

# 工具名 → CLI 子命令（含别名）
COMMAND_MAP = {
    "memory_init": "init",
    "memory_adopt": "adopt",
    "memory_brief": "brief",
    "memory_handoff": "brief",
    "memory_index": "index",
    "memory_list": "index",
    "memory_search": "search",
    "memory_slice": "slice",
    "memory_read": "slice",
    "memory_write": "write",
    "memory_log": "log",
    "memory_status": "status",
    "memory_doctor": "doctor",
    "memory_guide": "guide",
}


def _node_executable() -> str:
    explicit = os.environ.get("LTM_NODE")
    if explicit:
        return explicit
    found = shutil.which("node") or shutil.which("node.exe")
    if not found:
        raise RuntimeError(
            "找不到 node。longterm-memory 复用共享的 Node 实现，"
            "请安装 Node >= 20 并确保在 PATH 上（或用 LTM_NODE 指定可执行文件）。"
        )
    return found


def _cli_path() -> str:
    """按「安装后布局」与「仓库内布局」两种可能依次找 ltm.mjs。"""
    explicit = os.environ.get("LTM_CLI")
    candidates = [
        explicit,
        PLUGIN_DIR / "bin" / "ltm.mjs",
        PLUGIN_DIR.parent / "cli" / "ltm.mjs",
        PLUGIN_DIR.parent.parent / "ports" / "cli" / "ltm.mjs",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError(
        "找不到 ltm.mjs。请在插件目录下放 bin/ltm.mjs（打包版），"
        "或用环境变量 LTM_CLI 指向 dsh-longterm-memory/ports/cli/ltm.mjs。"
    )


def _run(args: list[str], timeout: int = DEFAULT_TIMEOUT) -> tuple[int, str, str]:
    proc = subprocess.run(
        [_node_executable(), _cli_path(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _root_args(params: dict) -> list[str]:
    root = params.get("project_root") or params.get("root") or os.environ.get("LTM_PROJECT_ROOT")
    return ["--root", str(root)] if root else []


def _with_content(argv: list[str], content: str) -> list[str]:
    """长正文走临时文件，避免命令行长度限制（Windows 约 32k）。"""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as fh:
        fh.write(content)
        path = fh.name
    return [*argv, "--content-file", path]


def call_tool(name: str, params: dict) -> str:
    """执行一次工具调用，返回 JSON 字符串（Hermes 的 handler 约定）。"""
    command = COMMAND_MAP.get(name)
    if not command:
        return json.dumps({"success": False, "error": f"未知工具 {name}"}, ensure_ascii=False)

    params = params or {}
    argv: list[str] = [command]

    if command == "init":
        if params.get("project_root"):
            argv.append(str(params["project_root"]))
        if params.get("layout"):
            argv += ["--layout", str(params["layout"])]
        if params.get("markers"):
            argv += ["--markers", str(params["markers"])]
    elif command == "adopt":
        if params.get("project_root"):
            argv.append(str(params["project_root"]))
        if params.get("layout"):
            argv += ["--layout", str(params["layout"])]
    elif command == "brief":
        argv += _root_args(params)
        if params.get("budget"):
            argv += ["--budget", str(params["budget"])]
    elif command == "index":
        argv += _root_args(params)
        if params.get("scope"):
            argv += ["--scope", str(params["scope"])]
    elif command == "search":
        query = str(params.get("query") or "").strip()
        if not query:
            return json.dumps({"success": False, "error": "memory_search 需要 query"}, ensure_ascii=False)
        argv += [query, *_root_args(params)]
        if params.get("scope"):
            argv += ["--scope", str(params["scope"])]
        if params.get("limit"):
            argv += ["--limit", str(params["limit"])]
    elif command == "slice":
        target = params.get("file") or params.get("path")
        if not target:
            return json.dumps({"success": False, "error": "memory_slice 需要 file"}, ensure_ascii=False)
        argv += ["--file", str(target), *_root_args(params)]
        if params.get("heading"):
            argv += ["--heading", str(params["heading"])]
        if params.get("lines"):
            argv += ["--lines", str(params["lines"])]
        if params.get("max_chars"):
            argv += ["--max", str(params["max_chars"])]
    elif command == "write":
        content = str(params.get("content") or "")
        if not content:
            return json.dumps({"success": False, "error": "memory_write 需要 content"}, ensure_ascii=False)
        argv += _root_args(params)
        if params.get("title"):
            argv += ["--title", str(params["title"])]
        if params.get("category"):
            argv += ["--category", str(params["category"])]
        if params.get("file"):
            argv += ["--path", str(params["file"])]
        tags = params.get("tags")
        if isinstance(tags, (list, tuple)) and tags:
            argv += ["--tags", ",".join(str(t) for t in tags)]
        argv = _with_content(argv, content)
    elif command == "log":
        content = str(params.get("content") or "")
        if not content:
            return json.dumps({"success": False, "error": "memory_log 需要 content"}, ensure_ascii=False)
        argv += _root_args(params)
        argv = _with_content(argv, content)
    elif command in ("status", "doctor", "guide"):
        argv += _root_args(params)

    try:
        code, out, err = _run(argv)
    except subprocess.TimeoutExpired:
        return json.dumps({"success": False, "error": f"{name} 超时（>{DEFAULT_TIMEOUT}s）"}, ensure_ascii=False)
    except Exception as err:  # noqa: BLE001 - 统一转成模型可读的错误
        return json.dumps({"success": False, "error": f"{type(err).__name__}: {err}"}, ensure_ascii=False)

    if code != 0:
        return json.dumps(
            {"success": False, "error": (err or out).strip() or f"退出码 {code}"},
            ensure_ascii=False,
        )
    return json.dumps({"success": True, "result": out.strip()}, ensure_ascii=False)


def guide_text() -> str:
    code, out, err = _run(["guide"])
    if code != 0:
        raise RuntimeError((err or out).strip())
    return out.strip()


def brief_for_session(kwargs: dict) -> str | None:
    """会话开始钩子用：能拿到简报就返回文本，项目没接入长期记忆则返回 None。"""
    params = {"project_root": kwargs.get("cwd") or kwargs.get("project_root")} if kwargs else {}
    payload = call_tool("memory_brief", {k: v for k, v in params.items() if v})
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not data.get("success"):
        return None
    result = data.get("result") or ""
    if "没有 T1 交接文件" in result or "找不到" in result:
        return None
    return result
