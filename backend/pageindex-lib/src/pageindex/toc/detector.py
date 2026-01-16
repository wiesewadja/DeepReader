"""
PageIndex 目录检测模块

本模块提供目录页检测功能，使用规则 + LLM 混合策略。

主要功能:
    - 规则基础的置信度计算 (_calculate_toc_confidence)
    - 单页目录检测 (toc_detector_single_page)
    - 查找所有目录页 (find_toc_pages)
    - 检查目录状态 (check_toc)

检测策略:
    - 高置信度 (>0.7): 直接使用规则结果，无需 LLM
    - 中等置信度 (0.3-0.7): 使用 LLM 确认
    - 低置信度 (<0.3): 跳过，认为不是目录页

置信度计算规则:
    1. 目录关键词匹配 (权重 0.4): "目录", "contents", "章节", "chapter" 等
    2. 章节列表结构 (权重 0.3): 多行标题，以数字或字母开头
    3. 页码模式 (权重 0.2): "第1章", "1." 等模式
    4. 点号引导模式 (权重 0.1): "1. xxx", "Chapter 1. xxx" 等

使用示例:
    >>> from pageindex.toc.detector import find_toc_pages, _calculate_toc_confidence
    >>>
    >>> # 计算单页置信度
    >>> confidence = _calculate_toc_confidence(page_text)
    >>> print(f"置信度: {confidence:.2f}")
    >>>
    >>> # 查找所有目录页
    >>> toc_pages = await find_toc_pages(page_list, opt, llm_client)
    >>> print(f"找到 {len(toc_pages)} 个目录页")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
import re
from typing import List, Optional, Tuple

from ..core.exceptions import TOCError

logger = logging.getLogger(__name__)


# ============================================================
# 置信度计算
# ============================================================

def _calculate_toc_confidence(content: str) -> float:
    """
    使用规则计算页面是目录页的置信度 (0-1)

    这是一个快速的规则基础检测，用于减少 LLM 调用次数。

    置信度计算规则:
        1. 目录关键词匹配 (权重 0.4)
           检测: "目录", "contents", "chapter", "章节" 等

        2. 章节列表结构 (权重 0.3)
           检测: 至少 5 行，30% 的行有章节特征 (以数字开头)

        3. 页码模式 (权重 0.2)
           检测: 至少 3 个 "第1章", "1." 等页码模式

        4. 点号引导模式 (权重 0.1)
           检测: 至少 3 个 "1. xxx", "Chapter 1. xxx" 等模式

    参数:
        content: 页面文本内容

    返回:
        置信度值 (0.0 - 1.0)

    使用示例:
        >>> confidence = _calculate_toc_confidence("目录\\n1. 第一章\\n2. 第二章")
        >>> print(f"置信度: {confidence:.2f}")  # 约 0.8
    """
    if not content or not content.strip():
        return 0.0

    content_lower = content.lower()
    confidence = 0.0

    # ============================================================
    # 规则1: 目录关键词检测 (权重 0.4)
    # ============================================================
    toc_keywords = [
        "目录", "contents", "content", "table of contents",
        "章节", "chapter", "chapters", "索引", "目　录"
    ]
    keyword_found = any(keyword in content_lower for keyword in toc_keywords)
    if keyword_found:
        confidence += 0.4

    # ============================================================
    # 规则2: 章节列表结构检测 (权重 0.3)
    # ============================================================
    lines = [line.strip() for line in content.split('\n') if line.strip()]
    if len(lines) >= 5:  # 至少 5 行
        # 检查是否有类似章节标题的行（以数字、字母开头）
        chapter_patterns = sum(
            1 for line in lines
            if line and (line[0].isdigit() or line.split()[0][0].isdigit() if line.split() else False)
        )
        if chapter_patterns >= len(lines) * 0.3:  # 30% 的行有章节特征
            confidence += 0.3

    # ============================================================
    # 规则3: 页码模式检测 (权重 0.2)
    # ============================================================
    # 检查是否有多个页码（如 "1", "2", "3" 或 "第1章", "第2章"）
    page_numbers = re.findall(r'第?\s*\d+\s*章|^\d+\s+', content, re.MULTILINE)
    if len(page_numbers) >= 3:
        confidence += 0.2

    # ============================================================
    # 规则4: 点号引导模式 (权重 0.1)
    # ============================================================
    # 检查是否有典型的目录格式，如 "1. xxx", "Chapter 1. xxx"
    dot_pattern = re.findall(r'^\s*[\d一二三四五六七八九十]+[.、．]\s*\w+', content, re.MULTILINE)
    if len(dot_pattern) >= 3:
        confidence += 0.1

    return min(confidence, 1.0)


# ============================================================
# 单页目录检测
# ============================================================

async def toc_detector_single_page(content: str, llm_client=None) -> str:
    """
    使用 LLM 检测单页是否包含目录

    当规则检测置信度在中等范围 (0.3-0.7) 时，使用此函数进行 LLM 确认。

    参数:
        content: 页面文本内容
        llm_client: LLM 客户端 (必需)

    返回:
        "yes" 或 "no"

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> result = await toc_detector_single_page(page_text, llm_client)
        >>> if result == "yes":
        ...     print("这页是目录页")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for toc_detector_single_page")

    prompt = f"""
    Your job is to detect if there is a table of content provided in the given text.

    Given text: {content}

    return the following JSON format:
    {{
        "thinking": <why do you think there is a table of content in the given text>
        "toc_detected": "<yes or no>",
    }}

    Directly return the final JSON structure. Do not output anything else.
    Please note: abstract,summary, notation list, figure list, table list, etc. are not table of contents."""

    # 添加上下文信息
    from ..json_ops import extract_json
    response = await llm_client.chat_async(prompt, context="目录检测-单页")
    json_content = extract_json(response)
    return json_content.get("toc_detected", "no")


# ============================================================
# 查找目录页
# ============================================================

async def find_toc_pages(
    start_page_index: int = 0,
    page_list: Optional[List] = None,
    opt: Optional[object] = None,
    llm_client=None,
    logger=None,
) -> List[int]:
    """
    查找 PDF 中所有目录页

    优化版目录检测：先使用规则快速过滤，只在必要时使用 LLM。

    性能优化策略:
        - 高置信度 (>0.7): 直接使用规则结果，无需 LLM
        - 中等置信度 (0.3-0.7): 使用 LLM 确认
        - 低置信度 (<0.3): 跳过

    参数:
        start_page_index: 开始检测的页码索引 (从 0 开始)
        page_list: 页面列表 (必需)
        opt: 配置选项，包含 toc_check_page_num
        llm_client: LLM 客户端 (必需)
        logger: 日志记录器 (可选)

    返回:
        目录页的索引列表

    异常:
        ValueError: 如果 page_list 为 None

    使用示例:
        >>> toc_pages = await find_toc_pages(
        ...     start_page_index=0,
        ...     page_list=pages,
        ...     opt=config,
        ...     llm_client=llm_client
        ... )
        >>> print(f"找到目录页: {toc_pages}")  # 例如: [0, 1]
    """
    if page_list is None:
        raise ValueError("page_list cannot be None")

    logger.info("开始目录检测 (规则 + LLM 混合模式)")
    toc_page_list = []
    i = start_page_index
    rule_based_count = 0
    llm_confirm_count = 0

    while i < len(page_list):
        # 只在找到目录页时检查超过 toc_check_page_num
        if i >= opt.toc_check_page_num and not toc_page_list:
            break

        content = page_list[i][0]

        # ============================================================
        # 步骤1: 使用规则计算置信度
        # ============================================================
        confidence = _calculate_toc_confidence(content)

        # ============================================================
        # 步骤2: 根据置信度决定是否使用 LLM
        # ============================================================
        is_toc_page = False

        if confidence >= 0.7:  # 高置信度：直接使用规则结果
            is_toc_page = True
            rule_based_count += 1
            if logger:
                logger.info(f"页码 {i}: 检测到目录 (规则判断, 置信度={confidence:.2f})")
        elif confidence >= 0.3:  # 中等置信度：使用 LLM 确认
            detected_result = await toc_detector_single_page(
                content=content,
                llm_client=llm_client,
            )
            is_toc_page = (detected_result == "yes")
            llm_confirm_count += 1
            if logger:
                logger.info(
                    f"页码 {i}: {'检测到目录' if is_toc_page else '非目录页'} "
                    f"(LLM 确认, 置信度={confidence:.2f})"
                )
        else:  # 低置信度：不是目录页
            if logger:
                logger.debug(f"页码 {i}: 非目录页 (置信度={confidence:.2f})")
            # 如果已经找到过目录页，说明目录结束了
            if toc_page_list:
                if logger:
                    logger.info(f"找到最后一页目录: {i - 1}")
                break
            i += 1
            continue

        # ============================================================
        # 步骤3: 记录结果
        # ============================================================
        if is_toc_page:
            toc_page_list.append(i)
        elif toc_page_list:  # 之前找到过目录，现在不是了，说明目录结束
            if logger:
                logger.info(f"找到最后一页目录: {i - 1}")
            break

        i += 1

    if not toc_page_list and logger:
        logger.info("未找到目录页")

    if logger:
        logger.info(
            f"目录检测汇总: {rule_based_count} 规则判断, "
            f"{llm_confirm_count} LLM 确认, "
            f"共 {len(toc_page_list)} 个目录页"
        )

    return toc_page_list


# ============================================================
# 检查目录状态
# ============================================================

async def check_toc(
    page_list: List,
    opt: Optional[object] = None,
    llm_client=None,
) -> dict:
    """
    检查 PDF 的目录状态

    这是一个高层函数，整合了目录检测、提取和页码检测功能。

    参数:
        page_list: 页面列表
        opt: 配置选项
        llm_client: LLM 客户端 (必需)

    返回:
        包含以下键的字典:
            - toc_content: 目录内容 (如果找到)
            - toc_page_list: 目录页索引列表
            - page_index_given_in_toc: "yes" 或 "no"

    使用示例:
        >>> result = await check_toc(page_list, opt, llm_client)
        >>> if result["toc_content"]:
        ...     print("找到目录")
        ...     if result["page_index_given_in_toc"] == "yes":
        ...         print("目录包含页码")
        ...     else:
        ...         print("目录不包含页码")
        ... else:
        ...     print("未找到目录")
    """
    from .parser import toc_extractor, detect_page_index

    # 查找目录页
    toc_page_list = await find_toc_pages(
        start_page_index=0,
        page_list=page_list,
        opt=opt,
        llm_client=llm_client
    )

    if len(toc_page_list) == 0:
        logger.info("未找到目录页")
        return {
            "toc_content": None,
            "toc_page_list": [],
            "page_index_given_in_toc": "no",
        }
    else:
        logger.info(f"找到 {len(toc_page_list)} 个目录页")

    # 提取目录内容
    toc_json = await toc_extractor(page_list, toc_page_list, llm_client)

    # 检查目录是否包含页码
    if toc_json["page_index_given_in_toc"] == "yes":
        logger.info("目录包含页码")
        return {
            "toc_content": toc_json["toc_content"],
            "toc_page_list": toc_page_list,
            "page_index_given_in_toc": "yes",
        }
    else:
        # 目录不包含页码，继续查找
        current_start_index = toc_page_list[-1] + 1

        while (
            toc_json["page_index_given_in_toc"] == "no"
            and current_start_index < len(page_list)
            and current_start_index < opt.toc_check_page_num
        ):
            additional_toc_pages = await find_toc_pages(
                start_page_index=current_start_index,
                page_list=page_list,
                opt=opt,
                llm_client=llm_client
            )

            if len(additional_toc_pages) == 0:
                break

            additional_toc_json = await toc_extractor(
                page_list, additional_toc_pages, llm_client
            )
            if additional_toc_json["page_index_given_in_toc"] == "yes":
                logger.info("找到包含页码的目录")
                return {
                    "toc_content": additional_toc_json["toc_content"],
                    "toc_page_list": additional_toc_pages,
                    "page_index_given_in_toc": "yes",
                }
            else:
                current_start_index = additional_toc_pages[-1] + 1

        logger.info("目录不包含页码")
        return {
            "toc_content": toc_json["toc_content"],
            "toc_page_list": toc_page_list,
            "page_index_given_in_toc": "no",
        }
