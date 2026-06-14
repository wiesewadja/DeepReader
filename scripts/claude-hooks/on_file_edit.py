#!/usr/bin/env python3
"""
on_file_edit.py — DeepReader 渐进式关卡

PostToolUse hook: Agent 每次编辑/写入 src/ 下的 .ts 文件后，
自动触发分层检查: ESLint(<1s) → tsc 增量(<3s)。

通过 stdout 输出反馈给 Agent（hook 输出会显示给 Agent）。
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.getcwd()
MAX_LINT_TIME = 15  # 秒


def read_stdin():
    try:
        data = json.loads(sys.stdin.read())
        return data
    except (json.JSONDecodeError, EOFError):
        return None


def is_relevant_file(file_path):
    """只检查 src/ 下的 .ts 文件"""
    if not file_path:
        return False
    return file_path.startswith("src/") and file_path.endswith(".ts") and ".test." not in file_path


def run_lint(file_path):
    """对单个文件运行 ESLint，返回 (has_issues, output)"""
    full_path = os.path.join(ROOT, file_path)
    if not os.path.exists(full_path):
        return False, ""

    result = subprocess.run(
        ["npx", "eslint", full_path],
        capture_output=True, text=True, timeout=MAX_LINT_TIME, cwd=ROOT,
    )
    output = (result.stdout or "").strip()
    has_issues = result.returncode != 0 or bool(output)
    return has_issues, output


def main():
    data = read_stdin()
    if not data:
        return

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # 获取文件路径
    file_path = tool_input.get("file_path", "")
    if not is_relevant_file(file_path):
        return

    # ─── Layer 1: ESLint ───
    start = time.time()
    lint_has_issues, lint_output = run_lint(file_path)
    lint_time = time.time() - start

    if lint_has_issues:
        # 统计 warning 和 error 数量
        n_errors = sum(1 for l in lint_output.split("\n") if "  error  " in l)
        n_warnings = sum(1 for l in lint_output.split("\n") if "  warning  " in l)

        if n_errors > 0:
            print(f"\n❌ [Checkpoint] ESLint: {n_errors} errors, {n_warnings} warnings ({file_path}, {lint_time:.1f}s):")
        elif n_warnings <= 3:
            print(f"\n⚠️  [Checkpoint] ESLint: {n_warnings} warnings ({file_path}, {lint_time:.1f}s):")
        else:
            # 超过 3 个 warnings 只显示前 3 个 + 总数
            print(f"\nℹ️  [Checkpoint] ESLint: {n_warnings} warnings ({file_path}, {lint_time:.1f}s)")

        # 最多显示 3 条，避免刷屏
        shown = 0
        for line in lint_output.split("\n"):
            if "warning" in line or "error" in line:
                print(f"    {line.strip()}")
                shown += 1
                if shown >= 3:
                    break
        if n_warnings > 3 or n_errors > 3:
            remaining = (n_warnings + n_errors) - shown
            print(f"    ... 还有 {remaining} 条（运行 npx eslint {file_path} 查看全部）")
        if n_errors > 0:
            print("    → 必须修复 errors")
        elif n_warnings > 5:
            print("    → 建议修复 warnings（可通过 lint:fix 自动修复大部分）")

    # ─── Summary ───
    if not lint_has_issues:
        if lint_time > 2.0:
            print(f"  ✅ [Checkpoint] {file_path} 通过 ({lint_time:.1f}s)")


if __name__ == "__main__":
    try:
        main()
    except subprocess.TimeoutExpired:
        print("  ⚠️  [Checkpoint] 检查超时，跳过")
    except Exception as e:
        # 静默失败——checkpoint 不应阻断 Agent 工作
        pass
