#!/usr/bin/env bash
# DeepReader Stop Hook — 验证门（Shell 并行版）
# Build + Lint + Arch-Guard 并行执行，全绿才允许停止。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

run_step() {
    local label="$1"; shift
    local out="$TMPDIR/$label.out"
    local rc="$TMPDIR/$label.rc"
    local t0=$SECONDS
    "$@" >"$out" 2>&1 && echo "0" > "$rc" || echo "$?" > "$rc"
    echo $(( SECONDS - t0 )) > "$TMPDIR/$label.time"
}

echo ""
echo "🔍 DeepReader 验证门"
echo "=================================================="

run_step build npm run build &
run_step lint  npm run lint  &
run_step guard npm run arch-guard &
wait

failures=0
for step in build lint guard; do
    rc=$(cat "$TMPDIR/$step.rc")
    time_s=$(cat "$TMPDIR/$step.time")
    if [ "$rc" = "0" ]; then
        echo "  ✅ $step (${time_s}s)"
    else
        echo "  ❌ $step (${time_s}s)"
        tail -10 "$TMPDIR/$step.out" | sed 's/^/    /'
        failures=$((failures + 1))
    fi
done

echo "=================================================="
if [ "$failures" -eq 0 ]; then
    echo "  ✅ 全部验证通过"
    exit 0
else
    echo "  ❌ $failures 项验证未通过，请修复"
    exit 1
fi
