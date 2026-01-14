"""
PDF 索引模块 - 使用 PageIndex 进行章节级向量索引

索引策略：
1. 必须使用 LLM API 获取章节树状结构（PageIndex 核心功能）
2. 向量化内容：章节节点文本（非页面文本）
3. 元数据包含：section, level, page, node_name
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

    每个节点代表一个语义完整的章节，包含：
    - node_id: 节点唯一标识
    - text: 章节文本内容（用于向量化）
    - metadata: section, level, page, node_name

    Args:
        tree: PageIndex 返回的树状结构
        parent_section: 父节点路径
        level: 当前层级深度

    Returns:
        章节节点列表
    """
    nodes = []

    if not tree:
        return nodes

    # 当前节点信息
    node_name = tree.get("name", "")
    page_number = tree.get("page_number", None)
    node_text = tree.get("text", "")
    node_id = tree.get("node_id", "")

    # 构建完整章节路径
    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 如果节点有文本内容，创建一个章节节点（这是向量化的单位）
    if node_text and node_text.strip():
        nodes.append({
            "id": node_id or f"node_{len(nodes)}",
            "text": node_text.strip(),
            "metadata": {
                "section": current_section,     # 完整章节路径
                "level": level,                  # 层级深度
                "page": page_number,             # 起始页码
                "node_name": node_name           # 当前节点名称
            }
        })

    # 递归处理子节点
    children = tree.get("children", [])
    for child in children:
        nodes.extend(_extract_nodes_from_tree(child, current_section, level + 1))

    return nodes


def index_pdf(
    pdf_path: str,
    storage_dir: str,
    require_llm: bool = True
) -> Dict[str, Any]:
    """
    索引 PDF 文件（使用 PageIndex 章节级索引）

    核心逻辑：
    1. 使用 PageIndex + LLM 生成章节树状结构
    2. 提取章节节点作为向量化单位
    3. 存储到 ChromaDB（中文嵌入模型）

    Args:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录
        require_llm: 是否强制要求 LLM API（默认 True）

    Returns:
        索引结果，包含 index_id, node_count, status

    Raises:
        FileNotFoundError: PDF 文件不存在
        LLMRequiredError: LLM API 未配置但必需
        PDFIndexError: 索引失败
    """
    pdf_path_obj = Path(pdf_path)

    # 验证文件存在
    if not pdf_path_obj.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    # 验证文件大小（避免空文件）
    if pdf_path_obj.stat().st_size < 1024:
        return {
            "status": "error",
            "error": "PDF file is too small (< 1KB)"
        }

    # 检查 LLM API 配置
    llm_api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("CHATGPT_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )
    if require_llm and not llm_api_key:
        raise LLMRequiredError(
            "LLM API key is required for PageIndex tree indexing. "
            "Please set OPENAI_API_KEY environment variable."
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

        # 配置 PageIndex
        config_loader = ConfigLoader()
        user_opt = {
            "if_add_node_summary": "yes" if require_llm else "no",
            "if_add_node_text": "yes",
            "if_add_node_id": "yes",
        }
        opt = config_loader.load(user_opt)

        # 创建 LLM client
        llm_client = None
        if require_llm and llm_api_key:
            from pageindex.llm_provider import get_provider
            provider_config = {
                "type": "deepseek",  # 默认使用 DeepSeek
                "api_key": llm_api_key,
                "base_url": "https://api.deepseek.com"
            }
            provider = get_provider(provider_config)
            llm_client = UnifiedLLM(provider=provider, model=opt.model)

        # 调用 page_index_main
        tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client)

        if not tree_result or not tree_result.get("children"):
            raise PDFIndexError("PageIndex returned empty tree structure")

        print(f"✅ PageIndex 解析成功")

        # 从树状结构提取章节节点
        section_nodes = _extract_nodes_from_tree(tree_result)
        print(f"✅ 提取了 {len(section_nodes)} 个章节节点")

        if not section_nodes:
            raise PDFIndexError("No section nodes extracted from tree structure")

        # 打印章节结构预览
        print(f"\n📚 章节结构:")
        for node in section_nodes[:10]:  # 只显示前 10 个
            indent = "  " * node["metadata"]["level"]
            page_info = f"页 {node['metadata']['page']}" if node['metadata']['page'] else ""
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
