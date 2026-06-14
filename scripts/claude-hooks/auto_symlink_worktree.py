#!/usr/bin/env python3
"""
auto_symlink_worktree.py — 自动为 git worktree 创建 AI 配置 symlink

PostToolUse hook: 当 Agent 执行 `git worktree add` 后，自动调用
scripts/setup-worktree-symlinks.sh 为新生成的 worktree 链接 .agents/.claude/.mimocode。
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.getcwd()
SYMLINK_SCRIPT = os.path.join(ROOT, "scripts", "setup-worktree-symlinks.sh")


def read_stdin():
    try:
        return json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        return None


def extract_worktree_path(command: str) -> str | None:
    """
    从 `git worktree add <path> ...` 命令中提取 worktree 路径。
    支持的格式：
      git worktree add .worktrees/feat-x
      git worktree add .worktrees/feat-x main
      git worktree add -b feat/x .worktrees/feat-x
      git worktree add .worktrees/feat-x -b feat/x main
    """
    # 去掉开头可能的 git 选项，找到 add 子命令后的路径参数
    tokens = command.split()
    try:
        add_idx = tokens.index("add")
    except ValueError:
        return None

    # 跳过 add 后面的选项（以 - 开头）
    i = add_idx + 1
    while i < len(tokens) and tokens[i].startswith("-"):
        # 如果是带参数的选项（如 -b feat/x），跳过两个 token
        if tokens[i] in ("-b", "-B"):
            i += 2
        else:
            i += 1

    if i < len(tokens):
        return tokens[i]
    return None


def main():
    data = read_stdin()
    if not data:
        return

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    if tool_name not in ("Bash", "Terminal", "Execute"):
        return

    command = tool_input.get("command", "")
    if not command:
        return

    # 检查是否是 git worktree add
    if not re.search(r"\bgit\s+worktree\s+add\b", command):
        return

    worktree_path = extract_worktree_path(command)
    if not worktree_path:
        return

    # 转换为绝对路径
    if not os.path.isabs(worktree_path):
        worktree_path = os.path.join(ROOT, worktree_path)
    worktree_path = os.path.normpath(worktree_path)

    if not os.path.isdir(worktree_path):
        print(f"⚠️  [worktree-symlink] 跳过：worktree 目录不存在 {worktree_path}")
        return

    print(f"🔗 [worktree-symlink] 检测到 git worktree add，正在链接 AI 配置: {worktree_path}")

    result = subprocess.run(
        ["bash", SYMLINK_SCRIPT, worktree_path],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )

    if result.returncode == 0:
        print(result.stdout.strip())
    else:
        print(f"❌ [worktree-symlink] 失败:\n{result.stderr.strip()}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 静默失败，不阻断 Agent
        pass
