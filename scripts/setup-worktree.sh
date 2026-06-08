#!/usr/bin/env bash
set -euo pipefail

# ── DeepReader Worktree Setup ─────────────────────────────────
# Usage: ./scripts/setup-worktree.sh <branch-name> [base-ref]
# Example: ./scripts/setup-worktree.sh feature/citation-flow main

BRANCH="${1:?Usage: setup-worktree.sh <branch-name> [base-ref]}"
BASE="${2:-HEAD}"
WT_DIR=".worktrees"
WT_PATH="$WT_DIR/${BRANCH//\//-}"

# 1. Verify .worktrees is gitignored
if ! git check-ignore -q "$WT_DIR" 2>/dev/null; then
  echo "⚠  $WT_DIR is not gitignored, adding..."
  echo "$WT_DIR/" >> .gitignore
  echo ".claude/worktrees/" >> .gitignore
fi

# 2. Create worktree
echo "── 1/5 Creating worktree: $WT_PATH (base: $BASE)"
git worktree add "$WT_PATH" -b "$BRANCH" "$BASE"

cd "$WT_PATH"

# 3. Install dependencies
echo "── 2/5 Installing dependencies..."
npm install --silent 2>&1 | tail -1

# 4. Build
echo "── 3/5 Building (tsc + esbuild)..."
npm run build 2>&1 | tail -3

# 5. Deploy to test-vault
echo "── 4/5 Deploying to test-vault..."
npm run deploy 2>&1 | tail -3

# 6. Run tests
echo "── 5/5 Running unit tests..."
if npm run test:run 2>&1 | tail -5; then
  TEST_STATUS="✅ PASS"
else
  TEST_STATUS="❌ FAIL"
fi

# Summary
echo ""
echo "════════════════════════════════════════"
echo "  Worktree ready: $(pwd)"
echo "  Branch: $BRANCH"
echo "  Tests: $TEST_STATUS"
echo "════════════════════════════════════════"
