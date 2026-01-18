"""
API 路由定义
"""
import asyncio
import logging
import time
from typing import Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Request
from .models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    ListIndexesResponse, DeleteIndexResponse,
    TaskProgressResponse
)
from ..services.indexer import index_pdf
from ..services.querier import query_pdf
from ..services.manager import list_indexes, delete_index
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# 全局任务存储：task_id -> {"task": asyncio.Task, "status": str, ...}
_running_tasks: Dict[str, Dict] = {}


async def _run_index_task(task_id: str, pdf_path: str, storage_dir: str, **kwargs):
    """后台运行索引任务（支持取消）"""

    # 创建进度回调函数
    def progress_callback(step: str, percent: int, message: str):
        """进度回调函数，更新任务进度信息"""
        if task_id in _running_tasks:
            _running_tasks[task_id].update({
                "current_step": step,
                "progress_percent": percent,
                "message": message
            })
            logger.debug(f"[进度更新] {task_id}: {step} ({percent}%) - {message}")

    try:
        # 检查是否已被取消
        if _running_tasks.get(task_id, {}).get("cancelled"):
            logger.info(f"[后台任务] 任务已取消 [{task_id}]")
            _running_tasks[task_id]["status"] = "cancelled"
            return

        _running_tasks[task_id]["status"] = "processing"
        _running_tasks[task_id]["message"] = "正在索引 PDF..."
        _running_tasks[task_id]["current_step"] = "start"
        _running_tasks[task_id]["progress_percent"] = 0

        result = await index_pdf(pdf_path, storage_dir, progress_callback=progress_callback, **kwargs)

        # 再次检查是否在处理过程中被取消
        if _running_tasks.get(task_id, {}).get("cancelled"):
            logger.info(f"[后台任务] 任务在完成后被标记为取消 [{task_id}]")
            _running_tasks[task_id]["status"] = "cancelled"
            return

        if result["status"] == "error":
            _running_tasks[task_id]["status"] = "failed"
            _running_tasks[task_id]["error"] = result.get("error", "Unknown error")
            logger.error(f"[后台任务] 索引失败 [{task_id}]: {result.get('error')}")
        else:
            _running_tasks[task_id]["status"] = "completed"
            _running_tasks[task_id]["result"] = result
            logger.info(f"[后台任务] 索引完成 [{task_id}]: {result.get('index_id')}")

    except asyncio.CancelledError:
        _running_tasks[task_id]["status"] = "cancelled"
        logger.info(f"[后台任务] 任务被取消 [{task_id}]")
        raise
    except Exception as e:
        _running_tasks[task_id]["status"] = "failed"
        _running_tasks[task_id]["error"] = str(e)
        logger.error(f"[后台任务] 索引异常 [{task_id}]: {e}", exc_info=True)


@router.post("/index", response_model=IndexResponse)
async def create_index(req: IndexRequest, http_request: Request):
    """
    创建 PDF 索引（后台任务）

    立即返回任务 ID，索引在后台进行。
    使用 GET /api/indexes/{task_id} 查询任务状态。
    使用 DELETE /api/indexes/{task_id} 取消任务。
    """
    import hashlib
    from pathlib import Path
    from urllib.parse import urlparse

    request_start = time.time()
    client_host = http_request.client.host if http_request.client else "unknown"

    logger.info("")
    logger.info("=" * 60)
    logger.info(f"[API请求] POST /api/index")
    logger.info(f"[API请求] 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"[API请求] 客户端: {client_host}")
    logger.info("=" * 60)
    logger.info(f"[请求参数] PDF 路径: {req.path}")

    # 快速验证路径是否存在（同步）
    pdf_path = Path(req.path)
    if not pdf_path.exists():
        logger.error(f"[API请求] ✗ 文件不存在: {req.path}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF file not found: {req.path}"
        )

    # 获取文件大小
    try:
        file_size = pdf_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        logger.info(f"[请求参数] 文件大小: {file_size_mb:.2f} MB")
    except:
        pass

    # 生成任务 ID
    task_id = f"task_{hashlib.md5(f'{req.path}{time.time()}'.encode()).hexdigest()[:12]}"
    logger.info(f"[任务信息] 任务 ID: {task_id}")

    # 提取 LLM 配置参数
    llm_config = {}
    logger.info(f"[LLM配置] 开始提取 LLM 配置参数...")

    if req.llm_provider is not None:
        llm_config["llm_provider"] = req.llm_provider
        logger.info(f"[LLM配置]  Provider: {req.llm_provider}")
    if req.llm_model is not None:
        llm_config["model"] = req.llm_model
        logger.info(f"[LLM配置]  Model: {req.llm_model}")
    if req.deepseek_api_key is not None:
        llm_config["api_key"] = req.deepseek_api_key
        masked_key = f"{req.deepseek_api_key[:8]}...{req.deepseek_api_key[-4:]}"
        logger.info(f"[LLM配置]  DeepSeek API Key: {masked_key}")
    if req.openai_api_key is not None:
        llm_config["api_key"] = req.openai_api_key
        masked_key = f"{req.openai_api_key[:8]}...{req.openai_api_key[-4:]}"
        logger.info(f"[LLM配置]  OpenAI/SiliconFlow API Key: {masked_key}")
    if req.api_url is not None:
        llm_config["base_url"] = req.api_url
        # 解析 URL，只显示 host
        try:
            parsed = urlparse(req.api_url)
            url_display = f"{parsed.scheme}://{parsed.netloc}"
            logger.info(f"[LLM配置]  API URL: {url_display}")
        except:
            logger.info(f"[LLM配置]  API URL: {req.api_url}")
    if req.max_pages_per_node is not None:
        llm_config["max_pages_per_node"] = req.max_pages_per_node
        logger.info(f"[LLM配置]  Max Pages Per Node: {req.max_pages_per_node}")
    if req.max_tokens_per_node is not None:
        llm_config["max_tokens_per_node"] = req.max_tokens_per_node
        logger.info(f"[LLM配置]  Max Tokens Per Node: {req.max_tokens_per_node}")
    if req.if_add_node_summary is not None:
        llm_config["if_add_node_summary"] = req.if_add_node_summary
        logger.info(f"[LLM配置]  Add Node Summary: {req.if_add_node_summary}")

    # 初始化任务状态
    _running_tasks[task_id] = {
        "status": "pending",
        "message": "任务已创建，等待处理",
        "pdf_path": req.path,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cancelled": False
    }

    # 创建异步任务
    logger.info(f"[任务信息] 创建后台任务...")

    task = asyncio.create_task(
        _run_index_task(task_id, req.path, str(settings.base_dir), **llm_config)
    )
    _running_tasks[task_id]["task"] = task

    # 响应时间统计
    response_time = time.time() - request_start

    logger.info(f"[任务信息] ✓ 后台索引任务已创建")
    logger.info(f"[API响应] 任务 ID: {task_id}")
    logger.info(f"[API响应] 状态: pending")
    logger.info(f"[API响应] 响应时间: {response_time*1000:.1f} ms")
    logger.info("=" * 60)
    logger.info("")

    # 立即返回任务信息
    return IndexResponse(
        status="pending",
        index_id=task_id,
        message=f"索引任务已创建，使用 GET /api/indexes/{task_id} 查询进度，DELETE /api/indexes/{task_id} 取消任务"
    )


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
    """列出所有索引（包括正在进行的任务）"""
    logger.info("[API] 收到列出索引请求")
    result = await list_indexes(str(settings.base_dir))

    # 添加正在运行的任务到列表中
    all_indexes = result.get("indexes", [])
    for task_id, task_info in _running_tasks.items():
        if task_info["status"] in ["pending", "processing"]:
            all_indexes.append({
                "id": task_id,
                "pdf_name": task_info.get("pdf_path", "Unknown").split("/")[-1],
                "status": task_info["status"],
                "created_at": task_info.get("created_at", ""),
                "message": task_info.get("message", "")
            })

    logger.info(f"[API] 返回 {len(all_indexes)} 个索引/任务")
    return ListIndexesResponse(status=result.get("status", "success"), indexes=all_indexes)


@router.get("/indexes/{index_id}")
async def get_index_status(index_id: str):
    """
    查询索引或任务状态

    - 如果是 task_id 开头，返回后台任务状态
    - 如果是 idx_id 开头，检查索引是否存在
    """
    # 查询后台任务状态
    if index_id.startswith("task_"):
        if index_id not in _running_tasks:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"任务 {index_id} 不存在"
            )

        task_info = _running_tasks[index_id]
        response = {
            "id": index_id,
            "status": task_info["status"],
            "pdf_path": task_info.get("pdf_path", ""),
            "created_at": task_info.get("created_at", ""),
            "message": task_info.get("message", ""),
        }

        # 添加进度信息
        if "current_step" in task_info:
            response["current_step"] = task_info["current_step"]
        if "progress_percent" in task_info:
            response["progress_percent"] = task_info["progress_percent"]
        if "total_steps" in task_info:
            response["total_steps"] = task_info["total_steps"]
        if "completed_steps" in task_info:
            response["completed_steps"] = task_info["completed_steps"]

        if task_info["status"] == "completed":
            response.update({
                "index_id": task_info["result"].get("index_id"),
                "node_count": task_info["result"].get("node_count"),
                "pdf_name": task_info["result"].get("pdf_name"),
            })
        elif task_info["status"] == "failed":
            response["error"] = task_info.get("error", "Unknown error")

        return response

    # 查询已完成的索引
    else:
        result = await list_indexes(str(settings.base_dir))
        for idx in result.get("indexes", []):
            if idx["id"] == index_id:
                return idx

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"索引 {index_id} 不存在"
        )


@router.get("/tasks/{task_id}/progress", response_model=TaskProgressResponse)
async def get_task_progress(task_id: str):
    """
    获取任务详细进度

    返回任务的详细进度信息，包括：
    - 当前步骤
    - 进度百分比
    - 总步骤数和已完成步骤数
    """
    if task_id not in _running_tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    task_info = _running_tasks[task_id]

    response = TaskProgressResponse(
        id=task_id,
        status=task_info["status"],
        message=task_info.get("message", ""),
        pdf_path=task_info.get("pdf_path"),
        created_at=task_info.get("created_at"),
        current_step=task_info.get("current_step"),
        progress_percent=task_info.get("progress_percent"),
        total_steps=task_info.get("total_steps"),
        completed_steps=task_info.get("completed_steps"),
    )

    if task_info["status"] == "completed":
        response.index_id = task_info["result"].get("index_id")
        response.node_count = task_info["result"].get("node_count")
        response.pdf_name = task_info["result"].get("pdf_name")
        response.progress_percent = 100
    elif task_info["status"] == "failed":
        response.error = task_info.get("error", "Unknown error")

    return response


@router.delete("/indexes/{index_id}")
async def delete_index_endpoint(index_id: str):
    """
    删除索引或取消任务

    - 如果是 task_id：取消正在运行的任务
    - 如果是 idx_id：删除已完成的索引（包括其向量数据和元数据）
    """
    logger.info(f"[API] 收到删除/取消请求: id='{index_id}'")

    # 取消正在运行的任务
    if index_id.startswith("task_"):
        if index_id not in _running_tasks:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"任务 {index_id} 不存在"
            )

        task_info = _running_tasks[index_id]

        # 检查任务状态
        if task_info["status"] in ["completed", "failed", "cancelled"]:
            return {
                "status": "success",
                "message": f"任务已{task_info['status']}，无需取消"
            }

        # 标记任务为取消状态
        task_info["cancelled"] = True

        # 取消异步任务
        task = task_info.get("task")
        if task and not task.done():
            task.cancel()
            logger.info(f"[API] 已发送取消信号: {index_id}")

        return {
            "status": "success",
            "message": f"任务 {index_id} 已取消"
        }

    # 删除已完成的索引
    else:
        result = await delete_index(index_id, str(settings.base_dir))
        logger.info(f"[API] 删除索引结果: {result.get('status')}")

        # 返回更详细的信息
        if result.get("status") == "success":
            result["message"] = f"索引 {index_id} 已成功删除（包括向量数据和元数据）"

        return result


@router.delete("/tasks/{task_id}")
async def cancel_task_endpoint(task_id: str):
    """
    取消正在运行的任务

    专门用于取消任务的接口，返回更详细的取消信息
    """
    logger.info(f"[API] 收到取消任务请求: task_id='{task_id}'")

    if task_id not in _running_tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {task_id} 不存在"
        )

    task_info = _running_tasks[task_id]
    current_status = task_info["status"]

    # 检查任务状态
    if current_status in ["completed", "failed", "cancelled"]:
        return {
            "status": "success",
            "message": f"任务已{current_status}，无需取消",
            "task_id": task_id,
            "current_status": current_status
        }

    if current_status == "pending":
        return {
            "status": "success",
            "message": "任务尚未开始，已标记为取消",
            "task_id": task_id,
            "current_status": "cancelled"
        }

    # 标记任务为取消状态
    task_info["cancelled"] = True

    # 取消异步任务
    task = task_info.get("task")
    if task and not task.done():
        task.cancel()
        logger.info(f"[API] 已发送取消信号: {task_id}")

    return {
        "status": "success",
        "message": f"任务 {task_id} 已取消",
        "task_id": task_id,
        "current_status": "cancelled"
    }
