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

# 同步依赖
echo "同步依赖..."
uv sync > /dev/null 2>&1

# 安装 deeppdf-api 包（editable 模式）
echo "安装 deeppdf-api 包..."
uv pip install -e ./deeppdf-api > /dev/null 2>&1

# 加载环境变量
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 检查并释放 6088 端口
PORT=6088
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "端口 $PORT 已被占用，正在释放..."
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "端口 $PORT 已释放"
fi

# 启动服务器
echo "正在启动服务器..."
echo "服务地址: http://localhost:6088"
echo "API 文档: http://localhost:6088/docs"
uv run uvicorn deeppdf.main:app \
    --host 0.0.0.0 \
    --port 6088 \
    --loop asyncio \
    --reload
