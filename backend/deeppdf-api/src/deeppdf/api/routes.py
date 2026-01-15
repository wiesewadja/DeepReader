"""
API 路由定义
"""
from fastapi import APIRouter, HTTPException, status
from .models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    ListIndexesResponse, DeleteIndexResponse
)
import asyncio

router = APIRouter(prefix="/api")

# 导入服务（后续实现）
# from ..services.indexer import index_pdf
# from ..services.querier import query_pdf
# from ..services.manager import list_indexes, delete_index


@router.post("/index", response_model=IndexResponse)
async def create_index(req: IndexRequest):
    """创建 PDF 索引"""
    # TODO: 实现索引逻辑
    return IndexResponse(
        status="pending",
        message="Index creation not yet implemented"
    )


@router.post("/query", response_model=QueryResponse)
async def query_index(req: QueryRequest):
    """查询 PDF 内容"""
    # TODO: 实现查询逻辑
    return QueryResponse(
        status="pending",
        results=[]
    )


@router.get("/indexes", response_model=ListIndexesResponse)
async def list_all_indexes():
    """列出所有索引"""
    # TODO: 实现列表逻辑
    return ListIndexesResponse(
        status="pending",
        indexes=[]
    )


@router.delete("/indexes/{index_id}", response_model=DeleteIndexResponse)
async def delete_index_endpoint(index_id: str):
    """删除索引"""
    # TODO: 实现删除逻辑
    return DeleteIndexResponse(
        status="pending",
        message="Delete not yet implemented"
    )
