#!/bin/bash
# PDF 索引测试脚本 - 使用 uv

# 运行测试脚本（uv 自动管理依赖）
uv run python /Users/lizhao/workspace/DeepPDF/mcp-server/scripts/test_pdf_indexing.py "$@"
