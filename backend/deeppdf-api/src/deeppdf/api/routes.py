"""
API 路由定义
"""
import asyncio
import logging
import time
from typing import Dict, Tuple
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Request
from .models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    ListIndexesResponse, DeleteIndexResponse,
    TaskProgressResponse
)
from .export_models import (
    ExportIndexResponse,
    SaveMarkdownMappingRequest,
    SaveMarkdownMappingResponse
)
from .export_handlers import export_index_data, save_markdown_mapping
from ..services.indexer import index_pdf
from ..services.querier import query_pdf
from ..services.manager import list_indexes, delete_index
from ..services.config_storage import ConfigStorage
from ..services.file_storage import FileStorage
from ..config import settings
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# 全局任务存储：task_id -> {"task": asyncio.Task, "status": str, ...}
_running_tasks: Dict[str, Dict] = {}


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
                (ts, count) for ts, count in self._requests[client_ip]
                if ts > cutoff_time
            ]
            # 如果没有请求记录了，删除这个客户端
            if not self._requests[client_ip]:
                del self._requests[client_ip]

    def check_rate_limit(
        self,
        client_ip: str,
        max_requests: int,
        window_seconds: int
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
            (ts, count) for ts, count in requests
            if ts > window_start
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
                "window": window_seconds
            }

        # 记录本次请求
        self._requests[client_ip].append((current_time, 1))

        return True, {
            "limit": max_requests,
            "remaining": max_requests - requests_in_window - 1,
            "reset": window_seconds,
            "window": window_seconds
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

    速率限制：每小时最多 5 个索引任务（按 IP 地址）
    """
    import hashlib
    from urllib.parse import urlparse

    # 速率限制检查（修复：增加限制并缩短窗口）
    client_ip = _get_client_ip(http_request)
    is_allowed, rate_info = _rate_limiter.check_rate_limit(
        client_ip,
        max_requests=20,  # 每 10 分钟最多 20 个索引任务
        window_seconds=600  # 10 分钟窗口
    )

    if not is_allowed:
        logger.warning(f"[速率限制] 客户端 {client_ip} 超过索引创建限制")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "Rate limit exceeded",
                "message": f"索引创建过于频繁，请在 {rate_info['reset']} 秒后重试。",
                "limit": rate_info['limit'],
                "window": rate_info['window'],
                "reset_after": rate_info['reset']
            }
        )

    # 确保清理任务正在运行
    await _ensure_cleanup_task_running()

    request_start = time.time()
    client_host = http_request.client.host if http_request.client else "unknown"

    logger.info("")
    logger.info("=" * 60)
    logger.info(f"[API请求] POST /api/index")
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
                detail=f"File '{req.file_id}' not found"
            )
        pdf_path_str = file_info.file_path
        logger.info(f"[请求参数] 文件 ID: {req.file_id}")
        logger.info(f"[请求参数] 文件名: {file_info.file_name}")
    elif req.path:
        # 直接使用提供的路径
        pdf_path_str = req.path
        logger.info(f"[请求参数] PDF 路径: {req.path}")
    else:
        logger.error(f"[API请求] ✗ 必须提供 file_id 或 path")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'file_id' or 'path' must be provided"
        )

    # 快速验证路径是否存在（同步）
    pdf_path = Path(pdf_path_str)
    if not pdf_path.exists():
        logger.error(f"[API请求] ✗ 文件不存在: {pdf_path_str}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF file not found: {pdf_path_str}"
        )

    # 获取文件大小
    try:
        file_size = pdf_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        logger.info(f"[请求参数] 文件大小: {file_size_mb:.2f} MB")
    except (OSError, AttributeError) as e:
        logger.warning(f"[请求参数] 无法获取文件大小: {e}")

    # 生成任务 ID
    task_id = f"task_{hashlib.md5(f'{pdf_path_str}{time.time()}'.encode()).hexdigest()[:12]}"
    logger.info(f"[任务信息] 任务 ID: {task_id}")

    # 提取 LLM 配置参数
    llm_config = {}
    logger.info(f"[LLM配置] 开始提取 LLM 配置参数...")

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
                detail=f"Configuration '{req.config_name}' not found"
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
        llm_config["if_add_node_summary"] = "yes" if user_config.indexing.if_add_node_summary else "no"
        llm_config["if_add_node_text"] = "yes" if user_config.indexing.if_add_node_text else "no"

        logger.info(f"[LLM配置]  Provider: {user_config.llm.provider}")
        logger.info(f"[LLM配置]  Model: {user_config.llm.model}")
        logger.info(f"[LLM配置]  API Key: {'*' * min(len(user_config.llm.api_key) if user_config.llm.api_key else 0, 12)} ({len(user_config.llm.api_key) if user_config.llm.api_key else 0} 字符)")
        logger.info(f"[LLM配置]  Max Pages Per Node: {user_config.indexing.max_pages_per_node}")
        logger.info(f"[LLM配置]  Max Tokens Per Node: {user_config.indexing.max_tokens_per_node}")
        logger.info(f"[LLM配置]  Add Node Summary: {user_config.indexing.if_add_node_summary}")

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
        logger.info(f"[LLM配置]  DeepSeek API Key (覆盖): {'*' * min(key_length, 12)} ({key_length} 字符)")
    if req.openai_api_key is not None:
        llm_config["api_key"] = req.openai_api_key
        key_length = len(req.openai_api_key)
        logger.info(f"[LLM配置]  OpenAI/SiliconFlow API Key (覆盖): {'*' * min(key_length, 12)} ({key_length} 字符)")
    if req.api_url is not None:
        llm_config["base_url"] = req.api_url
        # 解析 URL，只显示 host
        try:
            parsed = urlparse(req.api_url)
            url_display = f"{parsed.scheme}://{parsed.netloc}"
            logger.info(f"[LLM配置]  API URL (覆盖): {url_display}")
        except (ValueError, Exception) as e:
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
        "cancelled": False
    }

    # 创建异步任务
    logger.info(f"[任务信息] 创建后台任务...")

    task = asyncio.create_task(
        _run_index_task(task_id, pdf_path_str, str(settings.base_dir), **llm_config)
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
                "node_count": 0,  # 任务未完成时节点数为 0
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
