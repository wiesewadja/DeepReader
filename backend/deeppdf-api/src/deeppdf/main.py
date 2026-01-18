#!/usr/bin/env python3
"""
DeepPDF FastAPI Server
PDF 索引和语义搜索服务
"""

import nest_asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 应用 nest_asyncio（PageIndex 需要）
nest_asyncio.apply()

# 创建 FastAPI 应用
app = FastAPI(
    title="DeepPDF API",
    description="PDF 索引和语义搜索服务",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
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
        "health": "/health"
    }


# 健康检查
@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "version": "1.0.0"}


# 注册路由
from deeppdf.api.routes import router
from deeppdf.api.config_routes import router as config_router
app.include_router(router)
app.include_router(config_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
