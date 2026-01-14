"""
PDF 索引模块 - 使用 PageIndex 进行章节级向量索引

索引策略：
1. 使用 PageIndex + LLM API 获取章节树状结构
2. 向量化内容：优先使用 summary（AI 生成的摘要），fallback 到 text（原始文本）
3. 元数据包含：section, level, page, node_name, node_id, start_index, end_index

环境变量配置（.env 文件）：
- PDF_INDEX_LLM_PROVIDER: LLM provider 类型（默认 deepseek）
- PDF_INDEX_MODEL: 使用的模型名称（默认 deepseek-chat）
- PDF_INDEX_BASE_URL: API Base URL（可选）
- PDF_INDEX_TOC_CHECK_PAGES: 检查目录的页数（默认 20）
- PDF_INDEX_MAX_PAGES_PER_NODE: 每个节点最大页数（默认 10）
- PDF_INDEX_MAX_TOKENS_PER_NODE: 每个节点最大 token 数（默认 20000）
- PDF_INDEX_IF_ADD_NODE_ID: 是否添加节点 ID（默认 yes）
- PDF_INDEX_IF_ADD_NODE_SUMMARY: 是否添加摘要（默认 yes）
- PDF_INDEX_IF_ADD_NODE_TEXT: 是否添加文本内容（默认 no）
- PDF_INDEX_IF_ADD_DOC_DESCRIPTION: 是否添加文档描述（默认 no）
"""
import hashlib
import json
import time
import os
from pathlib import Path
from typing import Dict, Any, List, Optional
from pageindex import page_index_main
from pageindex.utils import ConfigLoader
from pageindex.llm_provider import UnifiedLLM
from ..storage.chroma_store import ChromaStore


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


class PDFIndexError(Exception):
    """PDF 索引错误"""
    pass


class LLMRequiredError(PDFIndexError):
    """LLM API 必需但未配置"""
    pass


def _extract_nodes_from_tree(
    tree: Dict[str, Any],
    parent_section: str = "",
    level: int = 0
) -> List[Dict[str, Any]]:
    """
    从 PageIndex 树状结构中提取章节节点

    字段命名（与 run_pageindex.py 保持一致）：
    - title: 章节标题
    - nodes: 子节点数组
    - start_index/end_index: 页码范围
    - node_id: 节点唯一标识
    - summary: 章节摘要
    - text: 章节文本内容（可选，由 if_add_node_text 控制）

    每个节点代表一个语义完整的章节，包含：
    - node_id: 节点唯一标识
    - text: 章节摘要内容（用于向量化，优先使用 summary，其次使用 text）
    - metadata: section, level, page, node_name

    Args:
        tree: PageIndex 返回的树状结构（包含 structure 数组）
        parent_section: 父节点路径
        level: 当前层级深度

    Returns:
        章节节点列表
    """
    nodes = []

    if not tree:
        return nodes

    # 使用与 run_pageindex.py 一致的字段命名
    node_name = tree.get("title", "")
    start_page = tree.get("start_index")
    end_page = tree.get("end_index")
    node_text = tree.get("text", "")
    node_id = tree.get("node_id", "")
    node_summary = tree.get("summary", "")

    # 构建完整章节路径
    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 优先使用 summary 进行向量化，如果没有则使用 text
    content_for_embedding = node_summary or node_text

    # 如果节点有内容，创建一个章节节点（这是向量化的单位）
    if content_for_embedding and content_for_embedding.strip():
        # 页码信息：优先使用 start_index，如果没有则尝试其他可能字段
        page_info = start_page

        nodes.append({
            "id": node_id or f"node_{len(nodes)}",
            "text": content_for_embedding.strip(),
            "metadata": {
                "section": current_section,     # 完整章节路径
                "level": level,                  # 层级深度
                "page": page_info,               # 起始页码
                "start_index": start_page,       # 起始页码（原始字段）
                "end_index": end_page,           # 结束页码（原始字段）
                "node_name": node_name,          # 当前节点名称
                "node_id": node_id,              # 节点唯一标识
            }
        })

    # 递归处理子节点（使用 nodes 字段）
    children = tree.get("nodes", [])
    for child in children:
        nodes.extend(_extract_nodes_from_tree(child, current_section, level + 1))

    return nodes


def index_pdf(
    pdf_path: str,
    storage_dir: str,
    require_llm: bool = True,
    model: str = None,
    llm_provider: str = None,
    api_key: str = None,
    base_url: str = None,
    toc_check_pages: int = None,
    max_pages_per_node: int = None,
    max_tokens_per_node: int = None,
    if_add_node_id: str = None,
    if_add_node_summary: str = None,
    if_add_node_text: str = None,
    if_add_doc_description: str = None,
) -> Dict[str, Any]:
    """
    索引 PDF 文件（使用 PageIndex 章节级索引）

    核心逻辑：
    1. 使用 PageIndex + LLM 生成章节树状结构
    2. 提取章节节点作为向量化单位
    3. 存储到 ChromaDB（中文嵌入模型）

    所有参数都支持从环境变量读取默认值（.env 文件）：
    - PDF_INDEX_LLM_PROVIDER, PDF_INDEX_MODEL, 等

    Args:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录
        require_llm: 是否强制要求 LLM API（默认 True）
        model: 使用的模型名称（默认从 PDF_INDEX_MODEL 读取，默认值 deepseek-chat）
        llm_provider: LLM provider 类型（默认从 PDF_INDEX_LLM_PROVIDER 读取，默认值 deepseek）
        api_key: LLM API 密钥（默认从 DEEPSEEK_API_KEY/OPENAI_API_KEY 读取）
        base_url: 自定义 API 端点（默认从 PDF_INDEX_BASE_URL 读取）
        toc_check_pages: 检查目录的页数（默认从 PDF_INDEX_TOC_CHECK_PAGES 读取，默认值 20）
        max_pages_per_node: 每个节点最大页数（默认从 PDF_INDEX_MAX_PAGES_PER_NODE 读取，默认值 10）
        max_tokens_per_node: 每个节点最大 token 数（默认从 PDF_INDEX_MAX_TOKENS_PER_NODE 读取，默认值 20000）
        if_add_node_id: 是否添加节点 ID（默认从 PDF_INDEX_IF_ADD_NODE_ID 读取，默认值 yes）
        if_add_node_summary: 是否添加摘要（默认从 PDF_INDEX_IF_ADD_NODE_SUMMARY 读取，默认值 yes）
        if_add_node_text: 是否添加文本内容（默认从 PDF_INDEX_IF_ADD_NODE_TEXT 读取，默认值 no）
        if_add_doc_description: 是否添加文档描述（默认从 PDF_INDEX_IF_ADD_DOC_DESCRIPTION 读取，默认值 no）

    Returns:
        索引结果，包含 index_id, node_count, status

    Raises:
        FileNotFoundError: PDF 文件不存在
        LLMRequiredError: LLM API 未配置但必需
        PDFIndexError: 索引失败
    """
    pdf_path_obj = Path(pdf_path)

    # 从环境变量读取默认配置（如果参数未指定）
    model = model or _get_env_default("PDF_INDEX_MODEL", "deepseek-chat")
    llm_provider = llm_provider or _get_env_default("PDF_INDEX_LLM_PROVIDER", "deepseek")
    base_url = base_url or _get_env_default("PDF_INDEX_BASE_URL", None)
    toc_check_pages = toc_check_pages or _get_env_default("PDF_INDEX_TOC_CHECK_PAGES", 20, int)
    max_pages_per_node = max_pages_per_node or _get_env_default("PDF_INDEX_MAX_PAGES_PER_NODE", 10, int)
    max_tokens_per_node = max_tokens_per_node or _get_env_default("PDF_INDEX_MAX_TOKENS_PER_NODE", 20000, int)
    if_add_node_id = if_add_node_id or _get_env_default("PDF_INDEX_IF_ADD_NODE_ID", "yes")
    if_add_node_summary = if_add_node_summary or _get_env_default("PDF_INDEX_IF_ADD_NODE_SUMMARY", "yes")
    if_add_node_text = if_add_node_text or _get_env_default("PDF_INDEX_IF_ADD_NODE_TEXT", "no")
    if_add_doc_description = if_add_doc_description or _get_env_default("PDF_INDEX_IF_ADD_DOC_DESCRIPTION", "no")

    # 验证文件存在
    if not pdf_path_obj.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    # 验证文件大小（避免空文件）
    if pdf_path_obj.stat().st_size < 1024:
        return {
            "status": "error",
            "error": "PDF file is too small (< 1KB)"
        }

    # 检查 LLM API 配置（优先使用传入的 api_key，否则从环境变量读取）
    llm_api_key = api_key or (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("CHATGPT_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )
    if require_llm and not llm_api_key:
        raise LLMRequiredError(
            "LLM API key is required for PageIndex tree indexing. "
            "Please set DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable."
        )

    # 生成索引 ID（基于文件名和时间的 hash）
    file_hash = hashlib.md5(
        f"{pdf_path_obj.name}{time.time()}".encode()
    ).hexdigest()[:12]
    index_id = f"idx_{file_hash}"

    try:
        # 使用 PageIndex 生成章节树状结构
        print(f"🔍 正在索引 PDF: {pdf_path_obj.name}")
        print(f"   使用 LLM API: {'是' if llm_api_key else '否'}")
        print(f"   LLM Provider: {llm_provider}")
        print(f"   模型: {model}")

        # 配置 PageIndex（参照 run_pageindex.py 的配置方式）
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

        # 创建 LLM client（参照 run_pageindex.py）
        llm_client_instance = None
        if require_llm and llm_api_key:
            from pageindex.llm_provider import get_provider
            provider = get_provider(user_opt["llm_provider"])
            llm_client_instance = UnifiedLLM(provider=provider, model=opt.model)

        # 调用 page_index_main
        tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client_instance)

        if not tree_result or not tree_result.get("structure"):
            raise PDFIndexError("PageIndex returned empty tree structure")

        print(f"✅ PageIndex 解析成功")

        # 从树状结构提取章节节点
        # tree_result 包含 doc_name 和 structure 数组
        # structure 是顶层节点数组，每个节点包含 nodes 子节点
        section_nodes = []
        for top_level_node in tree_result.get("structure", []):
            section_nodes.extend(_extract_nodes_from_tree(top_level_node))
        print(f"✅ 提取了 {len(section_nodes)} 个章节节点")

        if not section_nodes:
            raise PDFIndexError("No section nodes extracted from tree structure")

        # 打印章节结构预览
        print(f"\n📚 章节结构:")
        for node in section_nodes[:10]:  # 只显示前 10 个
            indent = "  " * node["metadata"]["level"]
            page_info = ""
            if node["metadata"].get("start_index") and node["metadata"].get("end_index"):
                page_info = f"页 {node['metadata']['start_index']}-{node['metadata']['end_index']}"
            elif node["metadata"].get("start_index"):
                page_info = f"页 {node['metadata']['start_index']}"
            elif node["metadata"].get("page"):
                page_info = f"页 {node['metadata']['page']}"
            print(f"{indent}▪ {node['metadata']['node_name']} ({page_info})")
        if len(section_nodes) > 10:
            print(f"  ... 还有 {len(section_nodes) - 10} 个节点")
        print()

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

        # 准备文档（章节节点）
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
        print(f"✅ 已存储到 ChromaDB: {len(documents)} 个章节节点")

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

    except LLMRequiredError:
        raise
    except FileNotFoundError:
        return {
            "status": "error",
            "error": f"PDF file not found: {pdf_path}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }
