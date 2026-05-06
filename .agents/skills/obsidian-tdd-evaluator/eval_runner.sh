#!/bin/bash
# 自动处理引号转义并执行 Obsidian CLI eval
# 用法: ./eval_runner.sh "console.log(app.vault.getFiles().length)"

if [ -z "$1" ]; then
  echo "Error: No JavaScript code provided."
  exit 1
fi

JS_CODE="$1"
# 使用 EOF 将代码安全地传递给 CLI，避免终端解析报错
obsidian eval code="$(cat <<EOF
$JS_CODE
EOF
)"