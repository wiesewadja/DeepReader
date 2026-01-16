"""
API 路由定义
"""
import logging
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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.post("/index", response_model=IndexResponse)
async def create_index(req: IndexRequest):
    """创建 PDF 索引"""
    logger.info(f"[API] 收到索引请求: {req.path}")

    # 提取 LLM 配置参数
    llm_config = {}
    if req.llm_provider is not None:
        llm_config["llm_provider"] = req.llm_provider
        logger.info(f"[API] 使用 LLM Provider: {req.llm_provider}")
    if req.llm_model is not None:
        llm_config["llm_model"] = req.llm_model
        logger.info(f"[API] 使用 LLM Model: {req.llm_model}")
    if req.deepseek_api_key is not None:
        llm_config["deepseek_api_key"] = req.deepseek_api_key
        logger.debug(f"[API] 收到 DeepSeek API Key")
    if req.openai_api_key is not None:
        llm_config["openai_api_key"] = req.openai_api_key
        logger.debug(f"[API] 收到 OpenAI API Key")
    if req.api_url is not None:
        llm_config["api_url"] = req.api_url
        logger.info(f"[API] 使用自定义 API URL: {req.api_url}")
    if req.max_pages_per_node is not None:
        llm_config["max_pages_per_node"] = req.max_pages_per_node
        logger.info(f"[API] Max Pages Per Node: {req.max_pages_per_node}")
    if req.max_tokens_per_node is not None:
        llm_config["max_tokens_per_node"] = req.max_tokens_per_node
        logger.info(f"[API] Max Tokens Per Node: {req.max_tokens_per_node}")
    if req.if_add_node_summary is not None:
        llm_config["if_add_node_summary"] = req.if_add_node_summary
        logger.info(f"[API] Add Node Summary: {req.if_add_node_summary}")

    result = await index_pdf(req.path, str(settings.base_dir), **llm_config)

    if result["status"] == "error":
        logger.error(f"[API] 索引失败: {result.get('error', 'Unknown error')}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Unknown error")
        )

    logger.info(f"[API] 索引创建成功: {result.get('index_id')}")
    return IndexResponse(**result)


@router.post("/query", response_model=QueryResponse)
async def query_index(req: QueryRequest):
    """查询 PDF 内容"""
    logger.info(f"[API] 收到查询请求: query='{req.query}', index_id='{req.index_id}'")
    result = await query_pdf(
        req.query,
        req.index_id,
        str(settings.base_dir),
        settings.max_results
    )
    logger.info(f"[API] 查询完成: 返回 {len(result.get('results', []))} 个结果")
    return QueryResponse(**result)


@router.get("/indexes", response_model=ListIndexesResponse)
async def list_all_indexes():
    """列出所有索引"""
    logger.info("[API] 收到列出索引请求")
    result = await list_indexes(str(settings.base_dir))
    logger.info(f"[API] 返回 {len(result.get('indexes', []))} 个索引")
    return ListIndexesResponse(**result)


@router.delete("/indexes/{index_id}", response_model=DeleteIndexResponse)
async def delete_index_endpoint(index_id: str):
    """删除索引"""
    logger.info(f"[API] 收到删除索引请求: index_id='{index_id}'")
    result = await delete_index(index_id, str(settings.base_dir))
    logger.info(f"[API] 删除索引结果: {result.get('status')}")
    return DeleteIndexResponse(**result)
