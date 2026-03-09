#!/usr/bin/env python3
"""
DeepPDF FastAPI Server
PDF 索引和语义搜索服务
"""

import logging
import warnings

# 过滤第三方库的警告
warnings.filterwarnings(
    "ignore", message=".*pynvml package is deprecated.*", category=UserWarning
)

# ============================================================
# 日志配置 - 在导入其他模块前配置
# ============================================================
# 设置根日志级别
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

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
app.include_router(file_router)
app.include_router(reading_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
