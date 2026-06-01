"""
DeepReader Security Hook — 安全守卫

每次文件操作前触发，保护敏感文件不被意外修改或删除。

环境变量来源: Claude Code PreToolUse hook 运行时注入
  - CLAUDE_TOOL_NAME: 触发的工具名 (Read/Write/Edit/Bash)
  - CLAUDE_TOOL_INPUT: JSON 格式的工具参数

局限性: 纯字符串匹配无法防御变量拼接等 shell 转义绕过，
仅作为意外操作的安全网，不替代权限控制。
"""

import json
import os
import re
import sys
from datetime import datetime

# 受保护的路径段（段级匹配，避免子串误报）
PROTECTED_SEGMENTS = [
    # 构建产物
    "bin",
    # 系统目录
    ".git",
    "node_modules",
]

# 递归删除命令模式（正则，已加 \b 词边界）
RECURSIVE_DELETE_PATTERNS = [
    r"\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f\b",
    r"\brmdir\b",
    r"\bfind\s+.*-delete\b",
    r"\bfind\s+.*-exec\s+rm\b",
    r"\bfind\s+.*\bxargs\s+rm\b",
    r"\bgit\s+clean\s+-[a-zA-Z]*d\b",
]

_log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")


def log_block(reason: str, detail: str) -> None:
    os.makedirs(_log_dir, exist_ok=True)
    ts = datetime.now().isoformat()
    with open(os.path.join(_log_dir, "security_guard.log"), "a") as f:
        f.write(f"[{ts}] BLOCKED: {reason} | {detail}\n")


def is_protected(path: str) -> bool:
    abs_path = os.path.normpath(os.path.abspath(path))
    parts = abs_path.split(os.sep)
    # 检查路径中任一段是否匹配受保护目录
    for segment in PROTECTED_SEGMENTS:
        if segment in parts:
            return True
    return False


def has_recursive_delete(command: str) -> bool:
    for pattern in RECURSIVE_DELETE_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return True
    return False


def extract_tool_input(tool: str, raw: str) -> tuple[str, str]:
    """从 JSON 输入中提取路径或命令。返回 (path, command)。"""
    if not raw:
        return ("", "")
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return ("", raw)
    path = data.get("file_path", data.get("path", ""))
    command = data.get("command", "")
    return (path or "", command or "")


def main():
    tool = os.environ.get("CLAUDE_TOOL_NAME", "")
    input_data = sys.stdin.read() if not sys.stdin.isatty() else ""
    command_line = os.environ.get("CLAUDE_TOOL_INPUT", "")

    path, command = extract_tool_input(tool, command_line or input_data)

    # 检查文件读取/写入
    if tool in ("Read", "Write", "Edit"):
        if path and is_protected(path):
            msg = f"[BLOCKED] 禁止访问保护文件 — {path}"
            print(f"⛔ {msg}")
            print("   构建产物 (bin/) 由构建命令生成，不要手动修改。")
            log_block("protected_path", f"tool={tool} path={path}")
            sys.exit(1)

    # 检查递归删除
    if tool in ("Bash", "Terminal", "Execute"):
        if command and has_recursive_delete(command):
            msg = f"[BLOCKED] 禁止递归删除操作 — {command}"
            print(f"⛔ {msg}")
            print("   如需删除文件请逐文件操作。")
            log_block("recursive_delete", f"tool={tool} cmd={command}")
            sys.exit(1)


if __name__ == "__main__":
    main()
