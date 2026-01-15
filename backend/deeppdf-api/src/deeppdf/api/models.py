"""
API 请求/响应模型
"""
from pydantic import BaseModel, Field
from typing import List, Optional


# ========== 请求模型 ==========

class IndexRequest(BaseModel):
    """创建索引请求"""
    path: str = Field(..., description="PDF 文件路径")


class QueryRequest(BaseModel):
    """查询请求"""
    query: str = Field(..., description="查询文本")
    index_id: str = Field(..., description="索引 ID")


# ========== 响应模型 ==========

class IndexResponse(BaseModel):
    """创建索引响应"""
    status: str
    index_id: Optional[str] = None
    node_count: Optional[int] = None
    pdf_name: Optional[str] = None
    indexing_method: Optional[str] = None
    error: Optional[str] = None


class QueryResultItem(BaseModel):
    """查询结果项"""
    text: str
    metadata: dict


class QueryResponse(BaseModel):
    """查询响应"""
    status: str
    results: List[QueryResultItem]


class IndexListItem(BaseModel):
    """索引列表项"""
    id: str
    pdf_name: str
    node_count: int
    created_at: str


class ListIndexesResponse(BaseModel):
    """索引列表响应"""
    status: str
    indexes: List[IndexListItem]


class DeleteIndexResponse(BaseModel):
    """删除索引响应"""
    status: str
    message: Optional[str] = None


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str
