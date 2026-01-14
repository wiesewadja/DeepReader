#!/bin/bash
# PageIndex 启动脚本 - 使用 uv

# 运行脚本（uv 自动管理依赖）
uv run python /Users/lizhao/workspace/DeepPDF/mcp-server/scripts/run_pageindex.py "$@"
