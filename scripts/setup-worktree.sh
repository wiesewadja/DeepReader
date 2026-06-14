#!/usr/bin/env bash
set -euo pipefail

# ── DeepReader Worktree Setup ─────────────────────────────────
# Usage: ./scripts/setup-worktree.sh <branch-name> [base-ref]
# Example: ./scripts/setup-worktree.sh feature/citation-flow main

BRANCH="${1:?Usage: setup-worktree.sh <branch-name> [base-ref]}"
BASE="${2:-HEAD}"
WT_DIR=".worktrees"
WT_PATH="$WT_DIR/${BRANCH//\//-}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Verify .worktrees is gitignored
if ! git check-ignore -q "$WT_DIR" 2>/dev/null; then
  echo "⚠  $WT_DIR is not gitignored, adding..."
  echo "$WT_DIR/" >> .gitignore
fi

# 2. Create worktree
echo "── 1/6 Creating worktree: $WT_PATH (base: $BASE)"
git worktree add "$WT_PATH" -b "$BRANCH" "$BASE"

# 3. Link AI agent tool directories from main repo
echo "── 2/6 Linking AI agent tool directories..."
bash "$REPO_ROOT/scripts/setup-worktree-symlinks.sh" "$REPO_ROOT/$WT_PATH"

cd "$WT_PATH"

# 4. Install dependencies
echo "── 3/6 Installing dependencies..."
npm install --silent 2>&1 | tail -1

# 5. Build
echo "── 4/6 Building (tsc + esbuild)..."
npm run build 2>&1 | tail -3

# 6. Deploy to test-vault
echo "── 5/6 Deploying to test-vault..."
npm run deploy 2>&1 | tail -3

# 7. Run tests
echo "── 6/6 Running unit tests..."
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
