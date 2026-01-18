"""
PDF 索引服务 - 异步封装
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
from typing import Dict, Any
from datetime import datetime

from pageindex import page_index_main
from pageindex.core import ConfigLoader
from pageindex.llm import UnifiedLLM, get_provider

# 导入存储模块
from deeppdf.storage.chroma_store import ChromaStore

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


# 全局线程池
cpu_executor = ThreadPoolExecutor(max_workers=2)


def _get_env_default(key: str, default: Any = None, cast_type: type = str) -> Any:
    """从环境变量获取配置值，支持类型转换"""
    value = os.getenv(key, default)
    if value is None or value == default:
        return default
    if cast_type == bool:
        return value.lower() in ("yes", "true", "1", "on")
    if cast_type == int:
        try:
            return int(value)
        except (ValueError, TypeError):
            return default
    return value


def _extract_nodes_from_tree(
    tree: Dict[str, Any],
    parent_section: str = "",
    level: int = 0
) -> list:
    """从 PageIndex 树状结构中提取章节节点"""
    nodes = []

    if not tree:
        return nodes

    node_name = tree.get("title", "")
    start_page = tree.get("start_index")
    end_page = tree.get("end_index")
    node_text = tree.get("text", "")
    node_id = tree.get("node_id", "")
    node_summary = tree.get("summary", "")

    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 优先使用摘要，如果没有摘要则使用原文
    # 将章节名称添加到内容前，提供更好的上下文
    content_for_embedding = node_summary or node_text

    # 组合章节名称和内容，提高检索准确性
    if content_for_embedding and content_for_embedding.strip():
        full_text_for_embedding = f"【{current_section}】\n{content_for_embedding.strip()}"
    else:
        full_text_for_embedding = None

    if full_text_for_embedding:
        page_info = start_page
        nodes.append({
            "id": node_id or f"node_{len(nodes)}",
            "text": full_text_for_embedding,
            "metadata": {
                "section": current_section,
                "level": level,
                "page": page_info,
                "start_index": start_page,
                "end_index": end_page,
                "node_name": node_name,
                "node_id": node_id,
            }
        })

    children = tree.get("nodes", [])
    for child in children:
        nodes.extend(_extract_nodes_from_tree(child, current_section, level + 1))

    return nodes


def _index_pdf_sync(
    pdf_path: str,
    storage_dir: str,
    progress_callback=None,
    **kwargs
) -> Dict[str, Any]:
    """
    同步 PDF 索引函数（在线程池中执行）

    这是原始的同步逻辑，被异步包装器调用

    参数:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录
        progress_callback: 进度回调函数，签名为 (step, percent, message)
        **kwargs: 其他配置参数
    """
    pdf_path_obj = Path(pdf_path)
    start_time = time.time()

    logger.info("="*60)
    logger.info(f"[索引开始] PDF 文件: {pdf_path}")
    logger.info("="*60)

    # 辅助函数：安全地调用进度回调
    def _update_progress(step: str, percent: int, message: str):
        """安全地调用进度回调，忽略任何异常"""
        if progress_callback:
            try:
                progress_callback(step, percent, message)
            except Exception as e:
                logger.warning(f"进度回调调用失败: {e}")

    # 从环境变量读取默认配置
    model = kwargs.get("model") or _get_env_default("PDF_INDEX_MODEL", "deepseek-chat")
    llm_provider = kwargs.get("llm_provider") or _get_env_default("PDF_INDEX_LLM_PROVIDER", "deepseek")
    base_url = kwargs.get("base_url") or _get_env_default("PDF_INDEX_BASE_URL", None)

    # custom provider 必须提供 base_url
    if llm_provider == "custom" and not base_url:
        logger.error("使用 custom provider 时必须提供 base_url")
        return {
            "status": "error",
            "error": "When using 'custom' llm_provider, 'api_url' parameter is required. "
                    "Please provide the base URL of your custom LLM API (e.g., https://api.siliconflow.cn/v1)."
        }

    toc_check_pages = kwargs.get("toc_check_pages") or _get_env_default("PDF_INDEX_TOC_CHECK_PAGES", 20, int)
    max_pages_per_node = kwargs.get("max_pages_per_node") or _get_env_default("PDF_INDEX_MAX_PAGES_PER_NODE", 10, int)
    max_tokens_per_node = kwargs.get("max_tokens_per_node") or _get_env_default("PDF_INDEX_MAX_TOKENS_PER_NODE", 20000, int)
    if_add_node_id = kwargs.get("if_add_node_id") or _get_env_default("PDF_INDEX_IF_ADD_NODE_ID", "yes")
    if_add_node_summary = kwargs.get("if_add_node_summary") or _get_env_default("PDF_INDEX_IF_ADD_NODE_SUMMARY", "yes")
    if_add_node_text = kwargs.get("if_add_node_text") or _get_env_default("PDF_INDEX_IF_ADD_NODE_TEXT", "no")
    if_add_doc_description = kwargs.get("if_add_doc_description") or _get_env_default("PDF_INDEX_IF_ADD_DOC_DESCRIPTION", "no")
    require_llm = kwargs.get("require_llm", True)
    api_key = kwargs.get("api_key")

    logger.info(f"[配置参数] LLM Provider: {llm_provider}")
    logger.info(f"[配置参数] LLM Model: {model}")
    logger.info(f"[配置参数] Base URL: {base_url or '默认'}")
    logger.info(f"[配置参数] Max Pages Per Node: {max_pages_per_node}")
    logger.info(f"[配置参数] Max Tokens Per Node: {max_tokens_per_node}")
    logger.info(f"[配置参数] Add Node Summary: {if_add_node_summary}")
    logger.info(f"[配置参数] Add Node Text: {if_add_node_text}")

    # 验证文件存在
    logger.info(f"[步骤 1/6] 验证 PDF 文件...")
    _update_progress("validate_pdf", 10, "验证 PDF 文件...")
    if not pdf_path_obj.exists():
        logger.error(f"文件不存在: {pdf_path}")
        return {
            "status": "error",
            "error": f"PDF file not found: {pdf_path}"
        }

    # 验证文件大小
    try:
        file_size = pdf_path_obj.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        logger.info(f"文件大小: {file_size_mb:.2f} MB ({file_size} bytes)")
        if file_size < 1024:
            logger.error(f"文件过小: {file_size} bytes")
            return {
                "status": "error",
                "error": "PDF file is too small (< 1KB)"
            }
    except FileNotFoundError as e:
        logger.error(f"无法读取文件: {e}")
        return {
            "status": "error",
            "error": "PDF file is too small (< 1KB)"
        }

    # 检查 LLM API 配置
    logger.info(f"[步骤 2/6] 检查 LLM API 配置...")
    _update_progress("check_llm_config", 20, "检查 LLM API 配置...")
    llm_api_key = api_key or (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("CHATGPT_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )
    if require_llm and not llm_api_key:
        logger.error("未找到 LLM API key")
        return {
            "status": "error",
            "error": "LLM API key is required for PageIndex tree indexing. "
                    "Please set DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable."
        }
    if llm_api_key:
        logger.info(f"LLM API Key: {llm_api_key[:10]}...{llm_api_key[-4:]}")

    # 生成索引 ID
    file_hash = hashlib.md5(
        f"{pdf_path_obj.name}{time.time()}".encode()
    ).hexdigest()[:12]
    index_id = f"idx_{file_hash}"
    logger.info(f"索引 ID: {index_id}")

    try:
        # 使用 PageIndex 生成章节树状结构
        logger.info(f"[步骤 3/6] 初始化 PageIndex 配置...")
        _update_progress("init_pageindex", 30, "初始化 PageIndex 配置...")
        config_loader = ConfigLoader()

        user_opt = {
            "model": model,
            "if_add_node_summary": if_add_node_summary if require_llm else "no",
            "if_add_node_text": if_add_node_text,
            "if_add_node_id": if_add_node_id,
            "if_add_doc_description": if_add_doc_description,
            "toc_check_page_num": toc_check_pages,
            "max_page_num_each_node": max_pages_per_node,
            "max_token_num_each_node": max_tokens_per_node,
            "llm_provider": {
                "type": llm_provider,
                "api_key": llm_api_key,
                "base_url": base_url,
            },
        }
        logger.debug(f"[PageIndex配置] llm_provider: type={llm_provider}, base_url={base_url}")
        opt = config_loader.load(user_opt)
        logger.info("PageIndex 配置加载完成")

        # 创建 LLM client
        logger.info(f"[步骤 4/6] 创建 LLM 客户端...")
        _update_progress("create_llm_client", 40, "创建 LLM 客户端...")
        llm_client_instance = None
        if require_llm and llm_api_key:
            provider = get_provider(user_opt["llm_provider"])
            llm_client_instance = UnifiedLLM(provider=provider, model=opt.model)
            logger.info(f"LLM 客户端创建成功: {llm_provider}/{model}")

        # 调用 page_index_main
        logger.info(f"[步骤 5/6] 开始解析 PDF 结构 (这可能需要几分钟)...")
        logger.info(f"  - 检测目录 (前 {toc_check_pages} 页)")
        logger.info(f"  - 分割章节 (每节点最多 {max_pages_per_node} 页)")
        _update_progress("parse_pdf_structure", 50, "开始解析 PDF 结构 (这可能需要几分钟)...")
        if if_add_node_summary == "yes":
            logger.info(f"  - 生成摘要 (使用 {llm_provider}/{model})")

        # 显示解析开始时间
        parse_start = time.time()
        logger.info(f"[PDF解析] 开始时间: {datetime.now().strftime('%H:%M:%S')}")
        logger.info(f"[PDF解析] 输入文件: {pdf_path_obj.name}")
        logger.info(f"[PDF解析] 配置参数: to_check={toc_check_pages}, max_pages={max_pages_per_node}, max_tokens={max_tokens_per_node}")

        try:
            tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client_instance)
        except Exception as e:
            logger.error(f"[PDF解析] 失败: {type(e).__name__}: {str(e)}")
            logger.error(f"[PDF解析] 耗时: {time.time() - parse_start:.2f} 秒")
            raise

        parse_time = time.time() - parse_start
        logger.info(f"[PDF解析] 完成时间: {datetime.now().strftime('%H:%M:%S')}")
        logger.info(f"[PDF解析] 总耗时: {parse_time:.2f} 秒 ({parse_time/60:.1f} 分钟)")

        # 更新进度：PDF 解析完成
        _update_progress("parse_complete", 70, "PDF 结构解析完成，正在提取章节...")

        if not tree_result:
            logger.error("[PDF解析] PageIndex 返回 None")
            raise Exception("PageIndex returned None")

        # 记录返回结果的详细信息
        logger.debug(f"[PDF解析] 原始结果键: {list(tree_result.keys())}")
        for key, value in tree_result.items():
            if key != "structure" and key != "tree":
                logger.debug(f"[PDF解析] {key}: {value}")

        if not tree_result.get("structure"):
            logger.error("[PDF解析] structure 字段为空")
            # 检查是否有其他字段
            if "error" in tree_result:
                logger.error(f"[PDF解析] 错误信息: {tree_result['error']}")
            raise Exception("PageIndex returned empty tree structure")

        structure_list = tree_result.get("structure", [])
        logger.info(f"[PDF解析] 顶层节点数: {len(structure_list)}")

        # 从树状结构提取章节节点
        logger.info("=" * 50)
        logger.info("[章节提取] 开始从树状结构提取节点")
        logger.info("=" * 50)

        section_nodes = []
        for idx, top_level_node in enumerate(structure_list):
            node_title = top_level_node.get('title', f'Unknown_{idx}')
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
        logger.info(f"[节点详情] 前 5 个节点信息:")
        for i, node in enumerate(section_nodes[:5]):
            section = node['metadata'].get('section', 'Unknown')
            page = node['metadata'].get('page', 'Unknown')
            level = node['metadata'].get('level', 0)
            text_len = len(node['text'])
            logger.info(f"  节点 {i+1}: {section}")
            logger.info(f"    - 页码: {page}, 层级: {level}, 文本长度: {text_len} 字符")

        if len(section_nodes) > 5:
            logger.info(f"  ... 还有 {len(section_nodes) - 5} 个节点")
        logger.info("-" * 50)

        # 存储到 ChromaDB
        logger.info("=" * 50)
        logger.info(f"[向量存储] 开始存储到 ChromaDB")
        logger.info("=" * 50)
        _update_progress("store_vectors", 80, "正在向量化并存储到 ChromaDB...")

        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"
        chroma_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[向量存储] ChromaDB 目录: {chroma_dir}")

        vector_start = time.time()
        store = ChromaStore(persist_directory=str(chroma_dir))

        # 创建集合
        logger.info(f"[向量存储] 创建集合: {index_id}")
        collection_metadata = {
            "pdf_name": pdf_path_obj.name,
            "pdf_path": str(pdf_path_obj.absolute()),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "node_count": len(section_nodes),
            "indexing_method": "pageindex_tree",
            "llm_enabled": require_llm
        }
        logger.debug(f"[向量存储] 集合元数据: {collection_metadata}")

        store.create_collection(
            name=index_id,
            metadata=collection_metadata
        )
        logger.info(f"[向量存储] 集合创建成功")

        # 准备文档
        logger.info("[向量存储] 准备向量化文档...")
        doc_start = time.time()

        documents = [
            {
                "id": node["id"],
                "text": node["text"],
                "metadata": {
                    **node["metadata"],
                    "pdf_name": pdf_path_obj.name
                }
            }
            for node in section_nodes
        ]

        # 计算总文本长度和统计信息
        total_text_length = sum(len(doc["text"]) for doc in documents)
        avg_text_length = total_text_length // len(documents) if documents else 0

        logger.info(f"[向量存储] 文档统计:")
        logger.info(f"  - 文档数量: {len(documents)}")
        logger.info(f"  - 总文本长度: {total_text_length:,} 字符")
        logger.info(f"  - 平均文本长度: {avg_text_length:,} 字符")

        # 添加文档到向量数据库
        logger.info("[向量存储] 正在向量化并添加到数据库...")
        embed_start = time.time()
        store.add_documents(index_id, documents)
        embed_time = time.time() - embed_start

        vector_time = time.time() - vector_start
        logger.info(f"[向量存储] 向量存储完成:")
        logger.info(f"  - 向量化耗时: {embed_time:.2f} 秒")
        logger.info(f"  - 存储总耗时: {vector_time:.2f} 秒")
        logger.info(f"  - 存储文档数: {len(documents)}")

        # 保存索引元数据
        logger.info("=" * 50)
        logger.info("[元数据] 保存索引元数据...")
        _update_progress("save_metadata", 95, "保存索引元数据...")

        index_dir = storage_dir_path / "indexes"
        index_dir.mkdir(parents=True, exist_ok=True)

        metadata_path = index_dir / f"{index_id}.json"
        metadata_content = {
            "id": index_id,
            "pdf_name": pdf_path_obj.name,
            "pdf_path": str(pdf_path_obj.absolute()),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "node_count": len(section_nodes),
            "indexing_method": "pageindex_tree",
            "llm_enabled": require_llm,
            "tree_structure": tree_result,
            "sections": section_nodes
        }

        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata_content, f, ensure_ascii=False, indent=2)

        metadata_size = metadata_path.stat().st_size / 1024  # KB
        logger.info(f"[元数据] 已保存: {metadata_path}")
        logger.info(f"[元数据] 文件大小: {metadata_size:.2f} KB")

        # 最终总结
        total_time = time.time() - start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info(f"[索引完成] ✓ 索引创建成功!")
        logger.info("=" * 60)
        logger.info(f"  索引信息:")
        logger.info(f"    - 索引 ID: {index_id}")
        logger.info(f"    - PDF 名称: {pdf_path_obj.name}")
        logger.info(f"    - 节点数量: {len(section_nodes)}")
        logger.info(f"  时间统计:")
        logger.info(f"    - PDF 解析: {parse_time:.2f} 秒 ({parse_time/total_time*100:.1f}%)")
        logger.info(f"    - 向量存储: {vector_time:.2f} 秒 ({vector_time/total_time*100:.1f}%)")
        logger.info(f"    - 总耗时: {total_time:.2f} 秒 ({total_time/60:.1f} 分钟)")
        logger.info("=" * 60)
        logger.info("")

        # 更新进度：索引完成
        _update_progress("complete", 100, "索引创建成功！")

        return {
            "status": "success",
            "index_id": index_id,
            "node_count": len(section_nodes),
            "pdf_name": pdf_path_obj.name,
            "indexing_method": "pageindex_tree"
        }

    except Exception as e:
        total_time = time.time() - start_time
        logger.error("")
        logger.error("=" * 60)
        logger.error(f"[索引失败] ✗ 索引创建失败")
        logger.error("=" * 60)
        logger.error(f"  错误信息:")
        logger.error(f"    - 异常类型: {type(e).__name__}")
        logger.error(f"    - 错误内容: {str(e)}")
        logger.error(f"  上下文信息:")
        logger.error(f"    - PDF 文件: {pdf_path}")
        logger.error(f"    - 耗时: {total_time:.2f} 秒")
        logger.error("=" * 60)
        logger.error("", exc_info=True)

        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }


async def index_pdf(
    pdf_path: str,
    storage_dir: str,
    progress_callback=None,
    **kwargs
) -> Dict[str, Any]:
    """
    异步 PDF 索引

    使用 ThreadPoolExecutor 处理 CPU 密集型任务

    参数:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录
        progress_callback: 进度回调函数，签名为 (step, percent, message)
        **kwargs: 其他配置参数
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        cpu_executor,
        functools.partial(_index_pdf_sync, pdf_path=pdf_path, storage_dir=storage_dir, progress_callback=progress_callback, **kwargs)
    )
    return result
