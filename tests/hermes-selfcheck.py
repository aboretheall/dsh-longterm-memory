"""Hermes 插件自检（不启动 Hermes，也不需要 Hermes 运行时）。

用假 ctx 走一遍 register()，确认：
  1. 插件能被 Python 正常导入（含 3.9 这类老解释器）；
  2. 工具 / 斜杠命令 / 钩子都注册成功；
  3. 工具真的能跑通（本脚本会建一个临时项目 → memory_init → memory_doctor）。

用法：
    python tests/hermes-selfcheck.py [插件目录]      # 默认 ports/hermes，也可指向 dist/hermes/longterm-memory
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def load_plugin(plugin_dir: Path):
    pkg = "hermes_ltm_plugin"
    spec = importlib.util.spec_from_file_location(
        pkg, plugin_dir / "__init__.py", submodule_search_locations=[str(plugin_dir)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[pkg] = module
    spec.loader.exec_module(module)
    return module


class FakeCtx:
    """只实现插件用到的那几个 ctx 方法。"""

    def __init__(self):
        self.tools = {}
        self.commands = {}
        self.hooks = {}

    def register_tool(self, name=None, toolset=None, schema=None, handler=None, **kwargs):
        del toolset, schema, kwargs
        self.tools[name] = handler
        return handler

    def register_command(self, name, handler, description=None, **kwargs):
        del description, kwargs
        self.commands[name] = handler
        return handler

    def register_hook(self, name, callback, **kwargs):
        del kwargs
        self.hooks.setdefault(name, []).append(callback)
        return callback


def main() -> int:
    plugin_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / "ports" / "hermes"
    if not (plugin_dir / "__init__.py").is_file():
        print(f"[fail] 找不到插件: {plugin_dir}")
        return 1

    module = load_plugin(plugin_dir)
    ctx = FakeCtx()
    module.register(ctx)

    problems = []
    if len(ctx.tools) < 13:
        problems.append(f"工具数偏少: {len(ctx.tools)}")
    for required in ("memory_init", "memory_brief", "memory_search", "memory_slice", "memory_write", "memory_log", "memory_doctor"):
        if required not in ctx.tools:
            problems.append(f"缺少工具 {required}")
    for command in ("lm-brief", "lm-recall", "lm-close", "lm-doctor"):
        if command not in ctx.commands:
            problems.append(f"缺少斜杠命令 /{command}")

    workdir = Path(tempfile.mkdtemp(prefix="ltm-hermes-"))
    try:
        init = json.loads(ctx.tools["memory_init"]({"project_root": str(workdir)}))
        if not init.get("success"):
            problems.append(f"memory_init 失败: {init.get('error')}")
        doctor = json.loads(ctx.tools["memory_doctor"]({"project_root": str(workdir)}))
        if not doctor.get("success"):
            problems.append(f"memory_doctor 失败: {doctor.get('error')}")
        else:
            text = doctor.get("result", "")
            for needle in ("T1:", "T2:", "T3:", "T4:"):
                if needle not in text:
                    problems.append(f"doctor 输出缺少 {needle}")
        search = json.loads(ctx.tools["memory_search"]({"query": "不存在的词汇zzz", "project_root": str(workdir)}))
        if not search.get("success"):
            problems.append(f"memory_search 失败: {search.get('error')}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(f"plugin : {plugin_dir}")
    print(f"python : {sys.version.split()[0]}")
    print(f"tools  : {len(ctx.tools)} -> {', '.join(sorted(ctx.tools)[:6])} ...")
    print(f"cmds   : {', '.join(sorted(ctx.commands))}")
    print(f"hooks  : {', '.join(sorted(ctx.hooks)) or '(none)'}")
    if problems:
        print("[fail] " + "; ".join(problems))
        return 1
    print("[ok] Hermes plugin self-check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
