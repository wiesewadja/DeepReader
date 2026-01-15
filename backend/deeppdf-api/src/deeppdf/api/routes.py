"""
API 路由定义
"""
from fastapi import APIRouter, HTTPException, status
from .models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    ListIndexesResponse, DeleteIndexResponse
)
from ..services.indexer import index_pdf
from ..services.querier import query_pdf
from ..services.manager import list_indexes, delete_index
from ..config import settings

router = APIRouter(prefix="/api")


@router.post("/index", response_model=IndexResponse)
async def create_index(req: IndexRequest):
    """创建 PDF 索引"""
    result = await index_pdf(req.path, str(settings.base_dir))

    if result["status"] == "error":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Unknown error")
        )

    return IndexResponse(**result)


@router.post("/query", response_model=QueryResponse)
async def query_index(req: QueryRequest):
    """查询 PDF 内容"""
    result = await query_pdf(
        req.query,
        req.index_id,
        str(settings.base_dir),
        settings.max_results
    )
    return QueryResponse(**result)


@router.get("/indexes", response_model=ListIndexesResponse)
async def list_all_indexes():
    """列出所有索引"""
    result = await list_indexes(str(settings.base_dir))
    return ListIndexesResponse(**result)


@router.delete("/indexes/{index_id}", response_model=DeleteIndexResponse)
async def delete_index_endpoint(index_id: str):
    """删除索引"""
    result = await delete_index(index_id, str(settings.base_dir))
    return DeleteIndexResponse(**result)
