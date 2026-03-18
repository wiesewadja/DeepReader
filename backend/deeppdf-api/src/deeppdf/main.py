#!/usr/bin/env python3
"""
DeepPDF FastAPI Server
PDF 索引和语义搜索服务
"""

import logging
import warnings
from logging.handlers import RotatingFileHandler
from pathlib import Path
from datetime import datetime

# 过滤第三方库的警告
warnings.filterwarnings(
    "ignore", message=".*pynvml package is deprecated.*", category=UserWarning
)
warnings.filterwarnings(
    "ignore", message=".*No ccache found.*", category=UserWarning
)

# ============================================================
# 日志配置 - 滚轮型日志，最大 100M
# ============================================================

# 日志目录
LOG_DIR = Path(__file__).parent.parent.parent.parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "deeppdf.log"

# 创建格式化器（使用本地时间）
formatter = logging.Formatter(
    fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# 创建滚轮型文件处理器
# maxBytes=100MB, backupCount=5（保留 5 个备份文件）
file_handler = RotatingFileHandler(
    filename=LOG_FILE,
    maxBytes=100 * 1024 * 1024,  # 100MB
    backupCount=5,
    encoding="utf-8",
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

# 创建控制台处理器
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# 配置根日志
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

# 记录日志启动信息
logging.info(f"[日志] 日志文件: {LOG_FILE}")
logging.info(f"[日志] 最大大小: 100MB, 备份数: 5")

# 静默第三方库的 DEBUG 日志
THIRD_PARTY_LOGGERS = [
    "httpcore",      # HTTP 连接日志
    "httpx",         # HTTP 客户端日志
    "openai",        # OpenAI SDK 日志
    "urllib3",       # urllib3 日志
    "asyncio",       # asyncio 日志
    "multipart",     # multipart 解析日志
    "chromadb",      # ChromaDB 日志
]

for logger_name in THIRD_PARTY_LOGGERS:
    logging.getLogger(logger_name).setLevel(logging.WARNING)

# 静默 uvicorn 的 HTTP 访问日志（GET /health, GET /api/indexes 等）
# 这些日志由 uvicorn.access logger 生成
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
# 只在请求出错时才打印（4xx, 5xx）
# 如果想完全禁用，可以设置为 logging.CRITICAL

import nest_asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from deeppdf.api.config_routes import router as config_router
from deeppdf.api.epub_image_routes import router as epub_image_router
from deeppdf.api.file_routes import router as file_router
from deeppdf.api.reading_routes import router as reading_router
from deeppdf.api.routes import router
# 应用 nest_asyncio（PageIndex 需要）
nest_asyncio.apply()

# 创建 FastAPI 应用
app = FastAPI(
    title="DeepPDF API",
    description="PDF 索引和语义搜索服务",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制为具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 根路径
@app.get("/")
async def root():
    """API 根路径"""
    return {
        "message": "DeepPDF API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


# 健康检查
@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "version": "1.0.0"}


# 注册路由
app.include_router(router)
app.include_router(config_router)
app.include_router(epub_image_router)
app.include_router(file_router)
app.include_router(reading_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
