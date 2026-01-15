#!/bin/bash
# DeepPDF MCP Server 设置脚本
# 用于确保所有依赖正确安装

set -e

echo "=========================================="
echo "DeepPDF MCP Server 设置"
echo "=========================================="

cd "$(dirname "$0")/.."

echo ""
echo "步骤 1: 安装 pageindex 包（editable 模式）"
uv pip install -e packages/pageindex

echo ""
echo "步骤 2: 安装 deeppdf-mcp-server 包（editable 模式）"
uv pip install -e packages/deeppdf

echo ""
echo "步骤 3: 验证安装"
.venv/bin/python -c "
import nest_asyncio
nest_asyncio.apply()
from deeppdf import server
print('✓ 所有依赖都已正确安装')
"

echo ""
echo "=========================================="
echo "设置完成！"
echo "=========================================="
