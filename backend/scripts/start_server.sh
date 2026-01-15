#!/bin/bash
# 启动 DeepPDF FastAPI 服务器

set -e

cd "$(dirname "$0")/.."

echo "=========================================="
echo "启动 DeepPDF FastAPI 服务器"
echo "=========================================="

# 检查虚拟环境
if [ ! -d ".venv" ]; then
    echo "错误: 虚拟环境不存在，请先运行: uv sync"
    exit 1
fi

# 加载环境变量
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 启动服务器
echo "正在启动服务器..."
echo "服务地址: http://localhost:6088"
echo "API 文档: http://localhost:6088/docs"
.venv/bin/uvicorn deeppdf.main:app \
    --host 0.0.0.0 \
    --port 6088 \
    --loop asyncio \
    --reload
