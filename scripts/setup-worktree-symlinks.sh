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

# 规范化路径
WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

echo "🔗 为 worktree 创建 agent 目录符号链接"
echo "   Worktree: $WORKTREE_PATH"
echo "   主仓库: $REPO_ROOT"
echo ""

# 需要链接的 agent 目录
AGENT_DIRS=(".agents" ".claude" ".mimocode" ".kimi-code" ".archon")

# 解析 symlink 的辅助函数
resolve_link() {
	local path="$1"
	if command -v realpath >/dev/null 2>&1; then
		realpath "$path" 2>/dev/null || echo "$path"
	elif readlink -f "$path" >/dev/null 2>&1; then
		readlink -f "$path"
	else
		echo "$path"
	fi
}

for dir in "${AGENT_DIRS[@]}"; do
	SOURCE="$REPO_ROOT/$dir"
	TARGET="$WORKTREE_PATH/$dir"

	# 跳过不存在的源目录
	if [ ! -e "$SOURCE" ]; then
		echo "⏭️  跳过 $dir (源目录不存在)"
		continue
	fi

	# 如果目标是 symlink，先删除（兼容旧 worktree 重新链接）
	if [ -L "$TARGET" ]; then
		rm "$TARGET"
	fi

	# 如果目标已存在且不是 symlink，跳过
	if [ -e "$TARGET" ]; then
		echo "⏭️  跳过 $dir (目标已存在且不是符号链接)"
		continue
	fi

	# 如果主仓库中的源是 symlink，解析到真实路径；否则直接使用
	if [ -L "$SOURCE" ]; then
		SOURCE="$(resolve_link "$SOURCE")"
		if [ ! -e "$SOURCE" ]; then
			echo "⚠️  跳过 $dir (symlink 指向的路径不存在: $SOURCE)"
			continue
		fi
	fi

	# 创建符号链接
	ln -s "$SOURCE" "$TARGET"
	echo "✅ 已链接 $dir -> $SOURCE"
done

echo ""
echo "✨ 完成！Agent 工具目录已链接到 worktree"
