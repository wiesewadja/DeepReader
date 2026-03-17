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

# 导入存储模块
from deeppdf.storage.chroma_store import get_chroma_store

# 导入配置
from deeppdf.config import settings

# 导入文本格式化服务
from deeppdf.services.text_formatter import TextFormatter

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# 全局线程池 - 使用配置中的 worker 数量
# 注意：pageindex-lib 内部使用 asyncio，但在 ThreadPoolExecutor 中运行时
# 通过 asyncio.run() 创建独立的事件循环，因此可以安全并发
cpu_executor = ThreadPoolExecutor(max_workers=settings.cpu_workers)


def _extract_nodes_from_tree(
    tree: Dict[str, Any],
    parent_section: str = "",
    level: int = 0,
    doc_type: str = "pdf",
    formatter: Optional[TextFormatter] = None,
) -> List[Dict]:
    """
    从 PageIndex 树状结构中提取章节节点

    重要变更：同时保留原始文本和摘要
    - text: 原始 PDF 文本（用于向量化和检索）
    - summary: LLM 生成的摘要（保存在 metadata 中）

    Args:
        tree: PageIndex 树结构
        parent_section: 父级章节名称
        level: 当前层级
        doc_type: 文档类型 (pdf/epub)
        formatter: 文本格式化器实例（可选）
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
        # 格式化文本（如果提供了格式化器）
        formatted_content = content_for_embedding.strip()
        if formatter:
            formatted_content = formatter.format(formatted_content, doc_type)

        full_text_for_embedding = f"【{current_section}】\n{formatted_content}"
        node_metadata = {
            "section": current_section,
            "level": level,
            "page": start_page,
            "start_index": start_page,
            "end_index": end_page,
            "node_name": node_name,
            "node_id": node_id,
        }
        # 注意：不再在 sections.metadata 中存储 original_text 和 summary
        # 这些数据已经在 tree_structure 中保存，避免冗余
        # export_handlers.py 会从 tree_structure 中获取这些数据

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
        nodes.extend(
            _extract_nodes_from_tree(
                child, current_section, level + 1, doc_type, formatter
            )
        )

    return nodes


# ============================================================================
# 段落切分参数（用于段落向量化）
# ============================================================================
PARAGRAPH_CHUNK_MIN = 300      # 目标最小字数
PARAGRAPH_CHUNK_TARGET = 400   # 理想目标字数
PARAGRAPH_CHUNK_MAX = 500      # 硬性上限
PARAGRAPH_MIN_KEEP = 100       # 小于此值不切分


def _split_text_to_chunks(text: str) -> List[Dict[str, Any]]:
    """
    将长文本按句子边界切分成 300-400 字的 chunk

    切分策略：
    - 短文本（< 100 字）：不切分，直接返回
    - 中等文本（<= 500 字）：不切分
    - 长文本：按句子边界（。！？\\n）切分，贪心合并到目标字数

    Args:
        text: 待切分的文本

    Returns:
        切分结果列表，每个元素包含:
        - text: 切分后的文本
        - char_start: 在原文中的起始字符位置
        - char_end: 在原文中的结束字符位置
    """
    import re

    text_len = len(text)

    # 短文本不切分
    if text_len < PARAGRAPH_MIN_KEEP:
        return [{"text": text, "char_start": 0, "char_end": text_len}]

    # 中等文本不切分
    if text_len <= PARAGRAPH_CHUNK_MAX:
        return [{"text": text, "char_start": 0, "char_end": text_len}]

    # 长文本：按句子边界切分
    # 使用正则表达式按句子边界切分（保留分隔符）
    # 句子边界：。！？以及换行符
    sentence_pattern = r'([^。！？\n]+[。！？\n]?)'
    sentences = re.findall(sentence_pattern, text)

    # 过滤掉空字符串
    sentences = [s for s in sentences if s.strip()]

    if not sentences:
        # 如果正则没匹配到，返回原文
        return [{"text": text, "char_start": 0, "char_end": text_len}]

    # 贪心合并句子到目标字数
    chunks: List[Dict[str, Any]] = []
    current_chunk_start = 0
    current_pos = 0  # 当前在原文中的位置

    for sentence in sentences:
        sentence_len = len(sentence)
        current_chunk_len = current_pos - current_chunk_start

        # 检查是否需要开始新的 chunk
        if current_chunk_len >= PARAGRAPH_CHUNK_TARGET:
            # 当前 chunk 已达到目标，保存并开始新的
            chunk_text = text[current_chunk_start:current_pos]
            chunks.append({
                "text": chunk_text,
                "char_start": current_chunk_start,
                "char_end": current_pos
            })
            current_chunk_start = current_pos

        # 检查单个句子是否超过上限
        if sentence_len > PARAGRAPH_CHUNK_MAX:
            # 先保存当前 chunk（如果有内容）
            if current_pos > current_chunk_start:
                chunk_text = text[current_chunk_start:current_pos]
                chunks.append({
                    "text": chunk_text,
                    "char_start": current_chunk_start,
                    "char_end": current_pos
                })
                current_chunk_start = current_pos

            # 切分长句子
            sub_chunks = _split_long_sentence(sentence, current_pos)
            chunks.extend(sub_chunks)
            current_chunk_start = current_pos + sentence_len
            current_pos = current_chunk_start
        else:
            # 正常添加句子
            current_pos += sentence_len

    # 处理最后一个 chunk
    if current_pos > current_chunk_start:
        chunk_text = text[current_chunk_start:current_pos]
        chunks.append({
            "text": chunk_text,
            "char_start": current_chunk_start,
            "char_end": current_pos
        })

    return chunks


def _split_long_sentence(sentence: str, start_pos: int) -> List[Dict[str, Any]]:
    """
    处理单个句子超过 500 字的情况

    切分策略：
    - 优先在逗号处切分
    - 如果无逗号，硬切分（按 PARAGRAPH_CHUNK_TARGET 字数切分）

    Args:
        sentence: 待切分的长句子
        start_pos: 句子在原文中的起始位置

    Returns:
        切分结果列表
    """
    sentence_len = len(sentence)

    # 如果不超过上限，直接返回
    if sentence_len <= PARAGRAPH_CHUNK_MAX:
        return [{
            "text": sentence,
            "char_start": start_pos,
            "char_end": start_pos + sentence_len
        }]

    chunks: List[Dict[str, Any]] = []

    # 尝试在逗号处切分
    if '，' in sentence or ',' in sentence:
        # 按逗号切分（同时支持中英文逗号）
        import re
        parts = re.split(r'([，,])', sentence)

        # 重新组合：将分隔符附加到前一部分
        segments = []
        i = 0
        while i < len(parts):
            if i + 1 < len(parts) and parts[i + 1] in ('，', ','):
                segments.append(parts[i] + parts[i + 1])
                i += 2
            else:
                if parts[i].strip():
                    segments.append(parts[i])
                i += 1

        # 贪心合并 segments
        current_segment_start = 0
        current_pos = 0

        for seg in segments:
            seg_len = len(seg)

            # 如果当前 chunk + 这个 segment 会超过上限，先保存当前 chunk
            if current_pos - current_segment_start + seg_len > PARAGRAPH_CHUNK_MAX:
                if current_pos > current_segment_start:
                    chunk_text = sentence[current_segment_start:current_pos]
                    chunks.append({
                        "text": chunk_text,
                        "char_start": start_pos + current_segment_start,
                        "char_end": start_pos + current_pos
                    })
                    current_segment_start = current_pos

            current_pos += seg_len

        # 处理最后一段
        if current_pos > current_segment_start:
            chunk_text = sentence[current_segment_start:current_pos]
            chunks.append({
                "text": chunk_text,
                "char_start": start_pos + current_segment_start,
                "char_end": start_pos + current_pos
            })
    else:
        # 无逗号，硬切分
        pos = 0
        while pos < sentence_len:
            chunk_end = min(pos + PARAGRAPH_CHUNK_TARGET, sentence_len)
            chunk_text = sentence[pos:chunk_end]
            chunks.append({
                "text": chunk_text,
                "char_start": start_pos + pos,
                "char_end": start_pos + chunk_end
            })
            pos = chunk_end

    return chunks


def _extract_paragraphs_from_tree(
    tree: Dict[str, Any],
    doc_type: str,
    pdf_name: str,
    chapter_index: int,
    parent_section: str = "",
) -> List[Dict[str, Any]]:
    """
    从 PageIndex 树节点中提取物理段落并生成向量化 chunk

    处理流程：
    1. 从节点的 text 字段按换行符分割物理段落
    2. 为每个段落生成 block_id（格式：^ch{章节序号}-p{段落序号}）
    3. 调用 _split_text_to_chunks 切分长段落
    4. 递归处理子节点

    Args:
        tree: PageIndex 树节点
        doc_type: 文档类型 (pdf/epub)
        pdf_name: PDF 文件名
        chapter_index: 章节序号（从 0 开始）
        parent_section: 父级章节名称

    Returns:
        段落 chunk 列表，每个 chunk 包含:
        - id: chunk 唯一 ID
        - text: chunk 文本内容
        - metadata: 元数据字典
    """
    chunks: List[Dict[str, Any]] = []

    if not tree:
        return chunks

    node_id = tree.get("node_id", "")
    node_name = tree.get("title", "")
    node_text = tree.get("text", "")
    start_page = tree.get("start_index")

    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 按双换行符分割物理段落（支持 \n\n 和 \r\n\r\n）
    # 先统一换行符，然后按双换行分割
    normalized_text = node_text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [p.strip() for p in normalized_text.split("\n\n") if p.strip()]

    for para_idx, paragraph in enumerate(paragraphs):
        # 生成 block_id（Obsidian 引用标识）
        block_id = f"^ch{chapter_index}-p{para_idx}"

        # 调用切分函数处理长段落
        para_chunks = _split_text_to_chunks(paragraph)

        for chunk_idx, chunk_data in enumerate(para_chunks):
            if node_id:
                chunk_id = f"{node_id}_p{para_idx}-c{chunk_idx}"
            else:
                chunk_id = f"para_{chapter_index}_{para_idx}_c{chunk_idx}"

            chunk_metadata = {
                "type": "paragraph",
                "block_id": block_id,
                "chunk_index": chunk_idx,
                "total_chunks": len(para_chunks),
                "full_paragraph": paragraph,
                "parent_node_id": node_id,
                "parent_section": current_section,
                "page": start_page,
                "paragraph_index": para_idx,
                "char_start": chunk_data["char_start"],
                "char_end": chunk_data["char_end"],
                "pdf_name": pdf_name,
            }

            chunks.append({
                "id": chunk_id,
                "text": chunk_data["text"],
                "metadata": chunk_metadata,
            })

    # 递归处理子节点
    children = tree.get("nodes", [])
    for child in children:
        chunks.extend(
            _extract_paragraphs_from_tree(
                child,
                doc_type,
                pdf_name,
                chapter_index,
                current_section,
            )
        )

    return chunks


def _extract_all_paragraphs(
    tree_list: List[Dict[str, Any]],
    doc_type: str,
    pdf_name: str,
) -> List[Dict[str, Any]]:
    """
    从 PageIndex 顶层结构列表中提取所有段落

    遍历顶层结构列表，为每个顶层节点调用 _extract_paragraphs_from_tree

    Args:
        tree_list: PageIndex 顶层结构列表
        doc_type: 文档类型 (pdf/epub)
        pdf_name: PDF 文件名

    Returns:
        所有段落 chunk 的列表
    """
    all_chunks: List[Dict[str, Any]] = []

    for chapter_index, tree in enumerate(tree_list):
        chunks = _extract_paragraphs_from_tree(
            tree,
            doc_type,
            pdf_name,
            chapter_index,
        )
        all_chunks.extend(chunks)

    return all_chunks


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

    toc_check_pages = (
        kwargs.get("toc_check_pages") or settings.pdf_index_toc_check_pages
    )
    max_pages_per_node = (
        kwargs.get("max_pages_per_node") or settings.pdf_index_max_pages_per_node
    )
    max_tokens_per_node = (
        kwargs.get("max_tokens_per_node") or settings.pdf_index_max_tokens_per_node
    )

    # 这些是字符串类型的配置，转换为布尔值
    # 优先使用 kwargs，其次使用 settings 配置
    if_add_node_id_str = kwargs.get("if_add_node_id") or "yes"
    if_add_node_summary_str = kwargs.get("if_add_node_summary") or ("yes" if settings.pdf_index_if_add_node_summary else "no")
    if_add_node_text_str = kwargs.get("if_add_node_text") or ("yes" if settings.pdf_index_if_add_node_text else "no")
    if_add_doc_description_str = kwargs.get("if_add_doc_description") or ("yes" if settings.pdf_index_if_add_doc_description else "no")
    format_text_with_llm_str = kwargs.get("format_text_with_llm") or ("yes" if settings.pdf_index_format_text_with_llm else "no")

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
    format_text_with_llm = format_text_with_llm_str.lower() in ("yes", "true", "1", "on")

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
        "format_text_with_llm": format_text_with_llm,
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


def _check_llm_config(
    require_llm: bool, api_key: Optional[str]
) -> Tuple[bool, Optional[str]]:
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
        os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("CHATGPT_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )

    if not llm_api_key:
        return (
            False,
            "LLM API key is required for PageIndex tree indexing. Please set DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable.",
        )

    return True, None


def _setup_pageindex_config(
    config: Dict[str, Any], llm_api_key: Optional[str]
) -> Tuple[Any, Any]:
    """
    设置 PageIndex 配置和 LLM 客户端

    Args:
        config: LLM 配置字典
        llm_api_key: LLM API 密钥

    Returns:
        (opt, llm_client_instance)
    """

    config_loader = ConfigLoader()

    # 构建多 Provider 配置
    # 使用默认的三个 Provider: DeepSeek, SiliconFlow, Zhipu
    user_opt = {
        "model": config["model"],
        "if_add_node_summary": (
            config["if_add_node_summary"] if config["require_llm"] else "no"
        ),
        "if_add_node_text": config["if_add_node_text"],
        "if_add_node_id": config["if_add_node_id"],
        "if_add_doc_description": (
            "yes" if config.get("if_add_node_description", False) else "no"
        ),
        "format_text_with_llm": (
            "yes" if config.get("format_text_with_llm", False) else "no"
        ),
        "toc_check_page_num": config["toc_check_pages"],
        "max_page_num_each_node": config["max_pages_per_node"],
        "max_token_num_each_node": config["max_tokens_per_node"],
        # 使用多 Provider 模式（配置文件中的 llm_providers 会生效）
    }

    opt = config_loader.load(user_opt)

    # 创建 LLM client（使用配置文件中的 llm_providers）
    llm_client_instance = None
    if config["require_llm"]:
        # 使用 ConfigLoader 的 get_llm_client 方法创建客户端
        # 这会自动读取 config.yaml 中的 llm_providers 配置
        # API Key 从环境变量读取 (DEEPSEEK_API_KEY, SILICONFLOW_API_KEY, ZHIPU_API_KEY)
        try:
            llm_client_instance = config_loader.get_llm_client(user_opt)
        except Exception as e:
            logger.warning(f"LLM 客户端创建失败: {e}")
            # 如果创建失败，尝试使用传入的 API Key 作为备用
            if llm_api_key:
                logger.info("尝试使用传入的 API Key 创建单 Provider 客户端...")
                from pageindex.llm import UnifiedLLM, get_provider
                provider = get_provider({
                    "type": config.get("llm_provider", "deepseek"),
                    "api_key": llm_api_key,
                    "base_url": config.get("base_url"),
                })
                llm_client_instance = UnifiedLLM(provider=provider, model=config["model"])

    return opt, llm_client_instance


def _parse_pdf_structure(
    pdf_path: str,
    opt: Any,
    llm_client: Any,
    config: Dict[str, Any],
    progress_callback=None,
    index_id: str = None,
    storage_dir: str = None,
) -> Tuple[Dict, float]:
    """
    解析 PDF/EPUB 结构

    Args:
        pdf_path: PDF/EPUB 文件路径
        opt: PageIndex 配置
        llm_client: LLM 客户端
        config: LLM 配置字典
        progress_callback: 进度回调函数
        index_id: 索引 ID（用于 EPUB 图片提取）
        storage_dir: 存储目录（用于 EPUB 图片提取）

    Returns:
        (tree_result, parse_time)
    """
    parse_start = time.time()
    doc_type = _get_doc_type(pdf_path)

    logger.info(
        f"[{doc_type.upper()}解析] 开始时间: {datetime.now().strftime('%H:%M:%S')}"
    )
    logger.info(f"[{doc_type.upper()}解析] 输入文件: {Path(pdf_path).name}")
    logger.info(
        f"[{doc_type.upper()}解析] 配置参数: to_check={config['toc_check_pages']}, max_pages={config['max_pages_per_node']}, max_tokens={config['max_tokens_per_node']}"
    )
    logger.info(f"[{doc_type.upper()}解析] LLM 客户端: {llm_client is not None}")

    # 创建内部进度回调，将 pageindex-lib 的进度透传到外部
    # 进度范围说明：
    #   0-50%: 由 _index_pdf_sync 控制（验证、配置、初始化等）
    #   50-85%: 由 pageindex-lib 控制（解析结构、生成摘要）
    #   85-100%: 由 _index_pdf_sync 控制（向量存储、保存元数据）
    def internal_progress_callback(step: str, percent: int, message: str):
        if progress_callback:
            # 直接透传进度
            logger.debug(f"[进度透传] {step}: {percent}% - {message}")
            progress_callback(step, percent, message)

    # 注意：不在此处硬编码进度，由 pageindex-lib 内部控制 50-85% 的进度

    try:
        logger.info(f"[{doc_type.upper()}解析] 即将调用 page_index_main...")

        # 首先检查当前线程是否有遗留的事件循环
        try:
            existing_loop = asyncio.get_running_loop()
            logger.warning(
                f"[{doc_type.upper()}解析] 检测到运行中的事件循环: {existing_loop}"
            )
            logger.warning(f"[{doc_type.upper()}解析] 这可能导致问题，尝试继续...")
        except RuntimeError:
            logger.debug(
                f"[{doc_type.upper()}解析] 当前没有运行中的事件循环（符合预期）"
            )

        # 为 EPUB 文档设置图片提取参数
        if doc_type == "epub" and index_id and storage_dir:
            # 在 opt 对象上添加图片提取参数
            opt.extract_images = True
            opt.image_output_dir = str(Path(storage_dir) / "epub_images")
            opt.index_id = index_id
            logger.info(f"[EPUB解析] 启用图片提取: {opt.image_output_dir}/{index_id}")

        # 调用 page_index_main 并传递进度回调
        tree_result = page_index_main(
            str(pdf_path),
            opt=opt,
            llm_client=llm_client,
            progress_callback=internal_progress_callback
        )
        logger.info(f"[{doc_type.upper()}解析] page_index_main 返回")

    except Exception as e:
        logger.error(f"[{doc_type.upper()}解析] 失败: {type(e).__name__}: {str(e)}")
        logger.error(
            f"[{doc_type.upper()}解析] 耗时: {time.time() - parse_start:.2f} 秒"
        )
        raise

    parse_time = time.time() - parse_start
    logger.info(
        f"[{doc_type.upper()}解析] 完成时间: {datetime.now().strftime('%H:%M:%S')}"
    )
    logger.info(
        f"[{doc_type.upper()}解析] 总耗时: {parse_time:.2f} 秒 ({parse_time/60:.1f} 分钟)"
    )

    # 注意：不在此处更新进度，由外部 _index_pdf_sync 统一更新
    # 避免进度跳跃或重复更新

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
    original_filename: Optional[str] = None,
    paragraph_chunks: Optional[List[Dict]] = None,
) -> Tuple[float, int]:
    """
    存储到 ChromaDB

    Args:
        section_nodes: 章节节点列表
        index_id: 索引 ID
        pdf_path_obj: PDF/EPUB 文件路径对象
        storage_dir: 存储目录
        doc_type: 文档类型 ("pdf" 或 "epub")
        progress_callback: 进度回调函数
        paragraph_chunks: 段落 chunk 列表（可选）

    Returns:
        vector_time: 向量存储耗时（秒）
        paragraph_count: 存储的段落数量
    """
    if progress_callback:
        progress_callback("store_vectors", 80, "正在向量化并存储到 ChromaDB...")

    storage_dir_path = Path(storage_dir)
    chroma_dir = storage_dir_path / "chroma"
    chroma_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"[向量存储] ChromaDB 目录: {chroma_dir}")

    vector_start = time.time()
    store = get_chroma_store(persist_directory=str(chroma_dir))

    # 创建集合
    logger.info(f"[向量存储] 创建集合: {index_id}")
    # 优先使用原始文件名，否则使用服务器文件名
    display_name = Path(original_filename).stem if original_filename else pdf_path_obj.stem
    collection_metadata = {
        "doc_type": doc_type,
        "pdf_name": display_name,
        "pdf_path": str(pdf_path_obj.absolute()),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "node_count": len(section_nodes),
        "paragraph_count": len(paragraph_chunks) if paragraph_chunks else 0,
        "indexing_method": "pageindex_tree",
        "llm_enabled": True,
        # 新增阅读进度字段（ChromaDB 只支持基本类型，列表用逗号分隔的字符串表示）
        "read_pages": "",  # 已阅读页码，逗号分隔的字符串
        "chat_rounds": 0,  # 对话轮数
        "last_read_at": "",  # 最后阅读时间
    }
    logger.debug(f"[向量存储] 集合元数据: {collection_metadata}")

    store.create_collection(name=index_id, metadata=collection_metadata)
    logger.info("[向量存储] 集合创建成功")

    # 准备文档
    logger.info("[向量存储] 准备向量化文档...")
    # 使用原始文件名（不含扩展名）作为 pdf_name
    display_name = Path(original_filename).stem if original_filename else pdf_path_obj.stem
    documents = [
        {
            "id": node["id"],
            "text": node["text"],
            "metadata": {**node["metadata"], "pdf_name": display_name, "type": "section"},
        }
        for node in section_nodes
    ]

    # 添加章节文档（如果有）
    if documents:
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

        logger.info("[向量存储] 章节向量存储完成:")
        logger.info(f"  - 向量化耗时: {embed_time:.2f} 秒")
        logger.info(f"  - 存储章节数: {len(documents)}")
    else:
        logger.info("[向量存储] 无章节文档，跳过章节向量化")

    # 存储段落向量（如果有）
    paragraph_count = 0
    if paragraph_chunks:
        if progress_callback:
            progress_callback("store_paragraphs", 88, "正在向量化并存储段落...")

        logger.info("[向量存储] 正在存储段落向量...")
        para_start = time.time()
        store.add_documents(index_id, paragraph_chunks)
        para_time = time.time() - para_start

        paragraph_count = len(paragraph_chunks)
        logger.info("[向量存储] 段落向量存储完成:")
        logger.info(f"  - 段落向量化耗时: {para_time:.2f} 秒")
        logger.info(f"  - 存储段落数: {paragraph_count}")

    vector_time = time.time() - vector_start
    logger.info("[向量存储] 全部向量存储完成:")
    logger.info(f"  - 存储总耗时: {vector_time:.2f} 秒")
    logger.info(f"  - 章节数: {len(documents)}, 段落数: {paragraph_count}")

    return vector_time, paragraph_count


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
    original_filename: Optional[str] = None,
    temp_cover_path: Optional[str] = None,
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
        temp_cover_path: 早期提取的封面临时文件路径（可选）
    """
    if progress_callback:
        progress_callback("save_metadata", 95, "保存索引元数据...")

    storage_dir_path = Path(storage_dir)
    index_dir = storage_dir_path / "indexes"
    index_dir.mkdir(parents=True, exist_ok=True)

    metadata_path = index_dir / f"{index_id}.json"
    # 获取文档总页数
    total_pages = 0
    if doc_type == "pdf":
        try:
            import pypdf

            reader = pypdf.PdfReader(str(pdf_path_obj))
            total_pages = len(reader.pages)
        except Exception:
            pass  # 如果获取失败，保持为 0
    elif doc_type == "epub":
        # EPUB 没有页码概念，使用章节数作为"页数"
        # 这样阅读进度可以基于已读章节数计算
        total_pages = len(section_nodes)
        logger.debug(f"[元数据] EPUB 文档，使用章节数作为总页数: {total_pages}")

    # 移除文件后缀，保持与前端导出逻辑一致
    # pdf_path_obj 是服务器上的实际文件路径（可能是 file_id.pdf）
    # original_filename 是用户上传时的原始文件名
    pdf_name_clean = pdf_path_obj.stem  # 服务器文件名的 stem（可能是 file_id）

    # 优先使用原始文件名
    if original_filename:
        original_stem = Path(original_filename).stem
        doc_name = tree_result.get("doc_name", original_stem)
    else:
        # 如果没有传递原始文件名，使用服务器文件名
        doc_name = tree_result.get("doc_name", pdf_name_clean)
        original_filename = pdf_path_obj.name
        original_stem = pdf_name_clean

    # 简化书名：截取分隔符前的部分
    # 例如 "遥远的救世主:根据本书改编的电视剧《天道》正在全国掀起极大反响" → "遥远的救世主"
    if doc_name:
        doc_name = _simplify_book_name(doc_name)

    # 提取并缓存封面图片
    # 优先使用早期提取的封面（在 50% 进度时已提取）
    cover_path = None
    try:
        cover_dir = storage_dir_path / "covers"
        cover_dir.mkdir(parents=True, exist_ok=True)
        cover_file_path = cover_dir / f"{index_id}.png"

        # 检查是否有早期提取的暂存封面
        if temp_cover_path and Path(temp_cover_path).exists():
            # 使用早期提取的封面
            logger.info(f"[封面缓存] 使用早期提取的封面: {temp_cover_path}")
            import shutil
            shutil.copy(temp_cover_path, cover_file_path)
            # 删除临时文件
            Path(temp_cover_path).unlink()
            logger.info(f"[封面缓存] 封面已保存: {cover_file_path}")
        else:
            # 没有暂存封面，现在提取（兜底逻辑）
            logger.info("[封面缓存] 未找到暂存封面，重新提取...")
            from deeppdf.services.cover_extractor import extract_or_generate_cover
            cover_data, _ = extract_or_generate_cover(str(pdf_path_obj), doc_name)
            with open(cover_file_path, "wb") as f:
                f.write(cover_data)
            logger.info(f"[封面缓存] 封面已保存: {cover_file_path}")

        cover_path = str(cover_file_path)
    except Exception as e:
        logger.warning(f"[封面缓存] 封面处理失败: {e}")

    metadata_content = {
        "id": index_id,
        "doc_type": doc_type,
        "pdf_name": doc_name or original_stem,  # 使用 doc_name，EPUB 为书名，否则用原始文件名
        "file_name": original_filename,  # 始终保留原始文件名
        "pdf_path": str(pdf_path_obj.absolute()),
        "cover_path": cover_path,  # 缓存的封面路径
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

    # 添加 EPUB 特有的元数据（作者、语言等）
    if tree_result.get("author"):
        metadata_content["author"] = tree_result["author"]
    if tree_result.get("language"):
        metadata_content["language"] = tree_result["language"]

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


def _simplify_book_name(name: str) -> str:
    """
    简化书名：截取分隔符前的部分

    例如:
    - "遥远的救世主:根据本书改编的电视剧《天道》正在全国掀起极大反响" → "遥远的救世主"
    - "三体:地球往事" → "三体"

    Args:
        name: 原始书名

    Returns:
        简化后的书名
    """
    if not name:
        return name

    # 常见分隔符（中文和英文）
    separators = ['：', ':', '—', '-', '｜', '|']

    for sep in separators:
        if sep in name:
            name = name.split(sep)[0].strip()
            break

    return name


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

    # 获取原始文件名（用于显示和元数据）
    original_filename = kwargs.get("original_filename") or pdf_path_obj.name
    # 提取不带扩展名的文件名用于显示
    original_stem = Path(original_filename).stem

    logger.info("=" * 60)
    logger.info(f"[索引开始] {doc_type.upper()} 文件: {original_filename}")
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
                text_threshold=kwargs.get(
                    "visual_text_threshold", settings.visual_text_threshold
                ),
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

            logger.info(
                f"[PDF分类] 检测结果: {'视觉密集型' if is_visual_heavy else '普通文本型'}"
            )
            logger.info(
                f"[PDF分类] 文本密度: {detector_result.text_density:.0f} 字符/页"
            )
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
        os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("CHATGPT_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    if llm_api_key:
        logger.info(
            f"LLM API Key: {'*' * min(len(llm_api_key), 12)} ({len(llm_api_key)} 字符)"
        )

    # 生成索引 ID
    file_hash = hashlib.md5(f"{pdf_path_obj.name}{time.time()}".encode()).hexdigest()[
        :12
    ]
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
            # 检测是否使用 MultiProvider
            from pageindex.llm.providers import MultiProvider
            provider = getattr(llm_client_instance, 'provider', None)
            if isinstance(provider, MultiProvider):
                logger.info(
                    f"LLM 客户端创建成功: MultiProvider ({len(provider.providers)} 个 Provider)"
                )
            else:
                logger.info(
                    f"LLM 客户端创建成功: {type(provider).__name__}/{config['model']}"
                )

        # 步骤 5: 解析文档结构（检查是否有可复用的 results 文件）
        logger.info(
            f"[步骤 5/6] 开始解析 {doc_type.upper()} 结构 (这可能需要几分钟)..."
        )
        _update_progress("parse_pdf", 50, f"正在解析 {doc_type.upper()} 结构...")

        # 步骤 5.5: 提前提取封面（在解析文档结构的同时进行）
        # 这样前端可以在索引过程中立即显示封面
        storage_dir_path = Path(storage_dir)
        temp_cover_path = None  # 初始化变量，后续在 try 块中赋值
        try:
            from deeppdf.services.cover_extractor import extract_or_generate_cover

            logger.info("[封面提取] 开始提取封面...")
            # 提取或生成封面（使用原始文件名作为书名）
            doc_name_for_cover = original_stem  # 用于封面生成的名称
            cover_data, _ = extract_or_generate_cover(str(pdf_path_obj), doc_name_for_cover)

            # 暂存封面数据，后续在 _save_metadata 中保存
            # 使用临时文件存储，避免在内存中传递大量二进制数据
            temp_cover_path = storage_dir_path / "temp_cover.bin"
            with open(temp_cover_path, "wb") as f:
                f.write(cover_data)

            logger.info(f"[封面提取] 封面已提取并暂存: {temp_cover_path}")

        except Exception as e:
            logger.warning(f"[封面提取] 封面提取失败: {e}")

        # 检查是否有可复用的 results 文件
        tree_result = None
        # results 目录在 backend/results/（从 deeppdf-api/src/deeppdf/services/ 出发向上 5 级）
        results_dir = Path(__file__).parent.parent.parent.parent.parent / "results"
        # 使用原始文件名（不含扩展名）来匹配 results 文件
        file_stem = original_stem

        if results_dir.exists():
            # 查找匹配的 results 文件（按文件名前缀匹配）
            matching_files = sorted(
                results_dir.glob(f"{file_stem}_*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,  # 按修改时间降序，优先使用最新的
            )

            if matching_files:
                latest_result = matching_files[0]
                logger.info(f"[结果复用] 发现已有的 pageindex 结果: {latest_result.name}")
                try:
                    with open(latest_result, "r", encoding="utf-8") as f:
                        tree_result = json.load(f)
                    logger.info("[结果复用] 成功加载，跳过 LLM 解析步骤")
                    parse_time = 0  # 复用结果，解析时间为 0
                except Exception as e:
                    logger.warning(f"[结果复用] 加载失败: {e}，将重新解析")
                    tree_result = None

        if tree_result is None:
            # 没有可复用的结果，执行正常的解析流程
            if doc_type == "pdf":
                logger.info(f"  - 检测目录 (前 {config['toc_check_pages']} 页)")
                logger.info(f"  - 分割章节 (每节点最多 {config['max_pages_per_node']} 页)")
            if config["if_add_node_summary"]:
                # 检测是否使用 MultiProvider
                from pageindex.llm.providers import MultiProvider
                provider = getattr(llm_client_instance, 'provider', None) if llm_client_instance else None
                if isinstance(provider, MultiProvider):
                    logger.info(
                        f"  - 生成摘要 (使用 MultiProvider: {len(provider.providers)} 个并行)"
                    )
                else:
                    logger.info(
                        f"  - 生成摘要 (使用 {config.get('llm_provider', 'default')}/{config['model']})"
                    )

            tree_result, parse_time = _parse_pdf_structure(
                pdf_path, opt, llm_client_instance, config, progress_callback,
                index_id=index_id,
                storage_dir=storage_dir,
            )

        # 更新进度：文档解析完成（pageindex-lib 内部已更新到 85%）
        # 这里统一更新到 85%，表示解析阶段完全结束
        _update_progress(
            "parse_complete", 85, f"{doc_type.upper()} 结构解析完成，正在提取章节..."
        )

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

        # 创建文本格式化器（仅使用基于规则的处理，LLM 格式化在导出时可选）
        enable_text_formatting = kwargs.get("enable_text_formatting", True)
        formatter = TextFormatter() if enable_text_formatting else None
        if formatter:
            logger.info("[章节提取] 文本格式化已启用（基于规则）")

        section_nodes = []
        for idx, top_level_node in enumerate(structure_list):
            node_title = top_level_node.get("title", f"Unknown_{idx}")
            logger.debug(f"[章节提取] 处理顶层节点 {idx + 1}: {node_title}")
            logger.debug(f"  - 起始页: {top_level_node.get('start_index', 'Unknown')}")
            logger.debug(f"  - 结束页: {top_level_node.get('end_index', 'Unknown')}")
            logger.debug(f"  - 节点ID: {top_level_node.get('node_id', 'Unknown')}")

            nodes = _extract_nodes_from_tree(
                top_level_node, doc_type=doc_type, formatter=formatter
            )
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

        # 提取段落 chunks
        logger.info("[段落提取] 正在提取段落 chunks...")
        paragraph_chunks = _extract_all_paragraphs(structure_list, doc_type, original_stem)
        logger.info(f"[段落提取] 共提取 {len(paragraph_chunks)} 个段落 chunks")

        # 步骤 6: 存储到 ChromaDB
        vector_time, paragraph_count = _store_to_chromadb(
            section_nodes,
            index_id,
            pdf_path_obj,
            storage_dir,
            doc_type,
            progress_callback,
            original_filename,
            paragraph_chunks,
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
            original_filename,
            temp_cover_path=str(temp_cover_path) if temp_cover_path else None,
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
        logger.info(f"    - 文件名称: {original_filename}")
        logger.info(f"    - 节点数量: {len(section_nodes)}")
        logger.info(f"    - 段落数量: {paragraph_count}")
        logger.info("  时间统计:")
        logger.info(
            f"    - 文档解析: {parse_time:.2f} 秒 ({parse_time/total_time*100:.1f}%)"
        )
        logger.info(
            f"    - 向量存储: {vector_time:.2f} 秒 ({vector_time/total_time*100:.1f}%)"
        )
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
            "paragraph_count": paragraph_count,
            "pdf_name": original_stem,  # 使用原始文件名（不含扩展名）
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
