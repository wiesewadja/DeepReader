"""
DeepReader Stop Hook — 验证门

每次 Claude Code 说"完成"时自动触发。
Build + Test 全绿才允许停止，否则阻塞并输出失败详情。
"""

import subprocess
import sys
import time


def run(cmd: list[str], label: str, timeout: int = 120) -> bool:
    """Run a command, print output, return success."""
    print(f"\n{'='*50}")
    print(f"  ⏳ {label}...")
    print(f"{'='*50}")
    start = time.time()
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd="/Users/lizhao/workspace/DeepReader",
    )
    elapsed = time.time() - start

    if result.returncode == 0:
        print(f"  ✅ {label} 通过 ({elapsed:.1f}s)")
        return True

    print(f"  ❌ {label} 失败 ({elapsed:.1f}s)")
    # 只打印最后 30 行错误信息，避免刷屏
    errors = (result.stderr or "") + (result.stdout or "")
    lines = errors.strip().split("\n")
    tail = "\n".join(lines[-30:])
    print(f"\n--- 错误信息（最后 30 行）---\n{tail}\n")
    return False


def main():
    steps = [
        (["npm", "run", "build"], "TypeScript 编译 (npm run build)"),
        (["npm", "run", "test:run"], "单元测试 (npm run test:run)"),
        (["npm", "run", "lint"], "代码质量 (npm run lint)"),
        (["npm", "run", "arch-guard"], "架构守卫 (npm run arch-guard)"),
    ]

    all_ok = True
    print("\n🔍 DeepReader 验证门")
    print(f"   时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   目录: /Users/lizhao/workspace/DeepReader")

    for cmd, label in steps:
        ok = run(cmd, label)
        if not ok:
            all_ok = False
            break  # 测试失败就不继续了

    print(f"\n{'='*50}")
    if all_ok:
        print("  ✅ 全部验证通过，可以提交")
        print(f"{'='*50}")
        sys.exit(0)
    else:
        print("  ❌ 验证未通过，请修复后再试")
        print(f"{'='*50}")
        sys.exit(1)


if __name__ == "__main__":
    main()
