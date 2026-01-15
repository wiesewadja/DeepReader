"""
PDF 索引服务 - 异步封装
"""
import asyncio
import functools
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Any

from pageindex import page_index_main
from pageindex.utils import ConfigLoader
from pageindex.llm_provider import UnifiedLLM

# 导入旧的存储模块（暂时使用旧位置）
import sys
sys.path.insert(0, 'deeppdf-api/deeppdf/src')
from deeppdf.storage.chroma_store import ChromaStore


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
    content_for_embedding = node_summary or node_text

    if content_for_embedding and content_for_embedding.strip():
        page_info = start_page
        nodes.append({
            "id": node_id or f"node_{len(nodes)}",
            "text": content_for_embedding.strip(),
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
    **kwargs
) -> Dict[str, Any]:
    """
    同步 PDF 索引函数（在线程池中执行）

    这是原始的同步逻辑，被异步包装器调用
    """
    pdf_path_obj = Path(pdf_path)

    # 从环境变量读取默认配置
    model = kwargs.get("model") or _get_env_default("PDF_INDEX_MODEL", "deepseek-chat")
    llm_provider = kwargs.get("llm_provider") or _get_env_default("PDF_INDEX_LLM_PROVIDER", "deepseek")
    base_url = kwargs.get("base_url") or _get_env_default("PDF_INDEX_BASE_URL", None)
    toc_check_pages = kwargs.get("toc_check_pages") or _get_env_default("PDF_INDEX_TOC_CHECK_PAGES", 20, int)
    max_pages_per_node = kwargs.get("max_pages_per_node") or _get_env_default("PDF_INDEX_MAX_PAGES_PER_NODE", 10, int)
    max_tokens_per_node = kwargs.get("max_tokens_per_node") or _get_env_default("PDF_INDEX_MAX_TOKENS_PER_NODE", 20000, int)
    if_add_node_id = kwargs.get("if_add_node_id") or _get_env_default("PDF_INDEX_IF_ADD_NODE_ID", "yes")
    if_add_node_summary = kwargs.get("if_add_node_summary") or _get_env_default("PDF_INDEX_IF_ADD_NODE_SUMMARY", "yes")
    if_add_node_text = kwargs.get("if_add_node_text") or _get_env_default("PDF_INDEX_IF_ADD_NODE_TEXT", "no")
    if_add_doc_description = kwargs.get("if_add_doc_description") or _get_env_default("PDF_INDEX_IF_ADD_DOC_DESCRIPTION", "no")
    require_llm = kwargs.get("require_llm", True)
    api_key = kwargs.get("api_key")

    # 验证文件存在
    if not pdf_path_obj.exists():
        return {
            "status": "error",
            "error": f"PDF file not found: {pdf_path}"
        }

    # 验证文件大小
    try:
        if pdf_path_obj.stat().st_size < 1024:
            return {
                "status": "error",
                "error": "PDF file is too small (< 1KB)"
            }
    except FileNotFoundError:
        return {
            "status": "error",
            "error": "PDF file is too small (< 1KB)"
        }

    # 检查 LLM API 配置
    llm_api_key = api_key or (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("CHATGPT_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )
    if require_llm and not llm_api_key:
        return {
            "status": "error",
            "error": "LLM API key is required for PageIndex tree indexing. "
                    "Please set DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable."
        }

    # 生成索引 ID
    file_hash = hashlib.md5(
        f"{pdf_path_obj.name}{time.time()}".encode()
    ).hexdigest()[:12]
    index_id = f"idx_{file_hash}"

    try:
        # 使用 PageIndex 生成章节树状结构
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
        opt = config_loader.load(user_opt)

        # 创建 LLM client
        llm_client_instance = None
        if require_llm and llm_api_key:
            from pageindex.llm_provider import get_provider
            provider = get_provider(user_opt["llm_provider"])
            llm_client_instance = UnifiedLLM(provider=provider, model=opt.model)

        # 调用 page_index_main
        tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client_instance)

        if not tree_result or not tree_result.get("structure"):
            raise Exception("PageIndex returned empty tree structure")

        # 从树状结构提取章节节点
        section_nodes = []
        for top_level_node in tree_result.get("structure", []):
            section_nodes.extend(_extract_nodes_from_tree(top_level_node))

        if not section_nodes:
            raise Exception("No section nodes extracted from tree structure")

        # 存储到 ChromaDB
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"
        chroma_dir.mkdir(parents=True, exist_ok=True)

        store = ChromaStore(persist_directory=str(chroma_dir))
        store.create_collection(
            name=index_id,
            metadata={
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(section_nodes),
                "indexing_method": "pageindex_tree",
                "llm_enabled": require_llm
            }
        )

        # 准备文档
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

        store.add_documents(index_id, documents)

        # 保存索引元数据
        index_dir = storage_dir_path / "indexes"
        index_dir.mkdir(parents=True, exist_ok=True)

        metadata_path = index_dir / f"{index_id}.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump({
                "id": index_id,
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(section_nodes),
                "indexing_method": "pageindex_tree",
                "llm_enabled": require_llm,
                "tree_structure": tree_result,
                "sections": section_nodes
            }, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "index_id": index_id,
            "node_count": len(section_nodes),
            "pdf_name": pdf_path_obj.name,
            "indexing_method": "pageindex_tree"
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }


async def index_pdf(
    pdf_path: str,
    storage_dir: str,
    **kwargs
) -> Dict[str, Any]:
    """
    异步 PDF 索引

    使用 ThreadPoolExecutor 处理 CPU 密集型任务
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        cpu_executor,
        functools.partial(_index_pdf_sync, pdf_path=pdf_path, storage_dir=storage_dir, **kwargs)
    )
    return result
