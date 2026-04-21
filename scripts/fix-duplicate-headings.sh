#!/bin/bash
# 修复 EPUB 导出中的重复标题标记：### ## → ##, ### # → #, ### ### → ###
# 用法: bash scripts/fix-duplicate-headings.sh

DIR="test-vault/DeepReader/思辨与立场"

if [ ! -d "$DIR" ]; then
    echo "目录不存在: $DIR"
    exit 1
fi

fixed=0
for f in "$DIR"/*.md; do
    # 统计该文件需要修复的行数
    count=$(grep -c '^### \{1,3\}#' "$f" 2>/dev/null || true)
    if [ "$count" -gt 0 ]; then
        echo "修复 $f ($count 处)"
        # ### ### title → ### title
        # ### ## title  → ## title
        # ### # title   → # title
        sed -i '' -E 's/^### (#{1,6}) /\1 /g' "$f"
        fixed=$((fixed + count))
    fi
done

echo ""
echo "共修复 $fixed 处重复标题"
