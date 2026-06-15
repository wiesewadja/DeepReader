#!/usr/bin/env bash
set -euo pipefail

# link-ai-configs.sh
# 将 DeepReader 主仓库的 AI 配置目录链接到独立本地仓库
#
# 用法:
#   ./scripts/link-ai-configs.sh [ai-config-repo-path]
#
# 示例:
#   ./scripts/link-ai-configs.sh
#   ./scripts/link-ai-configs.sh /Users/lizhao/workspace/DeepReader-AI-Configs

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_CONFIG_ROOT="${1:-$HOME/workspace/DeepReader-AI-Configs}"

echo "🔗 链接 AI 配置目录到独立仓库"
echo "   DeepReader: $REPO_ROOT"
echo "   AI Configs: $AI_CONFIG_ROOT"
echo ""

if [ ! -d "$AI_CONFIG_ROOT" ]; then
	echo "❌ AI 配置仓库不存在: $AI_CONFIG_ROOT"
	echo ""
	echo "请先在本地创建独立仓库，例如:"
	echo "  mkdir -p $AI_CONFIG_ROOT"
	echo "  cd $AI_CONFIG_ROOT"
	echo "  git init"
	echo ""
	echo "然后将 .agents/ .claude/ .mimocode/ .kimi-code/ .archon/ 迁移过去。"
	exit 1
fi

AGENT_DIRS=(".agents" ".claude" ".mimocode" ".kimi-code" ".archon")

for dir in "${AGENT_DIRS[@]}"; do
	SOURCE="$AI_CONFIG_ROOT/$dir"
	TARGET="$REPO_ROOT/$dir"

	if [ ! -e "$SOURCE" ]; then
		echo "⏭️  跳过 $dir (源目录不存在: $SOURCE)"
		continue
	fi

	# 如果目标是 symlink，先删除
	if [ -L "$TARGET" ]; then
		rm "$TARGET"
		echo "🗑️  已移除旧 symlink: $TARGET"
	fi

	# 如果目标存在且不是 symlink，备份
	if [ -e "$TARGET" ]; then
		BACKUP="$TARGET.backup.$(date +%Y%m%d%H%M%S)"
		mv "$TARGET" "$BACKUP"
		echo "📦 已备份 $dir 到 $BACKUP"
	fi

	ln -s "$SOURCE" "$TARGET"
	echo "✅ 已链接 $dir -> $SOURCE"
done

echo ""
echo "✨ 完成！AI 配置目录已链接到 $AI_CONFIG_ROOT"
