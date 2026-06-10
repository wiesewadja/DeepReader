"""
DeepReader Stop Hook — 验证门（并行版）

每次 Claude Code 说"完成"时自动触发。
Build + Test + Lint + Arch-Guard 并行执行，全绿才允许停止。
"""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.getcwd()


def run(cmd: list[str], label: str, timeout: int = 120) -> tuple[str, bool, float, str]:
    """Run a command, return (label, success, elapsed, output)."""
    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=ROOT,
        )
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        return (label, False, elapsed, f"超时 ({timeout}s)")

    elapsed = time.time() - start
    errors = (result.stderr or "") + (result.stdout or "")
    lines = errors.strip().split("\n")
    tail = "\n".join(lines[-15:])

    if result.returncode == 0:
        return (label, True, elapsed, "")
    else:
        return (label, False, elapsed, tail)


def main():
    steps = [
        (["npm", "run", "build"], "TypeScript 编译 (npm run build)"),
        (["npm", "run", "test:run"], "单元测试 (npm run test:run)"),
        (["npm", "run", "lint"], "代码质量 (npm run lint)"),
        (["npm", "run", "arch-guard"], "架构守卫 (npm run arch-guard)"),
    ]

    print(f"\n🔍 DeepReader 验证门（并行模式）")
    print(f"   时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   目录: {ROOT}")
    print(f"{'='*50}")

    # 并行执行所有验证
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(run, cmd, label): label for cmd, label in steps}
        for future in as_completed(futures):
            label, ok, elapsed, output = future.result()
            icon = "✅" if ok else "❌"
            print(f"  {icon} {label} ({elapsed:.1f}s)")
            results.append((label, ok, elapsed, output))

    # 汇总
    failures = [(label, output) for label, ok, _, output in results if not ok]

    print(f"\n{'='*50}")
    if not failures:
        total = sum(e for _, _, e, _ in results)
        wall = max(e for _, _, e, _ in results)
        print(f"  ✅ 全部验证通过（总耗时 {wall:.1f}s，串行需 {total:.1f}s）")
        print(f"{'='*50}")
        sys.exit(0)
    else:
        print("  ❌ 验证未通过：")
        for label, output in failures:
            print(f"\n  --- {label} ---")
            for line in output.split("\n")[-10:]:
                if line.strip():
                    print(f"    {line}")
        print(f"\n{'='*50}")
        print("  请修复后再试")
        sys.exit(1)


if __name__ == "__main__":
    main()
