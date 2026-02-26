"""
PDF/EPUB 索引服务 - 异步封装
"""

import asyncio
import functools
import hashlib
import json
import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime

from pageindex import page_index_main
from pageindex.core import ConfigLoader
from pageindex.llm import UnifiedLLM, get_provider

# 导入存储模块
from deeppdf.storage.chroma_store import ChromaStore

# 导入配置
from deeppdf.config import settings

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# 全局线程池 - 使用配置中的 worker 数量
# 注意：pageindex-lib 需要 asyncio 事件循环，在线程池中运行需要特殊处理
cpu_executor = ThreadPoolExecutor(max_workers=1)  # 限制为 1 个 worker 以避免并发问题


def _extract_nodes_from_tree(
    tree: Dict[str, Any], parent_section: str = "", level: int = 0
) -> List[Dict]:
    """
    从 PageIndex 树状结构中提取章节节点

    重要变更：同时保留原始文本和摘要
    - text: 原始 PDF 文本（用于向量化和检索）
    - summary: LLM 生成的摘要（保存在 metadata 中）
    """
    nodes: List[Dict] = []

    if not tree:
        return nodes

    node_name = tree.get("title", "")
    start_page = tree.get("start_index")
    end_page = tree.get("end_index")
    node_text = tree.get("text", "")
    node_id = tree.get("node_id", "")
    node_summary = tree.get("summary", "")

    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 向量化使用摘要（更好的语义表示）
    # 原文保存在 metadata 中，供 Markdown 导出使用
    content_for_embedding = node_summary or node_text

    # 如果有内容，创建节点
    if content_for_embedding and content_for_embedding.strip():
        full_text_for_embedding = f"【{current_section}】\n{content_for_embedding.strip()}"
        node_metadata = {
            "section": current_section,
            "level": level,
            "page": start_page,
            "start_index": start_page,
            "end_index": end_page,
            "node_name": node_name,
            "node_id": node_id,
        }
        # 保存摘要和原文到 metadata
        if node_summary and node_summary.strip():
            node_metadata["summary"] = node_summary.strip()
        if node_text and node_text.strip():
            node_metadata["original_text"] = node_text.strip()

        nodes.append(
            {
                "id": node_id or f"node_{len(nodes)}",
                "text": full_text_for_embedding,
                "metadata": node_metadata,
            }
        )

    # 递归处理子节点
    children = tree.get("nodes", [])
    for child in children:
        nodes.extend(_extract_nodes_from_tree(child, current_section, level + 1))

    return nodes


def _parse_llm_config(**kwargs) -> Dict[str, Any]:
    """
    解析 LLM 配置参数

    Returns:
        包含 LLM 配置的字典
    """
    model = kwargs.get("model") or settings.pdf_index_model
    llm_provider = kwargs.get("llm_provider") or settings.pdf_index_llm_provider
    base_url = kwargs.get("base_url") or settings.llm_base_url

    # custom provider 必须提供 base_url
    if llm_provider == "custom" and not base_url:
        return {
            "status": "error",
            "error": "When using 'custom' llm_provider, 'api_url' parameter is required. "
            "Please provide the base URL of your custom LLM API (e.g., https://api.siliconflow.cn/v1).",
        }

    toc_check_pages = kwargs.get("toc_check_pages") or settings.pdf_index_toc_check_pages
    max_pages_per_node = kwargs.get("max_pages_per_node") or settings.pdf_index_max_pages_per_node
    max_tokens_per_node = (
        kwargs.get("max_tokens_per_node") or settings.pdf_index_max_tokens_per_node
    )

    # 这些是字符串类型的配置，转换为布尔值
    if_add_node_id_str = kwargs.get("if_add_node_id") or "yes"
    if_add_node_summary_str = kwargs.get("if_add_node_summary") or "yes"
    if_add_node_text_str = kwargs.get("if_add_node_text") or "yes"
    if_add_doc_description_str = kwargs.get("if_add_doc_description") or "no"

    # 转换为布尔值
    if_add_node_id = if_add_node_id_str.lower() in ("yes", "true", "1", "on")
    if_add_node_summary = if_add_node_summary_str.lower() in ("yes", "true", "1", "on")
    if_add_node_text = if_add_node_text_str.lower() in ("yes", "true", "1", "on")
    if_add_node_description = if_add_doc_description_str.lower() in (
        "yes",
        "true",
        "1",
        "on",
    )

    require_llm = kwargs.get("require_llm", True)
    api_key = kwargs.get("api_key")

    return {
        "model": model,
        "llm_provider": llm_provider,
        "base_url": base_url,
        "toc_check_pages": toc_check_pages,
        "max_pages_per_node": max_pages_per_node,
        "max_tokens_per_node": max_tokens_per_node,
        "if_add_node_id": if_add_node_id,
        "if_add_node_summary": if_add_node_summary,
        "if_add_node_text": if_add_node_text,
        "if_add_node_description": if_add_node_description,
        "require_llm": require_llm,
        "api_key": api_key,
    }


def _validate_pdf_file(pdf_path: Path) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    验证 PDF 文件

    Args:
        pdf_path: PDF 文件路径

    Returns:
        (is_valid, error_message, file_size)
    """
    if not pdf_path.exists():
        return False, f"PDF file not found: {pdf_path}", None

    # 验证文件大小
    try:
        file_size = pdf_path.stat().st_size
        if file_size < 1024:
            return False, "PDF file is too small (< 1KB)", file_size
        return True, None, file_size
    except (OSError, AttributeError) as e:
        return False, f"Cannot read PDF file: {e}", None


def _check_llm_config(require_llm: bool, api_key: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    检查 LLM API 配置

    Args:
        require_llm: 是否需要 LLM
        api_key: API 密钥

    Returns:
        (is_valid, error_message)
    """
    if not require_llm:
        return True, None

    llm_api_key = api_key or (
        os.getenv("DEEPSEEK_API_KEY") or os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")
    )

    if not llm_api_key:
        return (
            False,
            "LLM API key is required for PageIndex tree indexing. Please set DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable.",
        )

    return True, None


def _setup_pageindex_config(config: Dict[str, Any], llm_api_key: Optional[str]) -> Tuple[Any, Any]:
    """
    设置 PageIndex 配置和 LLM 客户端

    Args:
        config: LLM 配置字典
        llm_api_key: LLM API 密钥

    Returns:
        (opt, llm_client_instance)
    """

    config_loader = ConfigLoader()

    user_opt = {
        "model": config["model"],
        "if_add_node_summary": (config["if_add_node_summary"] if config["require_llm"] else "no"),
        "if_add_node_text": config["if_add_node_text"],
        "if_add_node_id": config["if_add_node_id"],
        # Note: if_add_node_description is not supported by PageIndex
        "toc_check_page_num": config["toc_check_pages"],
        "max_page_num_each_node": config["max_pages_per_node"],
        "max_token_num_each_node": config["max_tokens_per_node"],
        "llm_provider": {
            "type": config["llm_provider"],
            "api_key": llm_api_key,
            "base_url": config["base_url"],
        },
    }

    opt = config_loader.load(user_opt)

    # 创建 LLM client
    llm_client_instance = None
    if config["require_llm"] and llm_api_key:
        provider = get_provider(user_opt["llm_provider"])
        llm_client_instance = UnifiedLLM(provider=provider, model=opt.model)

    return opt, llm_client_instance


def _parse_pdf_structure(
    pdf_path: str,
    opt: Any,
    llm_client: Any,
    config: Dict[str, Any],
    progress_callback=None,
) -> Tuple[Dict, float]:
    """
    解析 PDF/EPUB 结构

    Args:
        pdf_path: PDF/EPUB 文件路径
        opt: PageIndex 配置
        llm_client: LLM 客户端
        config: LLM 配置字典
        progress_callback: 进度回调函数

    Returns:
        (tree_result, parse_time)
    """
    parse_start = time.time()
    doc_type = _get_doc_type(pdf_path)

    logger.info(f"[{doc_type.upper()}解析] 开始时间: {datetime.now().strftime('%H:%M:%S')}")
    logger.info(f"[{doc_type.upper()}解析] 输入文件: {Path(pdf_path).name}")
    logger.info(
        f"[{doc_type.upper()}解析] 配置参数: to_check={config['toc_check_pages']}, max_pages={config['max_pages_per_node']}, max_tokens={config['max_tokens_per_node']}"
    )
    logger.info(f"[{doc_type.upper()}解析] LLM 客户端: {llm_client is not None}")

    # 更新进度：开始文档解析
    if progress_callback:
        progress_callback("parsing_pdf", 55, f"正在提取 {doc_type.upper()} 页面...")

    try:
        logger.info(f"[{doc_type.upper()}解析] 即将调用 page_index_main...")

        # 关键修复：在子线程中调用 page_index_main 时，需要确保没有残留的事件循环
        # 我们使用 asyncio.run() 在一个全新的事件循环中运行，避免与主线程的事件循环冲突
        # 注意：page_index_main 本身不是异步函数，但它内部会创建并运行异步代码

        # 首先检查当前线程是否有遗留的事件循环
        try:
            existing_loop = asyncio.get_running_loop()
            logger.warning(f"[{doc_type.upper()}解析] 检测到运行中的事件循环: {existing_loop}")
            logger.warning(f"[{doc_type.upper()}解析] 这可能导致问题，尝试继续...")
        except RuntimeError:
            logger.debug(f"[{doc_type.upper()}解析] 当前没有运行中的事件循环（符合预期）")

        # 直接调用 page_index_main
        # 它会使用 asyncio.run() 在新的事件循环中运行 page_index_builder
        tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client)
        logger.info(f"[{doc_type.upper()}解析] page_index_main 返回")

    except Exception as e:
        logger.error(f"[{doc_type.upper()}解析] 失败: {type(e).__name__}: {str(e)}")
        logger.error(f"[{doc_type.upper()}解析] 耗时: {time.time() - parse_start:.2f} 秒")
        raise

    parse_time = time.time() - parse_start
    logger.info(f"[{doc_type.upper()}解析] 完成时间: {datetime.now().strftime('%H:%M:%S')}")
    logger.info(f"[{doc_type.upper()}解析] 总耗时: {parse_time:.2f} 秒 ({parse_time/60:.1f} 分钟)")

    # 更新进度：文档解析完成，正在生成摘要
    if progress_callback and config.get("if_add_node_summary"):
        progress_callback("generating_summaries", 65, "正在生成章节摘要...")

    if not tree_result:
        logger.error(f"[{doc_type.upper()}解析] PageIndex 返回 None")
        raise Exception("PageIndex returned None")

    if not tree_result.get("structure"):
        logger.error(f"[{doc_type.upper()}解析] structure 字段为空")
        if "error" in tree_result:
            logger.error(f"[{doc_type.upper()}解析] 错误信息: {tree_result['error']}")
        raise Exception("PageIndex returned empty tree structure")

    return tree_result, parse_time


def _store_to_chromadb(
    section_nodes: List[Dict],
    index_id: str,
    pdf_path_obj: Path,
    storage_dir: str,
    doc_type: str = "pdf",
    progress_callback=None,
) -> float:
    """
    存储到 ChromaDB

    Args:
        section_nodes: 章节节点列表
        index_id: 索引 ID
        pdf_path_obj: PDF/EPUB 文件路径对象
        storage_dir: 存储目录
        doc_type: 文档类型 ("pdf" 或 "epub")
        progress_callback: 进度回调函数

    Returns:
        vector_time: 向量存储耗时（秒）
    """
    if progress_callback:
        progress_callback("store_vectors", 80, "正在向量化并存储到 ChromaDB...")

    storage_dir_path = Path(storage_dir)
    chroma_dir = storage_dir_path / "chroma"
    chroma_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"[向量存储] ChromaDB 目录: {chroma_dir}")

    vector_start = time.time()
    store = ChromaStore(persist_directory=str(chroma_dir))

    # 创建集合
    logger.info(f"[向量存储] 创建集合: {index_id}")
    collection_metadata = {
        "doc_type": doc_type,
        "pdf_name": pdf_path_obj.name,
        "pdf_path": str(pdf_path_obj.absolute()),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "node_count": len(section_nodes),
        "indexing_method": "pageindex_tree",
        "llm_enabled": True,
        # 新增阅读进度字段
        "read_pages": [],  # 已阅读页码列表
        "chat_rounds": 0,  # 对话轮数
        "last_read_at": None,  # 最后阅读时间
    }
    logger.debug(f"[向量存储] 集合元数据: {collection_metadata}")

    store.create_collection(name=index_id, metadata=collection_metadata)
    logger.info("[向量存储] 集合创建成功")

    # 准备文档
    logger.info("[向量存储] 准备向量化文档...")
    documents = [
        {
            "id": node["id"],
            "text": node["text"],
            "metadata": {**node["metadata"], "pdf_name": pdf_path_obj.name},
        }
        for node in section_nodes
    ]

    # 计算总文本长度和统计信息
    total_text_length = sum(len(doc["text"]) for doc in documents)
    avg_text_length = total_text_length // len(documents) if documents else 0

    logger.info("[向量存储] 文档统计:")
    logger.info(f"  - 文档数量: {len(documents)}")
    logger.info(f"  - 总文本长度: {total_text_length:,} 字符")
    logger.info(f"  - 平均文本长度: {avg_text_length:,} 字符")

    # 添加文档到向量数据库
    logger.info("[向量存储] 正在向量化并添加到数据库...")
    embed_start = time.time()
    store.add_documents(index_id, documents)
    embed_time = time.time() - embed_start

    vector_time = time.time() - vector_start
    logger.info("[向量存储] 向量存储完成:")
    logger.info(f"  - 向量化耗时: {embed_time:.2f} 秒")
    logger.info(f"  - 存储总耗时: {vector_time:.2f} 秒")
    logger.info(f"  - 存储文档数: {len(documents)}")

    return vector_time


def _save_metadata(
    index_id: str,
    pdf_path_obj: Path,
    section_nodes: List[Dict],
    tree_result: Dict,
    storage_dir: str,
    doc_type: str = "pdf",
    is_visual_heavy: bool = False,
    visual_detection_result: Optional[Dict[str, Any]] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """
    保存索引元数据

    Args:
        index_id: 索引 ID
        pdf_path_obj: PDF/EPUB 文件路径对象
        section_nodes: 章节节点列表
        tree_result: PageIndex 树结构结果
        storage_dir: 存储目录
        doc_type: 文档类型 ("pdf" 或 "epub")
        is_visual_heavy: 是否为视觉密集型 PDF
        visual_detection_result: 视觉检测结果详情
        progress_callback: 进度回调函数
    """
    if progress_callback:
        progress_callback("save_metadata", 95, "保存索引元数据...")

    storage_dir_path = Path(storage_dir)
    index_dir = storage_dir_path / "indexes"
    index_dir.mkdir(parents=True, exist_ok=True)

    metadata_path = index_dir / f"{index_id}.json"
    # 获取 PDF 总页数
    total_pages = 0
    try:
        import pypdf

        reader = pypdf.PdfReader(str(pdf_path_obj))
        total_pages = len(reader.pages)
    except Exception:
        pass  # 如果获取失败，保持为 0

    metadata_content = {
        "id": index_id,
        "doc_type": doc_type,
        "pdf_name": pdf_path_obj.name,
        "pdf_path": str(pdf_path_obj.absolute()),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "node_count": len(section_nodes),
        "indexing_method": "pageindex_tree",
        "llm_enabled": True,
        "tree_structure": tree_result,
        "sections": section_nodes,
        "visual_heavy": is_visual_heavy,
        # 页数信息
        "total_pages": total_pages,
        # 阅读进度字段
        "read_pages": [],
        "chat_rounds": 0,
        "last_read_at": None,
    }

    # 如果有视觉检测结果，添加详细信息
    if visual_detection_result:
        metadata_content["visual_detection"] = visual_detection_result

    # 注：此函数在 ThreadPoolExecutor 中运行，使用同步 I/O 是可接受的
    # 因为此函数已被异步包装器 index_pdf() 通过 run_in_executor 隔离
    # 文件 I/O 相比 PDF 解析和向量化是微不足道的，不需要额外的异步开销
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata_content, f, ensure_ascii=False, indent=2)

    metadata_size = metadata_path.stat().st_size / 1024  # KB
    logger.info(f"[元数据] 已保存: {metadata_path}")
    logger.info(f"[元数据] 文件大小: {metadata_size:.2f} KB")

    # 返回元数据内容,用于后续的 Markdown 导出
    return metadata_content


def _get_doc_type(file_path: str) -> str:
    """
    根据文件扩展名自动检测文档类型

    Args:
        file_path: 文件路径

    Returns:
        "pdf" 或 "epub"
    """
    if file_path.lower().endswith(".epub"):
        return "epub"
    return "pdf"


def _index_pdf_sync(
    pdf_path: str, storage_dir: str, progress_callback=None, **kwargs
) -> Dict[str, Any]:
    """
    同步 PDF/EPUB 索引函数（在线程池中执行）

    这是原始的同步逻辑，被异步包装器调用

    参数:
        pdf_path: PDF/EPUB 文件路径
        storage_dir: 存储目录
        progress_callback: 进度回调函数，签名为 (step, percent, message)
        **kwargs: 其他配置参数
    """

    # 辅助函数：安全地调用进度回调
    def _update_progress(step: str, percent: int, message: str):
        """安全地调用进度回调，忽略任何异常"""
        if progress_callback:
            try:
                progress_callback(step, percent, message)
            except Exception as e:
                logger.warning(f"进度回调调用失败: {e}")

    pdf_path_obj = Path(pdf_path)
    doc_type = _get_doc_type(pdf_path)
    start_time = time.time()

    logger.info("=" * 60)
    logger.info(f"[索引开始] {doc_type.upper()} 文件: {pdf_path}")
    logger.info("=" * 60)

    # 步骤 1.5: 检测 PDF 类型（是否需要 OCR）- 仅对 PDF 文档
    is_visual_heavy = False
    visual_detection_result = None

    if doc_type == "pdf":
        from pageindex.pdf.ocr import detect_pdf_type

        logger.info("[步骤 1.5/6] 检测 PDF 视觉类型...")
        _update_progress("detect_visual", 15, "检测 PDF 视觉类型...")

        try:
            detector_result = detect_pdf_type(
                pdf_path,
                sample_pages=kwargs.get(
                    "visual_detect_sample_pages", settings.visual_detect_sample_pages
                ),
                text_threshold=kwargs.get("visual_text_threshold", settings.visual_text_threshold),
                image_threshold=kwargs.get(
                    "visual_density_threshold", settings.visual_density_threshold
                ),
            )

            is_visual_heavy = detector_result.is_visual_heavy
            visual_detection_result = {
                "text_density": detector_result.text_density,
                "image_density": detector_result.image_density,
                "reason": detector_result.reason,
            }

            logger.info(f"[PDF分类] 检测结果: {'视觉密集型' if is_visual_heavy else '普通文本型'}")
            logger.info(f"[PDF分类] 文本密度: {detector_result.text_density:.0f} 字符/页")
            logger.info(f"[PDF分类] 图片密度: {detector_result.image_density*100:.1f}%")
            logger.info(f"[PDF分类] 判断依据: {detector_result.reason}")
        except Exception as e:
            logger.warning(f"[PDF分类] 视觉检测失败: {e}，将按普通文本型处理")
            is_visual_heavy = False

    # 解析 LLM 配置
    config = _parse_llm_config(**kwargs)
    if config.get("status") == "error":
        return config

    # 日志记录配置参数
    logger.info(f"[配置参数] LLM Provider: {config['llm_provider']}")
    logger.info(f"[配置参数] LLM Model: {config['model']}")
    logger.info(f"[配置参数] Base URL: {config['base_url'] or '默认'}")
    logger.info(f"[配置参数] Max Pages Per Node: {config['max_pages_per_node']}")
    logger.info(f"[配置参数] Max Tokens Per Node: {config['max_tokens_per_node']}")
    logger.info(f"[配置参数] Add Node Summary: {config['if_add_node_summary']}")
    logger.info(f"[配置参数] Add Node Text: {config['if_add_node_text']}")

    # 步骤 1: 验证文档文件
    logger.info(f"[步骤 1/6] 验证 {doc_type.upper()} 文件...")
    _update_progress("validate_pdf", 10, f"验证 {doc_type.upper()} 文件...")
    is_valid, error_msg, file_size = _validate_pdf_file(pdf_path_obj)
    if not is_valid:
        logger.error(f"{doc_type.upper()} 文件验证失败: {error_msg}")
        return {"status": "error", "error": error_msg}

    if file_size:
        file_size_mb = file_size / (1024 * 1024)
        logger.info(f"文件大小: {file_size_mb:.2f} MB ({file_size} bytes)")

    # 步骤 2: 检查 LLM API 配置
    logger.info("[步骤 2/6] 检查 LLM API 配置...")
    _update_progress("check_llm_config", 20, "检查 LLM API 配置...")
    is_valid, error_msg = _check_llm_config(config["require_llm"], config["api_key"])
    if not is_valid:
        logger.error(f"LLM 配置验证失败: {error_msg}")
        return {"status": "error", "error": error_msg}

    # 获取 LLM API key
    llm_api_key = config["api_key"] or (
        os.getenv("DEEPSEEK_API_KEY") or os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")
    )
    if llm_api_key:
        logger.info(f"LLM API Key: {'*' * min(len(llm_api_key), 12)} ({len(llm_api_key)} 字符)")

    # 生成索引 ID
    file_hash = hashlib.md5(f"{pdf_path_obj.name}{time.time()}".encode()).hexdigest()[:12]
    index_id = f"idx_{file_hash}"
    logger.info(f"索引 ID: {index_id}")

    try:
        # 步骤 3: 初始化 PageIndex 配置
        logger.info("[步骤 3/6] 初始化 PageIndex 配置...")
        _update_progress("init_pageindex", 30, "初始化 PageIndex 配置...")
        opt, llm_client_instance = _setup_pageindex_config(config, llm_api_key)
        logger.info("PageIndex 配置加载完成")

        # 步骤 4: 创建 LLM 客户端（已在 _setup_pageindex_config 中完成）
        logger.info("[步骤 4/6] 创建 LLM 客户端...")
        _update_progress("create_llm_client", 40, "创建 LLM 客户端...")
        if llm_client_instance:
            logger.info(f"LLM 客户端创建成功: {config['llm_provider']}/{config['model']}")

        # 步骤 5: 解析文档结构
        logger.info(f"[步骤 5/6] 开始解析 {doc_type.upper()} 结构 (这可能需要几分钟)...")
        _update_progress("parse_pdf", 50, f"正在解析 {doc_type.upper()} 结构...")
        if doc_type == "pdf":
            logger.info(f"  - 检测目录 (前 {config['toc_check_pages']} 页)")
            logger.info(f"  - 分割章节 (每节点最多 {config['max_pages_per_node']} 页)")
        if config["if_add_node_summary"]:
            logger.info(f"  - 生成摘要 (使用 {config['llm_provider']}/{config['model']})")

        tree_result, parse_time = _parse_pdf_structure(
            pdf_path, opt, llm_client_instance, config, progress_callback
        )

        # 更新进度：文档解析完成
        _update_progress("parse_complete", 70, f"{doc_type.upper()} 结构解析完成，正在提取章节...")

        # 记录返回结果的详细信息
        logger.debug(f"[{doc_type.upper()}解析] 原始结果键: {list(tree_result.keys())}")
        for key, value in tree_result.items():
            if key != "structure" and key != "tree":
                logger.debug(f"[{doc_type.upper()}解析] {key}: {value}")

        structure_list = tree_result.get("structure", [])
        logger.info(f"[{doc_type.upper()}解析] 顶层节点数: {len(structure_list)}")

        # 提取章节节点
        logger.info("=" * 50)
        logger.info("[章节提取] 开始从树状结构提取节点")
        logger.info("=" * 50)

        section_nodes = []
        for idx, top_level_node in enumerate(structure_list):
            node_title = top_level_node.get("title", f"Unknown_{idx}")
            logger.debug(f"[章节提取] 处理顶层节点 {idx + 1}: {node_title}")
            logger.debug(f"  - 起始页: {top_level_node.get('start_index', 'Unknown')}")
            logger.debug(f"  - 结束页: {top_level_node.get('end_index', 'Unknown')}")
            logger.debug(f"  - 节点ID: {top_level_node.get('node_id', 'Unknown')}")

            nodes = _extract_nodes_from_tree(top_level_node)
            section_nodes.extend(nodes)
            if nodes:
                logger.info(f"  ✓ {node_title}: {len(nodes)} 个节点")
            else:
                logger.warning(f"  ⚠ {node_title}: 未提取到节点")

        logger.info("=" * 50)
        logger.info(f"[章节提取] 共提取 {len(section_nodes)} 个章节节点")
        logger.info("=" * 50)

        if not section_nodes:
            logger.error("未能提取任何章节节点")
            raise Exception("No section nodes extracted from tree structure")

        # 显示节点详情
        logger.info("-" * 50)
        logger.info("[节点详情] 前 5 个节点信息:")
        for i, node in enumerate(section_nodes[:5]):
            section = node["metadata"].get("section", "Unknown")
            page = node["metadata"].get("page", "Unknown")
            level = node["metadata"].get("level", 0)
            text_len = len(node["text"])
            logger.info(f"  节点 {i+1}: {section}")
            logger.info(f"    - 页码: {page}, 层级: {level}, 文本长度: {text_len} 字符")

        if len(section_nodes) > 5:
            logger.info(f"  ... 还有 {len(section_nodes) - 5} 个节点")
        logger.info("-" * 50)

        # 步骤 6: 存储到 ChromaDB
        vector_time = _store_to_chromadb(
            section_nodes,
            index_id,
            pdf_path_obj,
            storage_dir,
            doc_type,
            progress_callback,
        )

        # 保存索引元数据
        _save_metadata(
            index_id,
            pdf_path_obj,
            section_nodes,
            tree_result,
            storage_dir,
            doc_type,
            is_visual_heavy,
            visual_detection_result,
            progress_callback,
        )

        # 最终总结
        total_time = time.time() - start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info("[索引完成] ✓ 索引创建成功!")
        logger.info("=" * 60)
        logger.info("  索引信息:")
        logger.info(f"    - 索引 ID: {index_id}")
        logger.info(f"    - 文档类型: {doc_type.upper()}")
        logger.info(f"    - 文件名称: {pdf_path_obj.name}")
        logger.info(f"    - 节点数量: {len(section_nodes)}")
        logger.info("  时间统计:")
        logger.info(f"    - 文档解析: {parse_time:.2f} 秒 ({parse_time/total_time*100:.1f}%)")
        logger.info(f"    - 向量存储: {vector_time:.2f} 秒 ({vector_time/total_time*100:.1f}%)")
        logger.info(f"    - 总耗时: {total_time:.2f} 秒 ({total_time/60:.1f} 分钟)")
        logger.info("=" * 60)
        logger.info("")

        # 更新进度：索引完成
        _update_progress("complete", 100, "索引创建成功！")

        return {
            "status": "success",
            "index_id": index_id,
            "doc_type": doc_type,
            "node_count": len(section_nodes),
            "pdf_name": pdf_path_obj.name,
            "indexing_method": "pageindex_tree",
        }

    except Exception as e:
        total_time = time.time() - start_time
        logger.error("")
        logger.error("=" * 60)
        logger.error("[索引失败] ✗ 索引创建失败")
        logger.error("=" * 60)
        logger.error("  错误信息:")
        logger.error(f"    - 异常类型: {type(e).__name__}")
        logger.error(f"    - 错误内容: {str(e)}")
        logger.error("  上下文信息:")
        logger.error(f"    - PDF 文件: {pdf_path}")
        logger.error(f"    - 耗时: {total_time:.2f} 秒")
        logger.error("=" * 60)
        logger.error("", exc_info=True)

        return {"status": "error", "error": f"Unexpected error: {str(e)}"}


async def index_pdf(
    pdf_path: str, storage_dir: str, progress_callback=None, **kwargs
) -> Dict[str, Any]:
    """
    异步 PDF/EPUB 索引

    使用 ThreadPoolExecutor 处理 CPU 密集型任务
    自动检测文档类型（PDF 或 EPUB）

    参数:
        pdf_path: PDF/EPUB 文件路径
        storage_dir: 存储目录
        progress_callback: 进度回调函数，签名为 (step, percent, message)
        **kwargs: 其他配置参数
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        cpu_executor,
        functools.partial(
            _index_pdf_sync,
            pdf_path=pdf_path,
            storage_dir=storage_dir,
            progress_callback=progress_callback,
            **kwargs,
        ),
    )
    return result
