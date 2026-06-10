#!/usr/bin/env bash
# DeepReader Security Hook — Shell 版本（避免 Python 启动开销）
# 每次 PreToolUse 触发，保护敏感文件不被意外修改或删除。

set -euo pipefail

TOOL="${CLAUDE_TOOL_NAME:-}"

# 读取输入：优先环境变量，回退 stdin
INPUT="${CLAUDE_TOOL_INPUT:-}"
if [[ -z "$INPUT" && ! -t 0 ]]; then
    INPUT=$(cat 2>/dev/null || true)
fi

# 提取 file_path / command（简单 sed，无 jq 依赖）
file_path=""
command=""
if [[ -n "$INPUT" ]]; then
    file_path=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    [[ -z "$file_path" ]] && file_path=$(echo "$INPUT" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    command=$(echo "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
fi

# ─── 文件访问保护 ───
if [[ "$TOOL" == "Read" || "$TOOL" == "Write" || "$TOOL" == "Edit" ]]; then
    if [[ -n "$file_path" ]]; then
        case "$file_path" in
            */.git/*|*/.git|*/bin/*|*/bin|*/node_modules/*|*/node_modules)
                echo "⛔ [BLOCKED] 禁止访问保护文件 — $file_path"
                echo "   构建产物 (bin/) 由构建命令生成，不要手动修改。"
                exit 1
                ;;
        esac
    fi
fi

# ─── 递归删除保护 ───
if [[ "$TOOL" == "Bash" || "$TOOL" == "Terminal" || "$TOOL" == "Execute" ]]; then
    if [[ -n "$command" ]]; then
        if echo "$command" | grep -qE '\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f\b|\brmdir\b|\bfind\s+.*-delete\b|\bfind\s+.*-exec\s+rm\b|\bfind\s+.*\bxargs\s+rm\b|\bgit\s+clean\s+-[a-zA-Z]*d\b'; then
            echo "⛔ [BLOCKED] 禁止递归删除操作 — $command"
            echo "   如需删除文件请逐文件操作。"
            exit 1
        fi
    fi
fi

exit 0
