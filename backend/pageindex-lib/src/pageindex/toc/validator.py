"""
PageIndex 目录验证模块

本模块提供目录准确性的验证功能。

主要功能:
    - 目录准确性验证 (verify_toc): 抽样验证目录项是否准确
    - 标题出现验证 (check_title_appearance): 检查标题是否在指定页码出现
    - 页首出现验证 (check_title_appearance_in_start): 检查标题是否在页面开头
    - 并发页首验证 (check_title_appearance_in_start_concurrent): 批量验证

验证流程:
    1. 从目录中随机抽取 N 项 (或验证所有项)
    2. 对每一项，使用 LLM 检查标题是否在指定页码出现
    3. 计算准确率 = 正确数 / 总数
    4. 返回准确率和错误列表

使用示例:
    >>> from pageindex.toc.validator import verify_toc, check_title_appearance
    >>>
    >>> # 验证整个目录
    >>> accuracy, errors = await verify_toc(page_list, toc_json, llm_client)
    >>> print(f"准确率: {accuracy * 100:.1f}%")
    >>>
    >>> # 验证单个目录项
    >>> item = {"title": "第一章", "physical_index": 5, "list_index": 0}
    >>> result = await check_title_appearance(item, page_list, llm_client)
    >>> if result["answer"] == "yes":
    ...     print("标题出现在指定页面")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import logging
import random
from typing import List, Dict, Any, Optional

from ..core.exceptions import TOCError

logger = logging.getLogger(__name__)


# ============================================================
# 标题出现验证
# ============================================================

async def check_title_appearance(
    item: Dict[str, Any],
    page_list: List,
    start_index: int = 1,
    llm_client=None,
) -> Dict[str, Any]:
    """
    检查目录项的标题是否在指定页码出现

    使用 LLM 进行模糊匹配，忽略空格等不一致。

    参数:
        item: 目录项，必须包含:
            - title: 章节标题
            - physical_index: 物理页码 (可选)
            - list_index: 在目录中的索引 (可选)
        page_list: 完整的页面列表
        start_index: 起始页码 (默认 1)
        llm_client: LLM 客户端 (必需)

    返回:
        包含以下键的字典:
            - list_index: 目录项索引
            - answer: "yes" 或 "no"
            - title: 标题
            - page_number: 页码

    使用示例:
        >>> item = {"title": "第一章", "physical_index": 5, "list_index": 0}
        >>> result = await check_title_appearance(item, pages, llm_client)
        >>> if result["answer"] == "yes":
        ...     print("标题验证成功")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for check_title_appearance")

    title = item["title"]

    # 如果没有 physical_index，返回默认结果
    if "physical_index" not in item or item["physical_index"] is None:
        return {
            "list_index": item.get("list_index"),
            "answer": "no",
            "title": title,
            "page_number": None,
        }

    page_number = item["physical_index"]
    page_text = page_list[page_number - start_index][0]

    from ..json_ops import extract_json

    prompt = f"""
    Your job is to check if the given section appears or starts in the given page_text.

    Note: do fuzzy matching, ignore any space inconsistency in the page_text.

    The given section title is {title}.
    The given page_text is {page_text}.

    Reply format:
    {{

        "thinking": <why do you think the section appears or starts in the page_text>
        "answer": "yes or no" (yes if the section appears or starts in the page_text, no otherwise)
    }}
    Directly return the final JSON structure. Do not output anything else."""

    context = f"标题验证-检查'{title[:30]}...'是否在第{page_number}页"
    response = await llm_client.chat_async(prompt, context=context)
    response = extract_json(response)

    answer = response.get("answer", "no")

    logger.debug(
        f"标题验证: '{title[:30]}...' @ 页码{page_number} → {answer}"
    )

    return {
        "list_index": item.get("list_index"),
        "answer": answer,
        "title": title,
        "page_number": page_number,
    }


async def check_title_appearance_in_start(
    title: str, page_text: str, llm_client=None, logger=None
) -> str:
    """
    检查标题是否在页面开头出现

    与 check_title_appearance 的区别是，这个函数检查标题是否是页面的
    第一个内容（即章节是否从这一页开始）。

    参数:
        title: 章节标题
        page_text: 页面文本
        llm_client: LLM 客户端 (必需)
        logger: 日志记录器 (可选)

    返回:
        "yes" 或 "no"

    使用示例:
        >>> result = await check_title_appearance_in_start(
        ...     "第一章", page_text, llm_client
        ... )
        >>> if result == "yes":
        ...     print("章节从这一页开始")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for check_title_appearance_in_start")

    from ..json_ops import extract_json

    prompt = f"""
    You will be given the current section title and the current page_text.
    Your job is to check if the current section starts in the beginning of the given page_text.
    If there are other contents before the current section title, then the current section does not start in the beginning of the given page_text.
    If the current section title is the first content in the given page_text, then the current section starts in the beginning of the given page_text.

    Note: do fuzzy matching, ignore any space inconsistency in the page_text.

    The given section title is {title}.
    The given page_text is {page_text}.

    reply format:
    {{
        "thinking": <why do you think the section appears or starts in the page_text>
        "start_begin": "yes or no" (yes if the section starts in the beginning of the page_text, no otherwise)
    }}
    Directly return the final JSON structure. Do not output anything else."""

    context = f"标题验证-检查'{title[:30]}...'是否在页面开头"
    response = await llm_client.chat_async(prompt, context=context)
    response = extract_json(response)

    if logger:
        logger.info(f"Response: {response}")

    return response.get("start_begin", "no")


async def check_title_appearance_in_start_concurrent(
    structure: List[Dict[str, Any]],
    page_list: List,
    llm_client=None,
    logger=None,
) -> List[Dict[str, Any]]:
    """
    并发检查所有目录项的标题是否在各自页面开头出现

    这是一个批量验证函数，使用 asyncio.gather 并发执行所有验证。

    参数:
        structure: 目录结构列表
        page_list: 完整的页面列表
        llm_client: LLM 客户端 (必需)
        logger: 日志记录器 (可选)

    返回:
        更新后的目录结构列表，每项添加 "appear_start" 键

    使用示例:
        >>> structure = await check_title_appearance_in_start_concurrent(
        ...     toc_json, page_list, llm_client
        ... )
        >>> for item in structure:
        ...     print(f"{item['title']}: {item.get('appear_start', 'unknown')}")
    """
    if logger:
        logger.info("开始批量验证标题页首出现 (并发)")

    # 跳过没有 physical_index 的项
    for item in structure:
        if item.get("physical_index") is None:
            item["appear_start"] = "no"

    # 只对有有效 physical_index 的项进行验证
    tasks = []
    valid_items = []
    for item in structure:
        if item.get("physical_index") is not None:
            page_text = page_list[item["physical_index"] - 1][0]
            tasks.append(
                check_title_appearance_in_start(
                    item["title"], page_text, llm_client=llm_client, logger=logger
                )
            )
            valid_items.append(item)

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for item, result in zip(valid_items, results):
        if isinstance(result, Exception):
            if logger:
                logger.error(f"验证 {item['title']} 时出错: {result}")
            item["appear_start"] = "no"
        else:
            item["appear_start"] = result

    if logger:
        yes_count = sum(1 for item in structure if item.get("appear_start") == "yes")
        logger.info(f"页首出现验证完成: {yes_count}/{len(structure)} 项在页首开始")

    return structure


# ============================================================
# 目录准确性验证
# ============================================================

async def verify_toc(
    page_list: List,
    list_result: List[Dict[str, Any]],
    start_index: int = 1,
    N: Optional[int] = None,
    llm_client=None,
) -> tuple[float, List[Dict[str, Any]]]:
    """
    验证目录的准确性

    从目录中随机抽取 N 项进行验证，使用 LLM 检查每一项的标题
    是否在指定页码出现。

    参数:
        page_list: 完整的页面列表
        list_result: 目录结构列表
        start_index: 起始页码 (默认 1)
        N: 抽样数量，None 表示验证所有项
        llm_client: LLM 客户端 (必需)

    返回:
        (准确率, 错误结果列表)
        - 准确率: 0.0 - 1.0 之间的浮点数
        - 错误结果: 验证失败的目录项列表

    验证逻辑:
        1. 找到最后一个非 None 的 physical_index
        2. 如果最后一个 physical_index 小于页面总数的一半，返回 (0, [])
        3. 随机抽样或验证所有项
        4. 并发执行所有验证
        5. 计算准确率

    使用示例:
        >>> # 验证所有项
        >>> accuracy, errors = await verify_toc(pages, toc, llm_client)
        >>> print(f"准确率: {accuracy * 100:.1f}%")
        >>>
        >>> # 随机抽样 10 项验证
        >>> accuracy, errors = await verify_toc(pages, toc, N=10, llm_client)
        >>> print(f"抽样准确率: {accuracy * 100:.1f}%")
        >>>
        >>> # 处理错误
        >>> for error in errors:
        ...     print(f"错误: {error['title']} @ 页码{error['page_number']}")
    """
    logger.info("开始目录验证")

    # ============================================================
    # 步骤1: 找到最后一个非 None 的 physical_index
    # ============================================================
    last_physical_index = None
    for item in reversed(list_result):
        if item.get("physical_index") is not None:
            last_physical_index = item["physical_index"]
            break

    # 如果没有有效的 physical_index 或太小，返回默认值
    if last_physical_index is None or last_physical_index < len(page_list) / 2:
        logger.warning(
            f"目录物理页码无效: last_physical_index={last_physical_index}, "
            f"page_count={len(page_list)}"
        )
        return 0.0, []

    # ============================================================
    # 步骤2: 确定要验证的项
    # ============================================================
    if N is None:
        logger.info("验证所有目录项")
        sample_indices = range(0, len(list_result))
    else:
        N = min(N, len(list_result))
        logger.info(f"随机抽样 {N} 项验证")
        sample_indices = random.sample(range(0, len(list_result)), N)

    # ============================================================
    # 步骤3: 准备验证列表 (跳过 None physical_index)
    # ============================================================
    indexed_sample_list = []
    for idx in sample_indices:
        item = list_result[idx]
        if item.get("physical_index") is not None:
            item_with_index = item.copy()
            item_with_index["list_index"] = idx
            indexed_sample_list.append(item_with_index)

    logger.info(f"准备验证 {len(indexed_sample_list)} 项")

    # ============================================================
    # 步骤4: 并发执行所有验证
    # ============================================================
    tasks = [
        check_title_appearance(item, page_list, start_index, llm_client)
        for item in indexed_sample_list
    ]
    results = await asyncio.gather(*tasks)

    # ============================================================
    # 步骤5: 处理结果
    # ============================================================
    correct_count = 0
    incorrect_results = []

    for result in results:
        if result["answer"] == "yes":
            correct_count += 1
        else:
            incorrect_results.append(result)

    # ============================================================
    # 步骤6: 计算准确率
    # ============================================================
    checked_count = len(results)
    accuracy = correct_count / checked_count if checked_count > 0 else 0

    logger.info(
        f"目录验证完成: {correct_count}/{checked_count} 正确, "
        f"准确率={accuracy * 100:.1f}%, "
        f"错误数={len(incorrect_results)}"
    )

    return accuracy, incorrect_results
