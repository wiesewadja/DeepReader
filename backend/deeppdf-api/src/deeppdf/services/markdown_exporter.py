"""
Markdown 导出服务
将索引的 PDF 导出为分割的 Markdown 文件
"""

import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger(__name__)

# Markdown 文件切分配置
MARKDOWN_CHUNK_TARGET = 4000  # 目标字符数
MARKDOWN_CHUNK_MAX = 6000     # 最大字符数（允许溢出以保持段落完整）


def _sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    清理文件名,移除或替换特殊字符
    """
    name = name.replace("/", "-").replace(":", "-").replace("?", "").replace("*", "")
    name = (
        name.replace('"', "")
        .replace("<", "")
        .replace(">", "")
        .replace("|", "")
        .replace("\\", "-")
    )
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"-+", "-", name)
    name = name.strip(" -")
    return name[:max_length].strip(" -") if len(name) > max_length else name


def _fetch_paragraphs_from_chroma(index_id: str, chroma_path: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    从 ChromaDB 获取段落信息，按 parent_node_id 分组

    Returns:
        Dict[node_id, List[paragraph_info]] - 每个节点下的段落列表
    """
    try:
        from ..storage.chroma_store import get_chroma_store

        # 使用缓存的 ChromaStore 实例，避免重复创建客户端
        store = get_chroma_store(persist_directory=chroma_path)
        collection = store.client.get_collection(name=index_id)

        # 获取所有段落数据
        results = collection.get(
            where={"type": "paragraph"},
            include=["metadatas", "documents"]
        )

        # 按 parent_node_id 分组
        paragraphs_by_node: Dict[str, List[Dict[str, Any]]] = {}

        if results and results["metadatas"]:
            for i, (doc, meta) in enumerate(zip(results["documents"], results["metadatas"])):
                parent_node_id = meta.get("parent_node_id", "")
                block_id = meta.get("block_id", "")
                paragraph_index = meta.get("paragraph_index", 0)
                full_paragraph = meta.get("full_paragraph", doc)

                if not parent_node_id:
                    continue

                if parent_node_id not in paragraphs_by_node:
                    paragraphs_by_node[parent_node_id] = []

                # 避免重复添加同一个 block_id
                existing = [p for p in paragraphs_by_node[parent_node_id] if p["block_id"] == block_id]
                if not existing:
                    paragraphs_by_node[parent_node_id].append({
                        "block_id": block_id,
                        "paragraph_index": paragraph_index,
                        "text": full_paragraph,
                    })

        # 对每个节点内的段落按 paragraph_index 排序
        for node_id in paragraphs_by_node:
            paragraphs_by_node[node_id].sort(key=lambda x: x["paragraph_index"])

        logger.info(f"[导出] 从 ChromaDB 获取到 {sum(len(v) for v in paragraphs_by_node.values())} 个段落，分布在 {len(paragraphs_by_node)} 个节点")
        return paragraphs_by_node

    except Exception as e:
        logger.warning(f"[导出] 无法从 ChromaDB 获取段落: {e}")
        return {}


def _is_likely_heading(text: str) -> bool:
    """
    判断文本是否可能是标题

    规则：短句（<=50字符）且末尾没有标点符号
    """
    if not text:
        return False

    # 去除首尾空白
    text = text.strip()

    # 如果已经有 # 前缀，说明是标题，需要处理
    # 但不在这里判断，在 _build_text_from_paragraphs 中处理

    # 太长的不是标题
    if len(text) > 50:
        return False

    # 检查末尾是否有标点符号
    # 常见的中文和英文标点
    punctuation_chars = '。！？，、；：""''）】》…—·.,!?;:)\'">]}'

    # 如果末尾是标点，不是标题
    if text[-1] in punctuation_chars:
        return False

    return True


def _strip_heading_prefix(text: str) -> str:
    """
    移除文本中的 Markdown 标题前缀（# 符号）
    """
    text = text.strip()
    # 移除开头的 # 符号和空格
    while text.startswith('#'):
        text = text[1:]
    return text.strip()


def _build_text_from_paragraphs(paragraphs: List[Dict[str, Any]]) -> str:
    """
    从 ChromaDB 段落重建带 block_id 的文本

    Args:
        paragraphs: 段落信息列表（已排序）

    Returns:
        带 block_id 标记的文本
    """
    if not paragraphs:
        return ""

    result_paragraphs = []
    for para_info in paragraphs:
        text = para_info.get("text", "")
        block_id = para_info.get("block_id", "")
        if text:
            # 判断是否可能是标题
            if _is_likely_heading(text):
                # 移除可能存在的 # 前缀，然后用 H3 格式处理
                clean_text = _strip_heading_prefix(text)
                if block_id:
                    result_paragraphs.append(f"### {clean_text} {block_id}")
                else:
                    result_paragraphs.append(f"### {clean_text}")
            else:
                # 普通段落
                if block_id:
                    result_paragraphs.append(f"{text} {block_id}")
                else:
                    result_paragraphs.append(text)

    return "\n\n".join(result_paragraphs)


def _split_paragraphs_by_size(
    paragraphs: List[Dict[str, Any]],
    target_chars: int = MARKDOWN_CHUNK_TARGET,
    max_chars: int = MARKDOWN_CHUNK_MAX,
) -> List[List[Dict[str, Any]]]:
    """
    将段落按字符数切分成组，保持段落完整性

    切分策略：
    - 目标每组 ~4000 字符
    - 保持段落完整（不跨组切分）
    - 允许溢出到 max_chars 以保持段落完整
    - 单个段落超过 max_chars 时单独成组

    Args:
        paragraphs: 段落列表
        target_chars: 目标字符数
        max_chars: 最大字符数

    Returns:
        段落组列表，每组是一个段落列表
    """
    if not paragraphs:
        return []

    # 计算每个段落的长度（包括 block_id 和换行）
    def get_para_length(para: Dict[str, Any]) -> int:
        text = para.get("text", "")
        block_id = para.get("block_id", "")
        # 估算长度：文本 + block_id + 2个换行
        return len(text) + len(block_id) + 4

    groups: List[List[Dict[str, Any]]] = []
    current_group: List[Dict[str, Any]] = []
    current_length = 0

    for para in paragraphs:
        para_len = get_para_length(para)

        # 检查是否需要开始新组
        if current_group:
            # 如果加入这个段落会超过 max_chars，且当前组已有内容，开始新组
            if current_length + para_len > max_chars:
                groups.append(current_group)
                current_group = []
                current_length = 0
            # 如果当前组已达到目标，且这个段落会使其超过目标，考虑开始新组
            elif current_length >= target_chars and para_len > 0:
                groups.append(current_group)
                current_group = []
                current_length = 0

        # 添加段落到当前组
        current_group.append(para)
        current_length += para_len

    # 处理最后一组
    if current_group:
        groups.append(current_group)

    return groups


def _create_markdown_content_partial(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str,
    paragraphs: List[Dict[str, Any]],
    part_num: int,
    total_parts: int,
    base_filename: str = "",  # 新增：用于生成导航链接
) -> str:
    """
    创建 Markdown 文件内容（分片版本）

    Args:
        node: 节点数据
        pdf_name: PDF 名称
        section: 章节名称
        page_range: 页码范围
        paragraphs: 该分片的段落信息
        part_num: 分片序号（从 1 开始）
        total_parts: 总分片数
        base_filename: 基础文件名（不含 .md 后缀），用于生成导航链接
    """
    node_id = node.get("id", "")
    metadata = node.get("metadata", {})
    start_page = metadata.get("start_index", "?")

    # 获取摘要（只在第一部分显示）
    summary = metadata.get("summary", "") if part_num == 1 else ""

    # 从段落重建文本
    processed_text = _build_text_from_paragraphs(paragraphs)

    # 解析物理页码标记
    seen_pages = set()

    def replace_page_tag(match):
        page_num = match.group(1)
        if page_num not in seen_pages:
            seen_pages.add(page_num)
            return f"\n\n### 第 {page_num} 页 ^page-{page_num}\n\n"
        return ""

    processed_text = re.sub(
        r"<(?:physical|start|end)_index_(\d+)>", replace_page_tag, processed_text
    )
    processed_text = re.sub(r"\n{3,}", "\n\n", processed_text).strip()

    # 构建 part_id
    part_id = f"{node_id}_part{part_num}" if total_parts > 1 else node_id

    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
part_id: {part_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
part: {part_num}/{total_parts}
tags: [DeepPDF, {pdf_name}]
---

"""

    # 标题
    title = f"# {section}\n\n"

    # 分片指示（仅分片文件显示）
    part_indicator = ""
    if total_parts > 1:
        part_indicator = f"> 📖 第 {part_num}/{total_parts} 部分\n\n"

    # 摘要（仅第一部分）
    summary_block = ""
    if summary and summary.strip():
        summary_block = f"> [!summary] 章节摘要\n> {summary.strip().replace(chr(10), chr(10) + '> ')}\n\n"

    # 组装头部：标题 + 分片指示 + 摘要
    header = title + part_indicator + summary_block

    # 页脚
    footer_link = (
        f"[[{pdf_name}#page={start_page}]]"
        if str(start_page).isdigit()
        else f"[[{pdf_name}]]"
    )
    footer = f"\n\n---\n**来源**: {footer_link} (第 {page_range} 页)\n"

    return front_matter + header + processed_text + footer


def _create_markdown_content(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str,
    paragraphs: List[Dict[str, Any]] = None,
) -> str:
    """
    创建 Markdown 文件内容

    Args:
        node: 节点数据
        pdf_name: PDF 名称
        section: 章节名称
        page_range: 页码范围
        paragraphs: 该节点的段落信息（从 ChromaDB 获取，用于重建带 block_id 的文本）
    """
    node_id = node.get("id", "")
    metadata = node.get("metadata", {})
    start_page = metadata.get("start_index", "?")

    # 获取摘要（如果有）
    summary = metadata.get("summary", "")

    # --- 核心改进：使用 ChromaDB 中的段落重建文本（带 block_id）---
    if paragraphs:
        # 从 ChromaDB 段落重建文本（每个段落已有 block_id）
        processed_text = _build_text_from_paragraphs(paragraphs)
        logger.debug(f"[导出] 节点 {node_id}: 从 ChromaDB 重建 {len(paragraphs)} 个段落")
    else:
        # 如果没有 ChromaDB 数据，使用 sections 中的摘要作为 fallback
        text = node.get("text", "")
        original_text = metadata.get("original_text", text)
        processed_text = original_text
        logger.debug(f"[导出] 节点 {node_id}: 无 ChromaDB 数据，使用原始文本")

    # --- 解析物理页码标记 (防止重复) ---
    seen_pages = set()

    def replace_page_tag(match):
        page_num = match.group(1)
        if page_num not in seen_pages:
            seen_pages.add(page_num)
            return f"\n\n### 第 {page_num} 页 ^page-{page_num}\n\n"
        else:
            return ""  # 重复出现的标签直接抹除

    # 统一处理所有可能的标签格式
    processed_text = re.sub(
        r"<(?:physical|start|end)_index_(\d+)>", replace_page_tag, processed_text
    )

    # 清理多余空行
    processed_text = re.sub(r"\n{3,}", "\n\n", processed_text).strip()

    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
tags: [DeepPDF, {pdf_name}]
---

"""
    title = f"# {section}\n\n"

    # 添加摘要引用块（如果有）
    summary_block = ""
    if summary and summary.strip():
        # 将摘要格式化为 Obsidian callout 块
        summary_block = f"> [!summary] 章节摘要\n> {summary.strip().replace(chr(10), chr(10) + '> ')}\n\n"

    footer_link = (
        f"[[{pdf_name}#page={start_page}]]"
        if str(start_page).isdigit()
        else f"[[{pdf_name}]]"
    )
    footer = f"\n\n---\n**来源**: {footer_link} (第 {page_range} 页)\n"

    return front_matter + title + summary_block + processed_text + footer


def export_pdf_to_markdown(
    index_id: str, storage_dir: str, vault_path: str, output_folder: str = "DeepPDF"
) -> Dict[str, Any]:
    """
    导出 PDF 为 Markdown 文件

    当章节内容超过目标字符数时，自动切分成多个文件，
    保持段落完整性，并维护 block_id 与文件的映射关系。

    Returns:
        {
            "status": "success" | "error",
            "files_created": int,
            "file_mapping": {
                "node_id": "path/to/file.md",  # 单文件时的映射
                ...
            },
            "block_mapping": {
                "node_id": {
                    "block_id": "path/to/file.md",  # block_id 到文件的映射
                    ...
                },
                ...
            },
            "markdown_files": {
                "node_id": "path/to/file.md",  # 兼容旧格式
                ...
            }
        }
    """
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            return {"status": "error", "error": f"Index metadata not found: {index_id}"}

        with open(metadata_path, "r", encoding="utf-8") as f:
            index_metadata = json.load(f)

        pdf_name = index_metadata.get("pdf_name", "Unknown")
        sections = index_metadata.get("sections", [])

        # --- 从 ChromaDB 获取段落信息 ---
        chroma_path = str(storage_dir_path / "chroma")
        paragraphs_by_node = _fetch_paragraphs_from_chroma(index_id, chroma_path)

        vault_path_obj = Path(vault_path)
        pdf_folder_name = pdf_name.replace(".pdf", "").replace("/", "-")
        output_dir = vault_path_obj / output_folder / pdf_folder_name
        output_dir.mkdir(parents=True, exist_ok=True)

        file_mapping = {}  # node_id -> 主文件路径（向后兼容）
        block_mapping = {}  # node_id -> {block_id -> 文件路径}
        markdown_files = {}  # 兼容旧格式
        files_created = 0

        for idx, node in enumerate(sections, start=1):
            metadata = node.get("metadata", {})
            section = metadata.get("section", f"Section {idx}")
            node_id = node.get("id", f"node_{idx}")
            node_name = metadata.get("node_name", f"Section {idx}")

            start_page = metadata.get("start_index", "?")
            end_page = metadata.get("end_index", "?")
            page_range = (
                f"{start_page}-{end_page}"
                if start_page != end_page
                else str(start_page)
            )

            # 获取该节点的段落信息
            node_paragraphs = paragraphs_by_node.get(node_id, [])

            # 按字符数切分段落
            paragraph_groups = _split_paragraphs_by_size(node_paragraphs)
            total_parts = len(paragraph_groups)

            # 清理章节名称用于文件名
            safe_node_name = _sanitize_filename(node_name, max_length=50)

            # 为每个段落组创建文件
            node_block_mapping = {}

            for part_idx, para_group in enumerate(paragraph_groups, start=1):
                # 构建文件名：第一部分不带序号，后续部分从 2 开始
                if total_parts == 1:
                    filename = f"{idx:02d}-{safe_node_name}.md"
                elif part_idx == 1:
                    filename = f"{idx:02d}-{safe_node_name}.md"
                else:
                    filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

                file_path = output_dir / filename
                relative_path = f"{output_folder}/{pdf_folder_name}/{filename}"

                # 创建 Markdown 内容
                markdown_content = _create_markdown_content_partial(
                    node, pdf_name, section, page_range, para_group, part_idx, total_parts
                )

                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(markdown_content)

                files_created += 1

                # 记录这个文件中包含的所有 block_id
                for para in para_group:
                    block_id = para.get("block_id", "")
                    if block_id:
                        node_block_mapping[block_id] = relative_path

                # 第一部分作为主文件（向后兼容）
                if part_idx == 1:
                    file_mapping[node_id] = relative_path
                    markdown_files[node_id] = relative_path

            # 记录该节点的 block 映射
            if node_block_mapping:
                block_mapping[node_id] = node_block_mapping

        logger.info(
            f"[导出] 完成: {files_created} 个文件, "
            f"{len(block_mapping)} 个节点有 block 映射"
        )

        return {
            "status": "success",
            "files_created": files_created,
            "file_mapping": file_mapping,
            "block_mapping": block_mapping,
            "markdown_files": markdown_files,  # 兼容旧格式
        }
    except Exception as e:
        logger.error(f"[导出] 失败: {e}")
        return {"status": "error", "error": str(e)}


def get_markdown_path_for_node(
    index_metadata: Dict[str, Any], node_id: str
) -> Optional[str]:
    return index_metadata.get("markdown_files", {}).get(node_id)


# 公共别名：外部导入使用
create_markdown_content = _create_markdown_content
fetch_paragraphs_from_chroma = _fetch_paragraphs_from_chroma
build_text_from_paragraphs = _build_text_from_paragraphs
