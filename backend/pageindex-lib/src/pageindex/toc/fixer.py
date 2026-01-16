"""
PageIndex 目录修复模块

本模块提供目录错误的修复功能。

主要功能:
    - 单项修复 (single_toc_item_index_fixer): 修复单个目录项的页码
    - 批量修复 (fix_incorrect_toc): 批量修复错误的目录项
    - 重试修复 (fix_incorrect_toc_with_retries): 迭代修复直到收敛

修复流程:
    1. 对于每个错误项，找到前一个正确的项和后一个正确的项
    2. 在这个范围内搜索正确的页码
    3. 验证修复结果
    4. 迭代直到所有错误修复完成或达到最大尝试次数

使用示例:
    >>> from pageindex.toc.fixer import fix_incorrect_toc_with_retries
    >>>
    >>> # 修复错误的目录项
    >>> errors = [{"list_index": 2, "title": "第三章", "physical_index": 10}]
    >>> fixed_toc, remaining_errors = await fix_incorrect_toc_with_retries(
    ...     toc_json, page_list, errors, llm_client=llm_client
    ... )
    >>>
    >>> if remaining_errors:
    ...     print(f"仍有 {len(remaining_errors)} 项未修复")
    ... else:
    ...     print("所有错误已修复")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import copy
import logging
from typing import List, Dict, Any, Optional

from ..core.exceptions import TOCError

logger = logging.getLogger(__name__)


# ============================================================
# 单项修复
# ============================================================

async def single_toc_item_index_fixer(
    section_title: str, content: str, llm_client=None
) -> str:
    """
    修复单个目录项的页码索引

    使用 LLM 在给定的文档内容中查找章节标题出现的物理页码。

    参数:
        section_title: 章节标题
        content: 包含 <physical_index_X> 标记的文档内容
        llm_client: LLM 客户端 (必需)

    返回:
        物理页码索引 (如 "<physical_index_5>")

    使用示例:
        >>> content = "<physical_index_3>页面内容<physical_index_3>"
        >>> index = await single_toc_item_index_fixer("第一章", content, llm_client)
        >>> print(index)  # "<physical_index_3>"
    """
    if llm_client is None:
        raise ValueError("llm_client is required for single_toc_item_index_fixer")

    from ..json_ops import extract_json
    from ..utils import convert_physical_index_to_int

    tob_extractor_prompt = """
    You are given a section title and several pages of a document, your job is to find the physical index of the start page of the section in the partial document.

    The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

    Reply in a JSON format:
    {{
        "thinking": <explain which page, started and closed by <physical_index_X>, contains the start of this section>,
        "physical_index": "<physical_index_X>" (keep the format)
    }}
    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        tob_extractor_prompt
        + "\nSection Title:\n"
        + str(section_title)
        + "\nDocument pages:\n"
        + content
    )
    response = await llm_client.chat_async(prompt, context="目录修复-单项页码修复")
    json_content = extract_json(response)
    return convert_physical_index_to_int(json_content["physical_index"])


# ============================================================
# 批量修复
# ============================================================

async def fix_incorrect_toc(
    toc_with_page_number: List[Dict[str, Any]],
    page_list: List,
    incorrect_results: List[Dict[str, Any]],
    start_index: int = 1,
    llm_client=None,
    logger=None,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    批量修复错误的目录项

    对每个错误的目录项，在前后正确项之间的范围内搜索正确的页码。

    参数:
        toc_with_page_number: 目录结构列表
        page_list: 完整的页面列表
        incorrect_results: 错误的目录项列表
        start_index: 起始页码 (默认 1)
        llm_client: LLM 客户端 (必需)
        logger: 日志记录器 (可选)

    返回:
        (修复后的目录, 仍未修复的错误列表)

    修复逻辑:
        1. 对于每个错误项，找到前一个和后一个正确的项
        2. 在这个范围内提取页面内容
        3. 使用 LLM 查找正确的页码
        4. 验证修复结果

    使用示例:
        >>> errors = [
        ...     {"list_index": 2, "title": "第三章", "physical_index": 10}
        ... ]
        >>> fixed_toc, remaining = await fix_incorrect_toc(
        ...     toc, pages, errors, llm_client=llm_client
        ... )
    """
    if llm_client is None:
        raise ValueError("llm_client is required for fix_incorrect_toc")

    logger.info(f"开始修复 {len(incorrect_results)} 个错误目录项")

    from .validator import check_title_appearance

    incorrect_indices = {result["list_index"] for result in incorrect_results}
    end_index = len(page_list) + start_index - 1

    incorrect_results_and_range_logs = []

    # ============================================================
    # 辅助函数: 处理并检查单个错误项
    # ============================================================
    async def process_and_check_item(incorrect_item: Dict[str, Any]):
        list_index = incorrect_item["list_index"]

        # 检查 list_index 是否有效
        if list_index < 0 or list_index >= len(toc_with_page_number):
            return {
                "list_index": list_index,
                "title": incorrect_item["title"],
                "physical_index": incorrect_item.get("physical_index"),
                "is_valid": False,
            }

        # ============================================================
        # 找到前一个正确的项
        # ============================================================
        prev_correct = None
        for i in range(list_index - 1, -1, -1):
            if i not in incorrect_indices and i >= 0 and i < len(toc_with_page_number):
                physical_index = toc_with_page_number[i].get("physical_index")
                if physical_index is not None:
                    prev_correct = physical_index
                    break
        if prev_correct is None:
            prev_correct = start_index - 1

        # ============================================================
        # 找到后一个正确的项
        # ============================================================
        next_correct = None
        for i in range(list_index + 1, len(toc_with_page_number)):
            if i not in incorrect_indices and i >= 0 and i < len(toc_with_page_number):
                physical_index = toc_with_page_number[i].get("physical_index")
                if physical_index is not None:
                    next_correct = physical_index
                    break
        if next_correct is None:
            next_correct = end_index

        incorrect_results_and_range_logs.append(
            {
                "list_index": list_index,
                "title": incorrect_item["title"],
                "prev_correct": prev_correct,
                "next_correct": next_correct,
            }
        )

        # ============================================================
        # 提取范围内的页面内容
        # ============================================================
        page_contents = []
        for page_index in range(prev_correct, next_correct + 1):
            list_index_page = page_index - start_index
            if list_index_page >= 0 and list_index_page < len(page_list):
                page_text = (
                    f"<physical_index_{page_index}>\n"
                    f"{page_list[list_index_page][0]}\n"
                    f"<physical_index_{page_index}>\n\n"
                )
                page_contents.append(page_text)
            else:
                continue
        content_range = "".join(page_contents)

        # ============================================================
        # 使用 LLM 查找正确的页码
        # ============================================================
        physical_index_int = await single_toc_item_index_fixer(
            incorrect_item["title"], content_range, llm_client
        )

        # ============================================================
        # 验证修复结果
        # ============================================================
        check_item = incorrect_item.copy()
        check_item["physical_index"] = physical_index_int
        check_result = await check_title_appearance(
            check_item, page_list, start_index, llm_client
        )

        return {
            "list_index": list_index,
            "title": incorrect_item["title"],
            "physical_index": physical_index_int,
            "is_valid": check_result["answer"] == "yes",
        }

    # ============================================================
    # 并发处理所有错误项
    # ============================================================
    tasks = [process_and_check_item(item) for item in incorrect_results]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 处理异常结果
    for item, result in zip(incorrect_results, results):
        if isinstance(result, Exception):
            logger.error(f"处理项 {item} 时出错: {result}")
            continue

    # 过滤掉异常结果
    results = [result for result in results if not isinstance(result, Exception)]

    # ============================================================
    # 更新目录并收集无效结果
    # ============================================================
    invalid_results = []
    for result in results:
        if result["is_valid"]:
            # 更新有效的页码
            list_idx = result["list_index"]
            if 0 <= list_idx < len(toc_with_page_number):
                toc_with_page_number[list_idx]["physical_index"] = result[
                    "physical_index"
                ]
            else:
                # 索引越界，视为无效
                invalid_results.append(
                    {
                        "list_index": result["list_index"],
                        "title": result["title"],
                        "physical_index": result["physical_index"],
                    }
                )
        else:
            invalid_results.append(
                {
                    "list_index": result["list_index"],
                    "title": result["title"],
                    "physical_index": result["physical_index"],
                }
            )

    if logger:
        logger.info(f"incorrect_results_and_range_logs: {incorrect_results_and_range_logs}")
        logger.info(f"invalid_results: {invalid_results}")
        logger.info(
            f"修复完成: {len(results) - len(invalid_results)}/{len(results)} 项成功"
        )

    return toc_with_page_number, invalid_results


# ============================================================
# 重试修复
# ============================================================

async def fix_incorrect_toc_with_retries(
    toc_with_page_number: List[Dict[str, Any]],
    page_list: List,
    incorrect_results: List[Dict[str, Any]],
    start_index: int = 1,
    max_attempts: int = 3,
    llm_client=None,
    logger=None,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    迭代修复目录错误，直到收敛或达到最大尝试次数

    这是一个高层函数，封装了修复的迭代逻辑。

    参数:
        toc_with_page_number: 目录结构列表
        page_list: 完整的页面列表
        incorrect_results: 错误的目录项列表
        start_index: 起始页码 (默认 1)
        max_attempts: 最大尝试次数 (默认 3)
        llm_client: LLM 客户端 (必需)
        logger: 日志记录器 (可选)

    返回:
        (修复后的目录, 仍未修复的错误列表)

    迭代逻辑:
        1. 调用 fix_incorrect_toc 修复一批错误
        2. 如果仍有错误，继续迭代
        3. 达到最大尝试次数后停止

    使用示例:
        >>> errors = [{"list_index": 2, "title": "第三章", "physical_index": 10}]
        >>> fixed_toc, remaining = await fix_incorrect_toc_with_retries(
        ...     toc, pages, errors, max_attempts=3, llm_client=llm_client
        ... )
        >>>
        >>> if not remaining:
        ...     print("所有错误已修复")
        >>> else:
        ...     print(f"仍有 {len(remaining)} 项未修复")
    """
    logger.info("开始迭代修复目录错误")

    fix_attempt = 0
    current_toc = toc_with_page_number
    current_incorrect = incorrect_results

    while current_incorrect:
        logger.info(
            f"修复迭代 {fix_attempt + 1}: {len(current_incorrect)} 个错误项"
        )

        current_toc, current_incorrect = await fix_incorrect_toc(
            current_toc,
            page_list,
            current_incorrect,
            start_index,
            llm_client,
            logger,
        )

        fix_attempt += 1
        if fix_attempt >= max_attempts:
            logger.warning(f"达到最大修复尝试次数 ({max_attempts})")
            break

    if not current_incorrect:
        logger.info("所有错误已成功修复")
    else:
        logger.warning(
            f"修复完成，仍有 {len(current_incorrect)} 项未修复"
        )

    return current_toc, current_incorrect
