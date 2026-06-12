#!/bin/bash
# setup-worktree-symlinks.sh
# 为 worktree 创建 agent 工具目录的符号链接
#
# 用法:
#   ./scripts/setup-worktree-symlinks.sh [worktree_path]
#
# 示例:
#   ./scripts/setup-worktree-symlinks.sh .worktrees/feat/my-feature

set -e

# 获取主仓库根目录
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 获取 worktree 路径
WORKTREE_PATH="${1:-.}"

# 如果是相对路径，转换为绝对路径
if [[ "$WORKTREE_PATH" != /* ]]; then
    WORKTREE_PATH="$(pwd)/$WORKTREE_PATH"
fi

echo "🔗 为 worktree 创建 agent 目录符号链接"
echo "   Worktree: $WORKTREE_PATH"
echo "   主仓库: $REPO_ROOT"
echo ""

# 需要链接的 agent 目录
AGENT_DIRS=(".claude" ".mimocode" ".agents")

for dir in "${AGENT_DIRS[@]}"; do
    SOURCE="$REPO_ROOT/$dir"
    TARGET="$WORKTREE_PATH/$dir"
    
    # 跳过不存在的源目录
    if [ ! -e "$SOURCE" ]; then
        echo "⏭️  跳过 $dir (源目录不存在)"
        continue
    fi
    
    # 如果目标已存在，跳过
    if [ -e "$TARGET" ]; then
        echo "⏭️  跳过 $dir (目标已存在)"
        continue
    fi
    
    # 创建符号链接
    ln -s "$SOURCE" "$TARGET"
    echo "✅ 已链接 $dir"
done

echo ""
echo "✨ 完成！Agent 工具目录已链接到主仓库"
