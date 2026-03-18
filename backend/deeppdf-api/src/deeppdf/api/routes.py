"""
API 路由定义
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Tuple
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Request

from .models import (
    IndexRequest,
    IndexResponse,
    QueryRequest,
    QueryResponse,
    ListIndexesResponse,
    TaskProgressResponse,
    MarkdownMappingBody,
    MarkdownMappingResponse,
    SessionInfo,
    SessionsListResponse,
    DeleteSessionResponse,
    GenerateSummaryRequest,
    GenerateSummaryResponse,
    BookSummary,
    ChapterSummary,
)
from .export_models import (
    ExportIndexResponse,
    CoverResponse,
)
from .export_handlers import (
    export_index_data,
    export_cover_data,
)
from ..services.indexer import index_pdf
from ..services.querier import query_pdf
from ..services.manager import list_indexes, delete_index
from ..services.config_storage import ConfigStorage
from ..services.file_storage import FileStorage
from ..services.chat_storage import chat_storage
from ..config import settings
from ..utils.cache import TTLCache
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# 全局任务存储：task_id -> {"task": asyncio.Task, "status": str, ...}
_running_tasks: Dict[str, Dict] = {}

# 索引列表缓存（TTL 30秒）
_index_list_cache = TTLCache[str, Dict](ttl_seconds=30.0, max_size=10)


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


async def _run_index_task(task_id: str, pdf_path: str, storage_dir: str, original_filename: str = None, **kwargs):
    """后台运行索引任务（支持取消）

    Args:
        task_id: 任务 ID
        pdf_path: PDF 文件路径
        storage_dir: 存储目录
        original_filename: 原始文件名（用于显示和元数据）
        **kwargs: 其他参数（LLM 配置等）
    """

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
            pdf_path, storage_dir, progress_callback=progress_callback,
            original_filename=original_filename, **kwargs
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

            # 清除索引列表缓存，确保新索引立即可见
            _index_list_cache.delete("all_indexes")
            logger.debug(f"[后台任务] 已清除索引列表缓存 [{task_id}]")

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
        # 从本地路径导入文件到 uploads 目录
        logger.info(f"[文件导入] 从本地路径导入: {req.path}")
        success, imported_file_info, error, reuse_info = _file_storage.import_from_path(req.path)
        if not success:
            logger.error(f"[文件导入] ✗ 导入失败: {error}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to import file: {error}",
            )

        file_id = imported_file_info.file_id
        file_info = imported_file_info
        pdf_path_str = imported_file_info.file_path
        logger.info(f"[文件导入] ✓ 导入成功: {file_id} -> {pdf_path_str}")

        # 检查是否可以复用已有索引（秒索引）
        if reuse_info and reuse_info.get("index_file"):
            logger.info(f"[秒索引] 检测到已有索引，复用: {reuse_info['index_file']}")
            # 直接返回成功，跳过索引任务
            index_file = Path(reuse_info["index_file"])
            index_id = index_file.stem

            return IndexResponse(
                status="success",
                task_id=f"task_reuse_{hashlib.md5(f'{pdf_path_str}'.encode()).hexdigest()[:12]}",
                message=f"复用已有索引: {imported_file_info.file_name}",
                file_id=file_id,
                pdf_path=pdf_path_str,
                index_id=index_id,  # 返回已有的索引 ID
                reused=True,
            )
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

    # 文本格式化配置
    llm_config["enable_text_formatting"] = req.enable_text_formatting
    logger.info(f"[LLM配置]  Enable Text Formatting: {req.enable_text_formatting}")

    # 获取原始文件名（用于初始化任务状态和后台任务）
    original_filename = file_info.file_name if file_info else None

    # 初始化任务状态
    _running_tasks[task_id] = {
        "status": "pending",
        "message": "任务已创建，等待处理",
        "pdf_path": pdf_path_str,
        "file_id": file_id,
        "original_filename": original_filename or pdf_path_str.split("/")[-1],
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cancelled": False,
    }

    # 创建异步任务
    logger.info("[任务信息] 创建后台任务...")

    task = asyncio.create_task(
        _run_index_task(task_id, pdf_path_str, str(settings.base_dir),
                       original_filename=original_filename, **llm_config)
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
    """查询 PDF 内容（支持 LLM 树搜索和范围锁定）"""
    logger.info(
        f"[API] 收到查询请求: query='{req.query}', index_id='{req.index_id}', "
        f"max_results={req.max_results}, use_llm_tree_search={req.use_llm_tree_search}, "
        f"scope_node_ids={req.scope_node_ids}"
    )

    # 验证：空查询
    if not req.query or not req.query.strip():
        logger.warning("[API] 查询失败: 查询内容为空")
        return QueryResponse(status="error", results=None, error="查询内容不能为空")

    # 验证：索引是否存在
    metadata_path = settings.base_dir / "indexes" / f"{req.index_id}.json"
    if not metadata_path.exists():
        logger.warning(f"[API] 查询失败: 索引不存在 - {req.index_id}")
        return QueryResponse(status="error", results=None, error=f"索引不存在: {req.index_id}")

    result = await query_pdf(
        req.query,
        req.index_id,
        str(settings.base_dir),
        req.max_results or settings.max_results,
        use_llm_tree_search=req.use_llm_tree_search,
        scope_node_ids=req.scope_node_ids,
    )

    # 检查是否出错
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        logger.warning(f"[API] 查询失败: {error_msg}")
        return QueryResponse(status="error", results=None, error=error_msg)

    result_count = len(result.get("results", []))
    search_method = result.get("search_method", "unknown")
    logger.info(f"[API] 查询完成: method={search_method}, 返回 {result_count} 个结果")

    return QueryResponse(**result)


@router.get("/indexes", response_model=ListIndexesResponse)
async def list_all_indexes():
    """列出所有索引（包括正在进行的任务）"""
    # 尝试从缓存获取
    cache_key = "all_indexes"
    cached_result = _index_list_cache.get(cache_key)
    if cached_result is not None:
        result = cached_result
    else:
        result = await list_indexes(str(settings.base_dir))
        _index_list_cache.set(cache_key, result)

    # 为已完成的索引添加 status 字段
    all_indexes = []
    for idx in result.get("indexes", []):
        idx["status"] = "completed"
        all_indexes.append(idx)

    # 添加任务到列表中（包括正在运行的和已失败的）
    running_task_count = 0
    failed_task_count = 0
    for task_id, task_info in _running_tasks.items():
        # 包含 pending, processing 和 failed 状态的任务
        if task_info["status"] in ["pending", "processing", "failed"]:
            task_entry = {
                "id": task_id,
                "pdf_name": task_info.get("original_filename", task_info.get("pdf_path", "Unknown").split("/")[-1]),
                "node_count": 0,  # 任务未完成时节点数为 0
                "status": task_info["status"],
                "created_at": task_info.get("created_at", ""),
                "message": task_info.get("message", ""),
                "progress_percent": task_info.get(
                    "progress_percent", 0
                ),  # 添加进度信息
                "current_step": task_info.get("current_step", ""),  # 添加当前步骤
            }
            # 如果任务失败，添加错误信息
            if task_info["status"] == "failed" and task_info.get("error"):
                task_entry["message"] = task_info.get("error", "Unknown error")

            all_indexes.append(task_entry)

            if task_info["status"] in ["pending", "processing"]:
                running_task_count += 1
            elif task_info["status"] == "failed":
                failed_task_count += 1

    # 不再打印索引列表的轮询日志（前端频繁轮询会产生大量日志）
    # 如需调试，可启用 DEBUG 级别
    logger.debug(
        f"[API] 索引列表: {len(all_indexes)} 个 (完成: {len(all_indexes) - running_task_count - failed_task_count}, 运行中: {running_task_count}, 失败: {failed_task_count})"
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
    # 查询后台任务状态
    if index_id.startswith("task_"):
        if index_id not in _running_tasks:
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
        elif task_info["status"] == "failed":
            response["error"] = task_info.get("error", "Unknown error")

        return response

    # 查询已完成的索引
    else:
        result = await list_indexes(str(settings.base_dir))

        for idx in result.get("indexes", []):
            if idx["id"] == index_id:
                # 添加 status 字段以保持与任务状态的兼容性
                idx["status"] = "completed"
                return idx

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


@router.get("/tasks")
async def list_running_tasks():
    """
    获取所有正在运行的任务
    """
    tasks = []
    for task_id, task_info in _running_tasks.items():
        # 只返回处理中的任务
        if task_info["status"] == "processing":
            tasks.append({
                "id": task_id,
                "status": task_info["status"],
                "message": task_info.get("message"),
                "progress_percent": task_info.get("progress_percent", 0),
                "current_step": task_info.get("current_step"),
                "created_at": task_info.get("created_at"),
                "pdf_name": task_info.get("pdf_name"),
            })
    return {"status": "success", "tasks": tasks}


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
async def export_index_endpoint(
    index_id: str,
):
    """
    导出索引的节点数据,供前端生成 Markdown 文件

    参数:
    - index_id: 索引 ID

    返回所有节点的数据,包括文本内容、章节信息、页码范围等
    注意：导出时仅使用基于规则的快速格式化，如需 AI 格式化请使用 /api/export/{index_id}/format-llm 端点
    """
    logger.info(f"[API] 收到导出请求: index_id='{index_id}'")
    result = await export_index_data(index_id)
    logger.info(
        f"[API] 导出完成: 返回 {len(result.get('nodes', []))} 个节点, total_pages={result.get('total_pages', 0)}"
    )
    return ExportIndexResponse(**result)


@router.get("/export/{index_id}/cover", response_model=CoverResponse)
async def export_cover_endpoint(index_id: str):
    """
    导出书籍封面

    从 PDF/EPUB 文件中提取封面图片，如果没有封面则生成默认封面
    返回 base64 编码的封面图片数据
    """
    logger.debug(f"[API] 收到封面导出请求: index_id='{index_id}'")
    result = await export_cover_data(index_id)
    logger.debug(
        f"[API] 封面导出完成: pdf_name='{result.get('pdf_name')}', "
        f"has_custom_cover={result.get('has_custom_cover')}"
    )
    return CoverResponse(**result)


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


# ============================================================
# 会话管理 API（历史记录持久化）
# ============================================================


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
            detail=f"获取聊天历史失败: {str(e)}",
        )


@router.get("/chat/sessions/{index_id}", response_model=SessionsListResponse)
async def list_sessions(index_id: str) -> SessionsListResponse:
    """列出指定索引的所有会话"""
    try:
        # 获取会话列表
        sessions = chat_storage.list_sessions_with_info(index_id)

        # 获取索引的 PDF 名称
        from ..services.manager import list_indexes

        indexes_result = await list_indexes(str(settings.base_dir))
        pdf_name = "Unknown"
        for idx in indexes_result.get("indexes", []):
            if idx["id"] == index_id:
                pdf_name = idx.get("pdf_name", "Unknown")
                break

        # 为每个会话添加 PDF 名称
        for session in sessions:
            session["pdfName"] = pdf_name

        logger.info(f"[API] 列出会话: index_id={index_id}, count={len(sessions)}")
        return SessionsListResponse(
            status="success", sessions=[SessionInfo(**s) for s in sessions]
        )
    except Exception as e:
        logger.error(f"[API] 列出会话失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"列出会话失败: {str(e)}",
        )


@router.delete(
    "/chat/sessions/{index_id}/{session_id}", response_model=DeleteSessionResponse
)
async def delete_session(index_id: str, session_id: str) -> DeleteSessionResponse:
    """删除指定会话"""
    try:
        # 删除会话文件
        deleted = chat_storage.delete_session(index_id, session_id)

        if deleted:
            logger.info(
                f"[API] 删除会话成功: index_id={index_id}, session_id={session_id}"
            )
            return DeleteSessionResponse(status="success", message="会话已删除")
        else:
            return DeleteSessionResponse(status="success", message="会话不存在")
    except Exception as e:
        logger.error(f"[API] 删除会话失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"删除会话失败: {str(e)}",
        )


# ==================== 书籍摘要 API ====================


@router.post(
    "/summary/generate",
    response_model=GenerateSummaryResponse,
    summary="生成书籍摘要",
    description="为指定索引的书籍生成结构化摘要，包括核心主旨、作者意图、书籍分类",
)
async def generate_book_summary_endpoint(body: GenerateSummaryRequest):
    """
    生成书籍摘要

    - **index_id**: 索引 ID
    - **force_regenerate**: 是否强制重新生成（即使已有缓存）
    """
    logger.info(
        f"[书籍摘要] index_id={body.index_id}, force_regenerate={body.force_regenerate}"
    )

    from ..services.book_summary import generate_full_summary

    storage_dir = str(Path(settings.base_dir))

    try:
        result = await generate_full_summary(
            index_id=body.index_id,
            storage_dir=storage_dir,
            force_regenerate=body.force_regenerate,
        )

        if result.get("status") != "success":
            logger.error(f"[书籍摘要] 生成失败: {result.get('error')}")
            return GenerateSummaryResponse(
                status="error",
                error=result.get("error"),
            )

        summary_data = result.get("summary", {})
        logger.info(f"[书籍摘要] 完成: {summary_data.get('core_thesis', '')[:50]}...")

        return GenerateSummaryResponse(
            status="success",
            summary=BookSummary(
                index_id=summary_data.get("index_id", body.index_id),
                core_thesis=summary_data.get("core_thesis", ""),
                author_intents=summary_data.get("author_intents", []),
                book_type=summary_data.get("book_type", "mixed"),
                chapter_summaries=[
                    ChapterSummary(
                        node_id=cs.get("node_id", ""),
                        title=cs.get("title", ""),
                        summary=cs.get("summary", ""),
                        key_questions=cs.get("key_questions", []),
                    )
                    for cs in summary_data.get("chapter_summaries", [])
                ],
                generated_at=summary_data.get("generated_at"),
                model_used=summary_data.get("model_used"),
            ),
        )

    except Exception as e:
        logger.error(f"[书籍摘要] 失败: {e}")
        return GenerateSummaryResponse(
            status="error",
            error=str(e),
        )


@router.get(
    "/summary/{index_id}",
    response_model=GenerateSummaryResponse,
    summary="获取书籍摘要",
    description="获取已缓存的书籍摘要，如果没有则返回错误",
)
async def get_book_summary_endpoint(index_id: str):
    """
    获取已缓存的书籍摘要

    - **index_id**: 索引 ID
    """
    from ..services.manager import load_index_metadata

    storage_dir = str(Path(settings.base_dir))

    try:
        metadata_result = await load_index_metadata(index_id, storage_dir)

        if metadata_result.get("status") != "success":
            return GenerateSummaryResponse(
                status="error",
                error=metadata_result.get("error", "索引不存在"),
            )

        metadata = metadata_result.get("metadata", {})
        summary_data = metadata.get("book_summary")

        if not summary_data:
            return GenerateSummaryResponse(
                status="error",
                error="该书籍尚未生成摘要，请先调用 /api/summary/generate 生成",
            )

        return GenerateSummaryResponse(
            status="success",
            summary=BookSummary(
                index_id=summary_data.get("index_id", index_id),
                core_thesis=summary_data.get("core_thesis", ""),
                author_intents=summary_data.get("author_intents", []),
                book_type=summary_data.get("book_type", "mixed"),
                chapter_summaries=[
                    ChapterSummary(
                        node_id=cs.get("node_id", ""),
                        title=cs.get("title", ""),
                        summary=cs.get("summary", ""),
                        key_questions=cs.get("key_questions", []),
                    )
                    for cs in summary_data.get("chapter_summaries", [])
                ],
                generated_at=summary_data.get("generated_at"),
                model_used=summary_data.get("model_used"),
            ),
        )

    except Exception as e:
        logger.error(f"[书籍摘要] 获取失败: {e}")
        return GenerateSummaryResponse(
            status="error",
            error=str(e),
        )
