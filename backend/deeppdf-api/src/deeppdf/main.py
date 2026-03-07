#!/usr/bin/env python3
"""
DeepPDF FastAPI Server
PDF 索引和语义搜索服务
"""

import warnings

# 过滤第三方库的警告
warnings.filterwarnings(
    "ignore", message=".*pynvml package is deprecated.*", category=UserWarning
)

import nest_asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from deeppdf.api.config_routes import router as config_router
from deeppdf.api.file_routes import router as file_router
from deeppdf.api.reading_routes import router as reading_router
from deeppdf.api.routes import router
from deeppdf.api.skills_routes import router as skills_router

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
app.include_router(skills_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
