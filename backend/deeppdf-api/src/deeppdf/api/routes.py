"""
API 路由定义
"""

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING, Any, Dict, List, Tuple
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator

if TYPE_CHECKING:
    from ..agent import DeepPDFAgent
from .models import (
    IndexRequest,
    IndexResponse,
    QueryRequest,
    QueryResponse,
    ListIndexesResponse,
    TaskProgressResponse,
    MarkdownMappingBody,
    MarkdownMappingResponse,
    AgentRequest,
    AgentResponse,
    AgentResponseWithCitations,
    CitationInfo,
)
from .export_models import ExportIndexResponse
from .export_handlers import export_index_data
from ..services.indexer import index_pdf
from ..services.querier import query_pdf
from ..services.manager import list_indexes, delete_index
from ..services.config_storage import ConfigStorage
from ..services.file_storage import FileStorage
from ..services.chat_storage import chat_storage
from ..config import settings
from ..agent.core import AgentError, LLMError
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# 全局任务存储：task_id -> {"task": asyncio.Task, "status": str, ...}
_running_tasks: Dict[str, Dict] = {}

# 全局 Agent 会话缓存：session_key -> Agent 实例
# session_key 格式: f"{index_id}_{session_id}"
_agent_sessions: Dict[str, "DeepPDFAgent"] = {}



# ========== 速率限制器 ==========


class RateLimiter:
    """简单的内存速率限制器"""

    def __init__(self):
        # 存储每个客户端的请求记录: client_ip -> [(timestamp, count), ...]
        self._requests: Dict[str, list] = defaultdict(list)
        # 清理过期记录的间隔（秒）
        self._cleanup_interval = 3600

    def _cleanup_old_requests(self, current_time: float):
        """清理超过 1 小时的旧记录"""
        cutoff_time = current_time - 3600
        for client_ip in list(self._requests.keys()):
            # 只保留最近的请求记录
            self._requests[client_ip] = [
                (ts, count)
                for ts, count in self._requests[client_ip]
                if ts > cutoff_time
            ]
            # 如果没有请求记录了，删除这个客户端
            if not self._requests[client_ip]:
                del self._requests[client_ip]

    def check_rate_limit(
        self, client_ip: str, max_requests: int, window_seconds: int
    ) -> Tuple[bool, Dict[str, int]]:
        """
        检查是否超过速率限制

        Args:
            client_ip: 客户端 IP 地址
            max_requests: 时间窗口内允许的最大请求数
            window_seconds: 时间窗口（秒）

        Returns:
            (is_allowed, info): is_allowed 表示是否允许请求
                                info 包含限制信息
        """
        current_time = time.time()

        # 获取该客户端的请求记录
        requests = self._requests[client_ip]

        # 每次检查时都移除时间窗口外的旧请求（修复：原清理逻辑只在特定时间触发）
        window_start = current_time - window_seconds
        self._requests[client_ip] = [
            (ts, count) for ts, count in requests if ts > window_start
        ]

        # 计算时间窗口内的请求数
        requests_in_window = sum(count for _, count in self._requests[client_ip])

        # 检查是否超过限制
        if requests_in_window >= max_requests:
            # 计算重置时间
            if self._requests[client_ip]:
                oldest_request = self._requests[client_ip][0][0]
                reset_time = int(oldest_request + window_seconds - current_time)
            else:
                reset_time = window_seconds

            return False, {
                "limit": max_requests,
                "remaining": 0,
                "reset": reset_time,
                "window": window_seconds,
            }

        # 记录本次请求
        self._requests[client_ip].append((current_time, 1))

        return True, {
            "limit": max_requests,
            "remaining": max_requests - requests_in_window - 1,
            "reset": window_seconds,
            "window": window_seconds,
        }


# 全局速率限制器实例
_rate_limiter = RateLimiter()

# 初始化文件存储服务
_storage_dir = Path(settings.base_dir)
_file_storage = FileStorage(storage_dir=str(_storage_dir))


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP 地址"""
    # 优先使用 X-Forwarded-For 头（反向代理场景）
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()

    # 其次使用 X-Real-IP 头
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # 最后使用直接连接的 IP
    if request.client:
        return request.client.host

    return "unknown"


async def _cleanup_completed_tasks():
    """
    定期清理已完成的任务

    清理超过 1 小时的已完成/失败/取消的任务，避免内存泄漏
    """
    while True:
        try:
            await asyncio.sleep(3600)  # 每小时执行一次清理

            current_time = time.time()
            tasks_to_remove = []
            cleanup_count = 0

            for task_id, task_info in _running_tasks.items():
                # 只清理已完成的任务
                if task_info["status"] in ["completed", "failed", "cancelled"]:
                    try:
                        # 解析创建时间
                        created_at_str = task_info.get("created_at", "")
                        if created_at_str:
                            created_time = time.mktime(
                                time.strptime(created_at_str, "%Y-%m-%d %H:%M:%S")
                            )
                            # 如果任务完成超过 1 小时，标记为删除
                            if current_time - created_time > 3600:
                                tasks_to_remove.append(task_id)
                    except (ValueError, TypeError) as e:
                        logger.warning(f"[任务清理] 无法解析任务 {task_id} 的时间: {e}")
                        # 如果无法解析时间，也标记为删除
                        tasks_to_remove.append(task_id)

            # 删除标记的任务
            for task_id in tasks_to_remove:
                del _running_tasks[task_id]
                cleanup_count += 1

            if cleanup_count > 0:
                logger.info(f"[任务清理] 已清理 {cleanup_count} 个过期任务")
                logger.info(f"[任务清理] 当前活跃任务数: {len(_running_tasks)}")

        except asyncio.CancelledError:
            logger.info("[任务清理] 清理任务被取消")
            break
        except Exception as e:
            logger.error(f"[任务清理] 清理过程中出错: {e}", exc_info=True)


# 启动清理任务的标志
_cleanup_task_started = False


async def _ensure_cleanup_task_running():
    """确保清理任务正在运行"""
    global _cleanup_task_started
    if not _cleanup_task_started:
        asyncio.create_task(_cleanup_completed_tasks())
        _cleanup_task_started = True
        logger.info("[任务清理] 已启动后台任务清理器")


async def _run_index_task(task_id: str, pdf_path: str, storage_dir: str, **kwargs):
    """后台运行索引任务（支持取消）"""

    # 创建进度回调函数
    def progress_callback(step: str, percent: int, message: str):
        """进度回调函数，更新任务进度信息"""
        if task_id in _running_tasks:
            _running_tasks[task_id].update(
                {"current_step": step, "progress_percent": percent, "message": message}
            )
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

        result = await index_pdf(
            pdf_path, storage_dir, progress_callback=progress_callback, **kwargs
        )

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

    速率限制：每小时最多 5 个索引任务（按 IP 地址）
    """
    import hashlib
    from urllib.parse import urlparse

    # 速率限制检查（修复：增加限制并缩短窗口）
    client_ip = _get_client_ip(http_request)
    is_allowed, rate_info = _rate_limiter.check_rate_limit(
        client_ip,
        max_requests=20,  # 每 10 分钟最多 20 个索引任务
        window_seconds=600,  # 10 分钟窗口
    )

    if not is_allowed:
        logger.warning(f"[速率限制] 客户端 {client_ip} 超过索引创建限制")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "Rate limit exceeded",
                "message": f"索引创建过于频繁，请在 {rate_info['reset']} 秒后重试。",
                "limit": rate_info["limit"],
                "window": rate_info["window"],
                "reset_after": rate_info["reset"],
            },
        )

    # 确保清理任务正在运行
    await _ensure_cleanup_task_running()

    request_start = time.time()
    client_host = http_request.client.host if http_request.client else "unknown"

    logger.info("")
    logger.info("=" * 60)
    logger.info("[API请求] POST /api/index")
    logger.info(f"[API请求] 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"[API请求] 客户端: {client_host}")
    logger.info("=" * 60)

    # 处理 file_id 和 path 参数
    pdf_path_str = None
    file_id = None

    if req.file_id:
        # 从文件存储中获取路径
        file_id = req.file_id
        file_info = _file_storage.get_file(req.file_id)
        if not file_info:
            logger.error(f"[API请求] ✗ 文件不存在: {req.file_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File '{req.file_id}' not found",
            )
        pdf_path_str = file_info.file_path
        logger.info(f"[请求参数] 文件 ID: {req.file_id}")
        logger.info(f"[请求参数] 文件名: {file_info.file_name}")
    elif req.path:
        # 直接使用提供的路径
        pdf_path_str = req.path
        logger.info(f"[请求参数] PDF 路径: {req.path}")
    else:
        logger.error("[API请求] ✗ 必须提供 file_id 或 path")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'file_id' or 'path' must be provided",
        )

    # 快速验证路径是否存在（同步）
    pdf_path = Path(pdf_path_str)
    if not pdf_path.exists():
        logger.error(f"[API请求] ✗ 文件不存在: {pdf_path_str}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF file not found: {pdf_path_str}",
        )

    # 获取文件大小
    try:
        file_size = pdf_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        logger.info(f"[请求参数] 文件大小: {file_size_mb:.2f} MB")
    except (OSError, AttributeError) as e:
        logger.warning(f"[请求参数] 无法获取文件大小: {e}")

    # 生成任务 ID
    task_id = (
        f"task_{hashlib.md5(f'{pdf_path_str}{time.time()}'.encode()).hexdigest()[:12]}"
    )
    logger.info(f"[任务信息] 任务 ID: {task_id}")

    # 提取 LLM 配置参数
    llm_config = {}
    logger.info("[LLM配置] 开始提取 LLM 配置参数...")

    # 优先级: 1. 指定配置名称加载 2. 使用请求参数 3. 使用环境变量默认值
    if req.config_name:
        # 从 JSON 加载配置
        storage_dir = Path(settings.base_dir) / "configs"
        config_storage = ConfigStorage(storage_dir=str(storage_dir))
        user_config = config_storage.get_config(req.config_name)

        if not user_config:
            logger.error(f"[LLM配置] ✗ 配置 '{req.config_name}' 不存在")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Configuration '{req.config_name}' not found",
            )

        logger.info(f"[LLM配置] 使用已保存配置: {req.config_name}")
        llm_config["llm_provider"] = user_config.llm.provider
        llm_config["model"] = user_config.llm.model
        if user_config.llm.api_key:
            llm_config["api_key"] = user_config.llm.api_key
        if user_config.llm.base_url:
            llm_config["base_url"] = user_config.llm.base_url
        llm_config["max_pages_per_node"] = user_config.indexing.max_pages_per_node
        llm_config["max_tokens_per_node"] = user_config.indexing.max_tokens_per_node
        # 将布尔值转换为字符串（indexer 期望 "yes"/"no"）
        llm_config["if_add_node_summary"] = (
            "yes" if user_config.indexing.if_add_node_summary else "no"
        )
        llm_config["if_add_node_text"] = (
            "yes" if user_config.indexing.if_add_node_text else "no"
        )

        logger.info(f"[LLM配置]  Provider: {user_config.llm.provider}")
        logger.info(f"[LLM配置]  Model: {user_config.llm.model}")
        logger.info(
            f"[LLM配置]  API Key: {'*' * min(len(user_config.llm.api_key) if user_config.llm.api_key else 0, 12)} ({len(user_config.llm.api_key) if user_config.llm.api_key else 0} 字符)"
        )
        logger.info(
            f"[LLM配置]  Max Pages Per Node: {user_config.indexing.max_pages_per_node}"
        )
        logger.info(
            f"[LLM配置]  Max Tokens Per Node: {user_config.indexing.max_tokens_per_node}"
        )
        logger.info(
            f"[LLM配置]  Add Node Summary: {user_config.indexing.if_add_node_summary}"
        )

    # 请求参数可以覆盖配置中的值
    if req.llm_provider is not None:
        llm_config["llm_provider"] = req.llm_provider
        logger.info(f"[LLM配置]  Provider (覆盖): {req.llm_provider}")
    if req.llm_model is not None:
        llm_config["model"] = req.llm_model
        logger.info(f"[LLM配置]  Model (覆盖): {req.llm_model}")
    if req.deepseek_api_key is not None:
        llm_config["api_key"] = req.deepseek_api_key
        key_length = len(req.deepseek_api_key)
        logger.info(
            f"[LLM配置]  DeepSeek API Key (覆盖): {'*' * min(key_length, 12)} ({key_length} 字符)"
        )
    if req.openai_api_key is not None:
        llm_config["api_key"] = req.openai_api_key
        key_length = len(req.openai_api_key)
        logger.info(
            f"[LLM配置]  OpenAI/SiliconFlow API Key (覆盖): {'*' * min(key_length, 12)} ({key_length} 字符)"
        )
    if req.api_url is not None:
        llm_config["base_url"] = req.api_url
        # 解析 URL，只显示 host
        try:
            parsed = urlparse(req.api_url)
            url_display = f"{parsed.scheme}://{parsed.netloc}"
            logger.info(f"[LLM配置]  API URL (覆盖): {url_display}")
        except (ValueError, Exception):
            logger.info(f"[LLM配置]  API URL (覆盖): {req.api_url}")
    if req.max_pages_per_node is not None:
        llm_config["max_pages_per_node"] = req.max_pages_per_node
        logger.info(f"[LLM配置]  Max Pages Per Node (覆盖): {req.max_pages_per_node}")
    if req.max_tokens_per_node is not None:
        llm_config["max_tokens_per_node"] = req.max_tokens_per_node
        logger.info(f"[LLM配置]  Max Tokens Per Node (覆盖): {req.max_tokens_per_node}")
    if req.if_add_node_summary is not None:
        llm_config["if_add_node_summary"] = "yes" if req.if_add_node_summary else "no"
        logger.info(f"[LLM配置]  Add Node Summary (覆盖): {req.if_add_node_summary}")

    # 初始化任务状态
    _running_tasks[task_id] = {
        "status": "pending",
        "message": "任务已创建，等待处理",
        "pdf_path": pdf_path_str,
        "file_id": file_id,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cancelled": False,
    }

    # 创建异步任务
    logger.info("[任务信息] 创建后台任务...")

    task = asyncio.create_task(
        _run_index_task(task_id, pdf_path_str, str(settings.base_dir), **llm_config)
    )
    _running_tasks[task_id]["task"] = task

    # 响应时间统计
    response_time = time.time() - request_start

    logger.info("[任务信息] ✓ 后台索引任务已创建")
    logger.info(f"[API响应] 任务 ID: {task_id}")
    logger.info("[API响应] 状态: pending")
    logger.info(f"[API响应] 响应时间: {response_time*1000:.1f} ms")
    logger.info("=" * 60)
    logger.info("")

    # 立即返回任务信息
    return IndexResponse(
        status="pending",
        index_id=task_id,
        message=f"索引任务已创建，使用 GET /api/indexes/{task_id} 查询进度，DELETE /api/indexes/{task_id} 取消任务",
    )


@router.post("/query", response_model=QueryResponse)
async def query_index(req: QueryRequest):
    """查询 PDF 内容"""
    logger.info(
        f"[API] 收到查询请求: query='{req.query}', index_id='{req.index_id}', max_results={req.max_results}"
    )
    result = await query_pdf(
        req.query,
        req.index_id,
        str(settings.base_dir),
        req.max_results or settings.max_results,
    )

    # 检查是否出错
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        logger.warning(f"[API] 查询失败: {error_msg}")
        # 返回错误响应，状态码仍然为 200（由 response_model 保证一致性）
        # 前端可以通过 status="error" 判断
        return QueryResponse(status="error", results=None, error=error_msg)

    result_count = len(result.get("results", []))
    logger.info(f"[API] 查询完成: 返回 {result_count} 个结果")
    return QueryResponse(**result)


@router.get("/indexes", response_model=ListIndexesResponse)
async def list_all_indexes():
    """列出所有索引（包括正在进行的任务）"""
    logger.info("[API] 收到列出索引请求")
    result = await list_indexes(str(settings.base_dir))

    # 为已完成的索引添加 status 字段
    all_indexes = []
    for idx in result.get("indexes", []):
        idx["status"] = "completed"
        all_indexes.append(idx)
        logger.info(
            f"[API] 已完成索引: id={idx['id']}, pdf_name={idx.get('pdf_name', 'N/A')}, status=completed"
        )

    # 添加正在运行的任务到列表中
    running_task_count = 0
    for task_id, task_info in _running_tasks.items():
        if task_info["status"] in ["pending", "processing"]:
            all_indexes.append(
                {
                    "id": task_id,
                    "pdf_name": task_info.get("pdf_path", "Unknown").split("/")[-1],
                    "node_count": 0,  # 任务未完成时节点数为 0
                    "status": task_info["status"],
                    "created_at": task_info.get("created_at", ""),
                    "message": task_info.get("message", ""),
                    "progress_percent": task_info.get(
                        "progress_percent", 0
                    ),  # 添加进度信息
                }
            )
            running_task_count += 1
            logger.info(
                f"[API] 正在运行的任务: id={task_id}, status={task_info['status']}, progress={task_info.get('progress_percent', 0)}%"
            )

    logger.info(
        f"[API] 返回 {len(all_indexes)} 个索引/任务 (已完成: {len(all_indexes) - running_task_count}, 运行中: {running_task_count})"
    )
    return ListIndexesResponse(
        status=result.get("status", "success"), indexes=all_indexes
    )


@router.get("/indexes/{index_id}")
async def get_index_status(index_id: str):
    """
    查询索引或任务状态

    - 如果是 task_id 开头，返回后台任务状态
    - 如果是 idx_id 开头，检查索引是否存在
    """
    logger.info(f"[API] 收到索引状态查询请求: index_id='{index_id}'")

    # 查询后台任务状态
    if index_id.startswith("task_"):
        logger.info("[API] 查询类型: 任务状态 (task_id)")
        if index_id not in _running_tasks:
            logger.warning(f"[API] 任务不存在: {index_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"任务 {index_id} 不存在"
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
            response.update(
                {
                    "index_id": task_info["result"].get("index_id"),
                    "node_count": task_info["result"].get("node_count"),
                    "pdf_name": task_info["result"].get("pdf_name"),
                }
            )
            logger.info(
                f"[API] 任务已完成，返回 index_id={task_info['result'].get('index_id')}"
            )
        elif task_info["status"] == "failed":
            response["error"] = task_info.get("error", "Unknown error")
            logger.info(f"[API] 任务失败: {task_info.get('error', 'Unknown error')}")

        logger.info(
            f"[API] 返回任务状态: status={response['status']}, index_id={response.get('index_id', 'N/A')}"
        )
        return response

    # 查询已完成的索引
    else:
        logger.info("[API] 查询类型: 已完成索引 (idx_id)")
        result = await list_indexes(str(settings.base_dir))
        logger.info(f"[API] list_indexes 返回 {len(result.get('indexes', []))} 个索引")

        for idx in result.get("indexes", []):
            if idx["id"] == index_id:
                # 添加 status 字段以保持与任务状态的兼容性
                idx["status"] = "completed"
                logger.info(
                    f"[API] 找到索引: id={idx['id']}, status={idx['status']}, pdf_name={idx.get('pdf_name', 'N/A')}"
                )
                return idx

        logger.warning(f"[API] 索引不存在: {index_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引 {index_id} 不存在"
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
            status_code=status.HTTP_404_NOT_FOUND, detail=f"任务 {task_id} 不存在"
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
                status_code=status.HTTP_404_NOT_FOUND, detail=f"任务 {index_id} 不存在"
            )

        task_info = _running_tasks[index_id]

        # 检查任务状态
        if task_info["status"] in ["completed", "failed", "cancelled"]:
            return {
                "status": "success",
                "message": f"任务已{task_info['status']}，无需取消",
            }

        # 标记任务为取消状态
        task_info["cancelled"] = True

        # 取消异步任务
        task = task_info.get("task")
        if task and not task.done():
            task.cancel()
            logger.info(f"[API] 已发送取消信号: {index_id}")

        return {"status": "success", "message": f"任务 {index_id} 已取消"}

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
            status_code=status.HTTP_404_NOT_FOUND, detail=f"任务 {task_id} 不存在"
        )

    task_info = _running_tasks[task_id]
    current_status = task_info["status"]

    # 检查任务状态
    if current_status in ["completed", "failed", "cancelled"]:
        return {
            "status": "success",
            "message": f"任务已{current_status}，无需取消",
            "task_id": task_id,
            "current_status": current_status,
        }

    if current_status == "pending":
        return {
            "status": "success",
            "message": "任务尚未开始，已标记为取消",
            "task_id": task_id,
            "current_status": "cancelled",
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
        "current_status": "cancelled",
    }


@router.get("/export/{index_id}", response_model=ExportIndexResponse)
async def export_index_endpoint(index_id: str):
    """
    导出索引的节点数据,供前端生成 Markdown 文件

    返回所有节点的数据,包括文本内容、章节信息、页码范围等
    """
    logger.info(f"[API] 收到导出请求: index_id='{index_id}'")
    result = await export_index_data(index_id)
    logger.info(
        f"[API] 导出完成: 返回 {len(result.get('nodes', []))} 个节点, total_pages={result.get('total_pages', 0)}"
    )
    return ExportIndexResponse(**result)


@router.post("/markdown-mapping/{index_id}", response_model=MarkdownMappingResponse)
async def save_markdown_mapping(index_id: str, body: MarkdownMappingBody):
    """保存 Markdown 文件映射到索引元数据"""
    logger.info(
        f"[API] Saving markdown mapping for index: {index_id}, count: {len(body.file_mapping)}"
    )

    try:
        from ..services.manager import update_index_metadata

        result = await update_index_metadata(
            index_id=index_id,
            storage_dir=str(settings.base_dir),
            updates={"markdown_files": body.file_mapping},
        )

        if result["status"] == "success":
            return MarkdownMappingResponse(status="success", index_id=index_id)
        else:
            raise HTTPException(
                status_code=500, detail=result.get("error", "Failed to update metadata")
            )

    except Exception as e:
        logger.error(f"[API] Failed to save mapping: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ========== Agent 端点 ==========


def _extract_citations_from_answer(answer: str, index_id: str) -> list[CitationInfo]:
    """
    从 Agent 回答中提取 Obsidian 链接引用

    Args:
        answer: Agent 的回答文本
        index_id: 索引 ID，用于生成 node_id

    Returns:
        CitationInfo 对象列表
    """
    import re

    # 匹配 [[file.md#^page-N]] 或 [[file.md]] 格式
    pattern = r"\[\[([^\]#]+)(?:#(\^page-))?(\d+)?\]\]"
    matches = re.findall(pattern, answer)

    citations = []
    seen_links = set()  # 去重

    for file_path, anchor_prefix, page_num in matches:
        # 构造完整的 Obsidian 链接
        if page_num:
            anchor = f"^page-{page_num}"
            obsidian_link = f"[[{file_path}#{anchor}]]"
        else:
            anchor = ""
            obsidian_link = f"[[{file_path}]]"

        # 去重
        if obsidian_link in seen_links:
            continue
        seen_links.add(obsidian_link)

        # 创建引用信息
        citations.append(
            CitationInfo(
                node_id=f"{index_id}_page_{page_num if page_num else 'unknown'}",
                obsidian_link=obsidian_link,
                page=int(page_num) if page_num else None,
                anchor=anchor,
            )
        )

    return citations


async def _load_agent_for_request(index_id: str) -> "DeepPDFAgent":
    """
    为请求加载 DeepPDF Agent

    Args:
        index_id: PDF 索引 ID

    Returns:
        配置好的 DeepPDFAgent 实例

    Raises:
        HTTPException: 如果索引不存在或加载失败
    """
    logger.info("")
    logger.info("🔷 " + "=" * 78)
    logger.info("🔷 [Agent加载] 开始加载 DeepPDF Agent")
    logger.info("🔷 " + "=" * 78)
    logger.info(f"📇 [索引ID] {index_id}")
    
    # 导入必要的模块
    from ..agent.core import DeepPDFAgent
    from pathlib import Path
    from ..services.manager import list_indexes # Added this import as it's used in the new code
    from ..config import settings # Added this import as it's used in the new code

    # 检查索引是否存在
    logger.info("🔍 [检查索引] 验证索引是否存在...")
    result = await list_indexes(str(settings.base_dir))
    index_exists = any(idx["id"] == index_id for idx in result.get("indexes", []))

    if not index_exists:
        logger.error(f"❌ [加载失败] 索引 {index_id} 不存在")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引 {index_id} 不存在"
        )
    
    logger.info(f"✅ [索引存在] 索引 {index_id} 验证通过")

    # 获取索引元数据
    logger.info("📋 [加载元数据] 读取索引配置...")
    storage_dir = Path(settings.base_dir)
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"

    try:
        import json

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        logger.info("✅ [元数据加载] 成功")
        logger.info(f"   📄 PDF名称: {metadata.get('pdf_name', 'N/A')}")
        logger.info(f"   📄 节点数: {metadata.get('node_count', 0)}")
        logger.info(f"   📄 总页数: {metadata.get('total_pages', 0)}")
        
    except FileNotFoundError:
        logger.error(f"❌ [元数据错误] 找不到索引元数据文件: {metadata_path}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"索引 {index_id} 元数据不存在",
        )
    except json.JSONDecodeError as e:
        logger.error(f"❌ [元数据错误] JSON 解析失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="索引元数据损坏",
        )


    # 提取树状结构
    tree_structure = metadata.get("tree_structure", {})
    logger.info(f"🌳 [文档结构] 树状层级: {_count_tree_levels(tree_structure)} 层")
    logger.info(f"🌳 [文档结构] 章节数: {_count_tree_nodes(tree_structure)} 个")

    # 初始化 Agent
    logger.info("")
    logger.info("🤖 [初始化Agent] 准备创建 DeepPDFAgent 实例...")
    logger.info(f"   🔧 Provider: {settings.llm_provider}")
    logger.info(f"   🔧 Model: {settings.llm_model or '默认'}")
    logger.info(f"   🔧 Temperature: {settings.agent_temperature}")
    logger.info(f"   🔧 Max Iterations: {settings.agent_max_iterations}")
    
    # 根据 provider 选择 API key
    api_key = None
    if settings.llm_provider == "deepseek":
        api_key = settings.deepseek_api_key
    elif settings.llm_provider == "openai":
        api_key = settings.openai_api_key

    try:
        agent = DeepPDFAgent(
            index_id=index_id,
            storage_dir=str(settings.base_dir),
            tree_structure=tree_structure,
            llm_provider=settings.llm_provider,
            llm_model=settings.llm_model,
            api_key=api_key,
            base_url=settings.llm_base_url,
            pageindex_lib_path=None,  # read_page 工具可选，不传时禁用
            temperature=settings.agent_temperature,
            top_p=settings.agent_top_p,
            max_iterations=settings.agent_max_iterations,
        )
        
        logger.info("✅ [Agent创建] DeepPDFAgent 实例创建成功")
        logger.info(f"   🛠️  可用工具数: {len(agent.executor.tools)}")
        logger.info(f"   🛠️  工具列表: {', '.join(agent.executor.tools.keys())}")
        logger.info("")
        logger.info("🔷 " + "=" * 78)
        logger.info("🔷 [Agent加载] 完成，准备开始推理")
        logger.info("🔷 " + "=" * 78)
        logger.info("")
        
        return agent
        
    except Exception as e:
        logger.error(f"❌ [Agent创建失败] {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent 初始化失败: {str(e)}",
        )


def _count_tree_levels(tree: dict, level: int = 1) -> int:
    """递归计算树的最大层级"""
    if not tree or "children" not in tree:
        return level
    if not tree["children"]:
        return level
    return max(_count_tree_levels(child, level + 1) for child in tree["children"])


def _count_tree_nodes(tree: dict) -> int:
    """递归计算树的节点数"""
    if not tree:
        return 0
    count = 1
    if "children" in tree and tree["children"]:
        count += sum(_count_tree_nodes(child) for child in tree["children"])
    return count



@router.post("/chat/agent")
async def agent_chat(req: AgentRequest, http_request: Request):
    """
    Agent 智能对话 - 同步端点

    使用 ReAct 模式的 Agent 进行智能问答，支持:
    - 检查目录 (inspect_toc)
    - 读取页面 (read_page)
    - 混合搜索 (hybrid_search)

    请求超时: 5 分钟
    速率限制: 每 60 秒最多 10 个请求

    新增功能: 设置 include_citations=true 可返回引用信息
    """
    logger.info(
        f"[API] 收到 Agent 请求: query='{req.query}', index_id='{req.index_id}', include_citations={req.include_citations}"
    )

    # 速率限制检查（Agent 调用成本高，使用更严格的限制）
    client_ip = _get_client_ip(http_request)
    is_allowed, rate_info = _rate_limiter.check_rate_limit(
        client_ip,
        max_requests=10,  # 每 60 秒最多 10 个 Agent 请求
        window_seconds=60,  # 60 秒窗口
    )

    if not is_allowed:
        logger.warning(f"[速率限制] 客户端 {client_ip} 超过 Agent 调用限制")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "Rate limit exceeded",
                "message": f"Agent 调用过于频繁，请在 {rate_info['reset']} 秒后重试。",
                "limit": rate_info["limit"],
                "window": rate_info["window"],
                "reset_after": rate_info["reset"],
            },
        )

    try:

        # 1. 加载或复用 Agent（支持多轮对话）
        session_key = f"{req.index_id}_{req.session_id or 'default'}"
        
        # 如果有 session_id 且缓存中存在，复用 Agent
        if req.session_id and session_key in _agent_sessions:
            agent = _agent_sessions[session_key]
            logger.info(f"💬 [会话管理] 复用已有 Agent: {session_key}")
        else:
            # 创建新 Agent
            agent = await _load_agent_for_request(req.index_id)
            
            # 尝试加载历史（如果有 session_id）
            if req.session_id:
                history = chat_storage.load_history(req.index_id, req.session_id)
                if history:
                    agent.session_history = history
                    logger.info(f"📂 [持久化] 已恢复历史记录: {len(history)} 条")
                
                # 缓存 Agent
                _agent_sessions[session_key] = agent
                logger.info(f"💬 [会话管理] 创建新 Agent 并缓存: {session_key}")

        # 2. 运行 Agent (使用 asyncio.to_thread 避免阻塞)
        async with asyncio.timeout(300):  # 5 分钟超时
            answer = await asyncio.to_thread(
                agent.run, req.query, req.force_mode, req.keep_history
            )
            
        # 3. 如果保留历史，保存到磁盘
        if req.session_id and req.keep_history:
            chat_storage.save_history(req.index_id, req.session_id, agent.session_history)

        logger.info(f"[API] Agent 完成: answer_length={len(answer)}")

        # 3. 根据请求决定是否返回引用
        if req.include_citations:
            citations = _extract_citations_from_answer(answer, req.index_id)
            logger.info(f"[API] 提取到 {len(citations)} 个引用")
            return AgentResponseWithCitations(
                status="success",
                answer=answer,
                iterations=len(
                    [h for h in agent.get_history() if h["role"] == "assistant"]
                ),
                citations=citations,
            )
        else:
            return AgentResponse(
                status="success",
                answer=answer,
                iterations=len(
                    [h for h in agent.get_history() if h["role"] == "assistant"]
                ),
            )

    except asyncio.TimeoutError:
        logger.error(f"[API] Agent 执行超时: index_id={req.index_id}")
        if req.include_citations:
            return AgentResponseWithCitations(
                status="error", error="请求超时，Agent 执行时间超过 5 分钟"
            )
        return AgentResponse(
            status="error", error="请求超时，Agent 执行时间超过 5 分钟"
        )
    except LLMError as e:
        logger.error(f"[API] LLM 调用失败: {e}")
        if req.include_citations:
            return AgentResponseWithCitations(
                status="error", error=f"LLM 调用失败: {str(e)}"
            )
        return AgentResponse(status="error", error=f"LLM 调用失败: {str(e)}")
    except AgentError as e:
        logger.error(f"[API] Agent 执行失败: {e}")
        if req.include_citations:
            return AgentResponseWithCitations(
                status="error", error=f"Agent 错误: {str(e)}"
            )
        return AgentResponse(status="error", error=f"Agent 错误: {str(e)}")
    except HTTPException:
        # 重新抛出 HTTP 异常（索引不存在等）
        raise
    except Exception as e:
        logger.error(f"[API] Agent 执行失败: {e}", exc_info=True)
        if req.include_citations:
            return AgentResponseWithCitations(status="error", error=str(e))
        return AgentResponse(status="error", error=str(e))


async def _agent_stream_generator(req: AgentRequest) -> AsyncGenerator[str, None]:
    """
    Agent 流式响应生成器 (异步实现)

    通过将同步生成器在独立线程中运行，并使用 asyncio.Queue 进行通信，
    实现真正的异步流式输出。

    **优化：批量缓冲机制**
    - 累积至少 50 字符或 0.2 秒后再发送
    - 减少前端更新频率，避免闪烁

    新增功能: 如果 req.include_citations=True，会在流结束后发送引用信息

    Args:
        req: Agent 请求对象

    Yields:
        SSE 格式的文本片段
    """
    try:
        # 1. 加载或复用 Agent（支持多轮对话）
        session_key = f"{req.index_id}_{req.session_id or 'default'}"
        
        # 如果有 session_id 且缓存中存在，复用 Agent
        if req.session_id and session_key in _agent_sessions:
            agent = _agent_sessions[session_key]
            logger.info(f"💬 [会话管理] 复用已有 Agent: {session_key}")
            logger.info(f"💬 [会话管理] 当前会话历史: {len(agent.session_history)} 条消息")
        else:
            # 创建新 Agent
            agent = await _load_agent_for_request(req.index_id)
            
            # 尝试加载历史（如果有 session_id）
            if req.session_id:
                history = chat_storage.load_history(req.index_id, req.session_id)
                if history:
                    agent.session_history = history
                    logger.info(f"📂 [持久化] 已恢复历史记录: {len(history)} 条")
            
            # 如果提供了 session_id，缓存 Agent
            if req.session_id:
                _agent_sessions[session_key] = agent
                logger.info(f"💬 [会话管理] 创建新 Agent 并缓存: {session_key}")
            else:
                logger.info("💬 [会话管理] 创建临时 Agent（无会话ID）")

        # 2. 创建队列用于线程间通信
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        # 用于收集完整的回答文本（用于提取引用）
        full_answer_parts = []

        # 3. 定义在线程中运行的同步生成器包装函数
        def _run_sync_generator():
            """
            在独立线程中运行同步生成器，将结果放入队列
            """
            try:
                logger.info("[Agent流式] 开始在线程中执行 Agent.run_stream")
                chunk_count = 0
                
                # 批量缓冲参数
                buffer = []
                buffer_char_count = 0
                last_send_time = time.time()
                MIN_BUFFER_CHARS = 50  # 至少累积 50 字符
                MAX_BUFFER_TIME = 0.2  # 最多缓冲 0.2 秒

                for chunk in agent.run_stream(req.query, req.force_mode, req.keep_history):
                    chunk_count += 1
                    buffer.append(chunk)
                    buffer_char_count += len(chunk)
                    
                    current_time = time.time()
                    time_since_last_send = current_time - last_send_time
                    
                    # 检查是否应该发送缓冲区
                    should_send = (
                        buffer_char_count >= MIN_BUFFER_CHARS or
                        time_since_last_send >= MAX_BUFFER_TIME
                    )
                    
                    if should_send:
                        # 合并缓冲区并发送
                        batched_chunk = "".join(buffer)
                        loop.call_soon_threadsafe(queue.put_nowait, ("chunk", batched_chunk))
                        
                        # 重置缓冲区
                        buffer = []
                        buffer_char_count = 0
                        last_send_time = current_time
                
                # 发送剩余缓冲区
                if buffer:
                    batched_chunk = "".join(buffer)
                    loop.call_soon_threadsafe(queue.put_nowait, ("chunk", batched_chunk))

                # 执行完成，发送完成信号
                loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
                logger.info(f"[Agent流式] 生成器执行完成，共 {chunk_count} 个原始chunk")

            except Exception as e:
                # 发送错误信号
                error_msg = str(e)
                logger.error(f"[Agent流式] 生成器执行出错: {error_msg}", exc_info=True)
                loop.call_soon_threadsafe(queue.put_nowait, ("error", error_msg))

        # 4. 在线程池中启动同步生成器（带超时）
        try:
            async with asyncio.timeout(300):  # 5 分钟超时
                # 启动后台线程任务
                task = asyncio.create_task(asyncio.to_thread(_run_sync_generator))

                # 5. 从队列中读取并yield SSE消息
                while True:
                    # 等待队列中的消息（异步）
                    msg_type, data = await queue.get()

                    if msg_type == "chunk":
                        # 发送内容chunk
                        yield f"data: {json.dumps({'content': data, 'status': 'streaming'})}\n\n"
                        # 收集完整回答
                        full_answer_parts.append(data)

                    elif msg_type == "error":
                        # 发送错误
                        yield f"data: {json.dumps({'status': 'error', 'error': data})}\n\n"
                        break

                    elif msg_type == "done":
                        # 发送完成信号
                        yield f"data: {json.dumps({'status': 'done'})}\n\n"

                        # 如果需要引用，提取并发送
                        if req.include_citations:
                            full_answer = "".join(full_answer_parts)
                            citations = _extract_citations_from_answer(
                                full_answer, req.index_id
                            )
                            logger.info(f"[API流式] 提取到 {len(citations)} 个引用")
                            # 发送引用信息
                            yield f"data: {json.dumps({'status': 'citations_done', 'citations': [c.model_dump() for c in citations]})}\n\n"

                        break

                # 等待后台任务完成
                await task
                
                # 保存历史到磁盘
                if req.session_id and req.keep_history:
                    chat_storage.save_history(req.index_id, req.session_id, agent.session_history)

        except asyncio.TimeoutError:
            logger.error(f"[API] Agent 流式执行超时: index_id={req.index_id}")
            yield f"data: {json.dumps({'status': 'error', 'error': '请求超时，执行时间超过 5 分钟'})}\n\n"

    except HTTPException as e:
        # HTTP 异常（索引不存在等）
        error_msg = e.detail if hasattr(e, "detail") else str(e)
        logger.error(f"[API] Agent 流式加载失败: {error_msg}")
        yield f"data: {json.dumps({'status': 'error', 'error': error_msg})}\n\n"
    except Exception as e:
        logger.error(f"[API] Agent 流式执行失败: {e}", exc_info=True)
        yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"



@router.post("/chat/agent/stream")
async def agent_chat_stream(req: AgentRequest, http_request: Request):
    """
    Agent 智能对话 - 流式端点 (SSE)

    使用 POST 方法传递请求参数，返回 Server-Sent Events 格式的流式响应

    请求超时: 5 分钟
    速率限制: 每 60 秒最多 10 个请求

    新增功能: 设置 include_citations=true 会在流结束后发送引用信息
    """
    logger.info(
        f"[API] 收到 Agent 流式请求: query='{req.query}', index_id='{req.index_id}', include_citations={req.include_citations}"
    )

    # 速率限制检查（Agent 调用成本高，使用更严格的限制）
    client_ip = _get_client_ip(http_request)
    is_allowed, rate_info = _rate_limiter.check_rate_limit(
        client_ip,
        max_requests=10,  # 每 60 秒最多 10 个 Agent 请求
        window_seconds=60,  # 60 秒窗口
    )

    if not is_allowed:
        logger.warning(f"[速率限制] 客户端 {client_ip} 超过 Agent 流式调用限制")
        # 对于流式请求，返回 SSE 格式的错误
        reset_seconds = rate_info["reset"]

        async def rate_limit_error():
            yield f"data: {json.dumps({'status': 'error', 'error': f'Agent 调用过于频繁，请在 {reset_seconds} 秒后重试。'})}\n\n"

        return StreamingResponse(rate_limit_error(), media_type="text/event-stream")

    return StreamingResponse(
        _agent_stream_generator(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        },
    )


@router.get("/chat/history/{index_id}/{session_id}")
async def get_chat_history(index_id: str, session_id: str) -> List[Dict[str, Any]]:
    """获取指定会话的历史记录"""
    try:
        history = chat_storage.load_history(index_id, session_id)
        return history
    except Exception as e:
        logger.error(f"[API] 获取聊天历史失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=f"获取聊天历史失败: {str(e)}"
        )
