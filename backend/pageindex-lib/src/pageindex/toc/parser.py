"""
PageIndex 目录解析模块

本模块提供目录内容的提取、转换和页码索引提取功能。

主要功能:
    - 目录内容提取 (toc_extractor): 从目录页提取原始文本
    - 目录转 JSON (toc_transformer): 将目录转换为结构化 JSON
    - 页码索引提取 (toc_index_extractor): 从文档中提取物理页码
    - 页码检测 (detect_page_index): 检测目录是否包含页码
    - 目录内容续接 (extract_toc_content): 处理被截断的目录

处理流程:
    1. toc_extractor: 提取目录原始内容
    2. detect_page_index: 检测是否有页码
    3. toc_transformer: 转换为 JSON 结构
    4. toc_index_extractor: 提取物理页码

使用示例:
    >>> from pageindex.toc.parser import (
    ...     toc_extractor,
    ...     toc_transformer,
    ...     toc_index_extractor,
    ... )
    >>>
    >>> # 提取目录内容
    >>> toc_data = await toc_extractor(page_list, toc_pages, llm_client)
    >>> toc_content = toc_data["toc_content"]
    >>>
    >>> # 转换为 JSON
    >>> toc_json = await toc_transformer(toc_content, llm_client)
    >>>
    >>> # 提取页码索引
    >>> toc_with_index = await toc_index_extractor(toc_json, document_text, llm_client)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import json
import logging
import re
from typing import List, Dict, Any, Optional

from ..core.exceptions import TOCError

logger = logging.getLogger(__name__)


# ============================================================
# 目录内容提取
# ============================================================

async def toc_extractor(
    page_list: List,
    toc_page_list: List[int],
    llm_client=None,
) -> Dict[str, Any]:
    """
    从目录页提取目录内容

    整合多个目录页的内容，并检测目录是否包含页码。

    参数:
        page_list: 完整的页面列表
        toc_page_list: 目录页的索引列表
        llm_client: LLM 客户端 (必需)

    返回:
        包含以下键的字典:
            - toc_content: 目录文本内容
            - page_index_given_in_toc: "yes" 或 "no"

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> toc_data = await toc_extractor(page_list, [0, 1], llm_client)
        >>> toc_content = toc_data["toc_content"]
        >>> has_page_numbers = toc_data["page_index_given_in_toc"] == "yes"
    """
    if llm_client is None:
        raise ValueError("llm_client is required for toc_extractor")

    def transform_dots_to_colon(text: str) -> str:
        """
        将目录中的点号引导符转换为冒号

        例如: "第一章...............3" → "第一章: 3"
        """
        text = re.sub(r"\.{5,}", ": ", text)
        # Handle dots separated by spaces
        text = re.sub(r"(?:\. ){5,}\.?", ": ", text)
        return text

    # ============================================================
    # 步骤1: 提取目录页内容
    # ============================================================
    toc_content = ""
    for page_index in toc_page_list:
        toc_content += page_list[page_index][0]
    toc_content = transform_dots_to_colon(toc_content)

    # ============================================================
    # 步骤2: 检测目录是否包含页码
    # ============================================================
    has_page_index = await detect_page_index(toc_content, llm_client=llm_client)

    logger.info(
        f"目录提取完成: {len(toc_page_list)} 个目录页, "
        f"包含页码: {has_page_index}"
    )

    return {
        "toc_content": toc_content,
        "page_index_given_in_toc": has_page_index
    }


# ============================================================
# 页码检测
# ============================================================

async def detect_page_index(toc_content: str, llm_client=None) -> str:
    """
    检测目录是否包含页码/索引

    使用 LLM 判断目录文本中是否包含页码信息。

    参数:
        toc_content: 目录文本内容
        llm_client: LLM 客户端 (必需)

    返回:
        "yes" 或 "no"

    使用示例:
        >>> has_page_numbers = await detect_page_index(toc_text, llm_client)
        >>> if has_page_numbers == "yes":
        ...     print("目录包含页码")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for detect_page_index")

    logger.info("开始检测目录页码")

    from ..json_ops import extract_json

    prompt = f"""
    You will be given a table of contents.

    Your job is to detect if there are page numbers/indices given within the table of contents.

    Given text: {toc_content}

    Reply format:
    {{
        "thinking": <why do you think there are page numbers/indices given within the table of contents>
        "page_index_given_in_toc": "<yes or no>"
    }}
    Directly return the final JSON structure. Do not output anything else."""

    response = await llm_client.chat_async(prompt, context="目录检测-检测页码")
    json_content = extract_json(response)
    return json_content.get("page_index_given_in_toc", "no")


# ============================================================
# 目录转 JSON
# ============================================================

async def check_if_toc_transformation_is_complete(
    content: str, toc: str, llm_client=None
) -> str:
    """
    检查目录转换是否完整

    参数:
        content: 原始目录文本
        toc: 转换后的 JSON 目录
        llm_client: LLM 客户端 (必需)

    返回:
        "yes" 或 "no"
    """
    if llm_client is None:
        raise ValueError("llm_client is required")

    from ..json_ops import extract_json

    prompt = f"""
    You are given a raw table of contents and a  table of contents.
    Your job is to check if the  table of contents is complete.

    Reply format:
    {{
        "thinking": <why do you think the cleaned table of contents is complete or not>
        "completed": "yes" or "no"
    }}
    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        prompt
        + "\n Raw Table of contents:\n"
        + content
        + "\n Cleaned Table of contents:\n"
        + toc
    )
    response = await llm_client.chat_async(prompt, context="目录检测-检查转换完整性")
    json_content = extract_json(response)
    return json_content.get("completed", "no")


async def toc_transformer(toc_content: str, llm_client=None) -> List[Dict[str, Any]]:
    """
    将目录文本转换为 JSON 结构

    使用 LLM 将目录文本转换为结构化的 JSON 格式。
    如果目录很长，可能会被截断，此函数会自动续接生成。

    参数:
        toc_content: 目录文本内容
        llm_client: LLM 客户端 (必需)

    返回:
        目录 JSON 列表，格式:
        [
            {
                "structure": "1" or "1.1" or None,
                "title": "章节标题",
                "page": 页码 or None,
            },
            ...
        ]

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> toc_json = await toc_transformer(toc_text, llm_client)
        >>> for item in toc_json:
        ...     print(f"{item['structure']} {item['title']}: {item.get('page')}")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for toc_transformer")

    logger.info("开始目录转换 (文本 → JSON)")

    from ..json_ops import extract_json, get_json_content
    from ..utils import convert_page_to_int

    init_prompt = """
    You are given a table of contents, You job is to transform the whole table of content into a JSON format included table_of_contents.

    structure is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

    The response should be in the following JSON format:
    {{
    table_of_contents: [
        {{
            "structure": <structure index, "x.x.x" or None> (string),
            "title": <title of the section>,
            "page": <page number or None>,
        }},
        ...
    ],
    }}
    You should transform the full table of contents in one go.
    Directly return the final JSON structure, do not output anything else. """

    prompt = init_prompt + "\n Given table of contents\n:" + toc_content

    # 第一次调用
    last_complete, finish_reason = await llm_client.chat_with_finish_reason_async(
        prompt=prompt, context="目录转换-转换为JSON"
    )
    if_complete = await check_if_toc_transformation_is_complete(
        toc_content, last_complete, llm_client
    )

    if if_complete == "yes" and finish_reason == "finished":
        last_complete = extract_json(last_complete)
        cleaned_response = convert_page_to_int(last_complete["table_of_contents"])
        return cleaned_response

    # 需要续接生成
    last_complete = get_json_content(last_complete)

    while not (if_complete == "yes" and finish_reason == "finished"):
        position = last_complete.rfind("}")
        if position != -1:
            last_complete = last_complete[: position + 2]
        prompt = f"""
        Your task is to continue the table of contents json structure, directly output the remaining part of the json structure.

        The raw table of contents json structure is:
        {toc_content}

        The incomplete transformed table of contents json structure is:
        {last_complete}

        Please continue the json structure, directly output the remaining part of the json structure."""

        new_complete, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt)

        if new_complete.startswith("```json"):
            new_complete = get_json_content(new_complete)
            last_complete = last_complete + new_complete

        if_complete = await check_if_toc_transformation_is_complete(
            toc_content, last_complete, llm_client
        )

    last_complete = json.loads(last_complete)
    cleaned_response = convert_page_to_int(last_complete["table_of_contents"])
    return cleaned_response


# ============================================================
# 页码索引提取
# ============================================================

async def toc_index_extractor(
    toc: List[Dict[str, Any]], content: str, llm_client=None
) -> List[Dict[str, Any]]:
    """
    从文档内容中提取目录项的物理页码索引

    使用 LLM 分析文档内容，为目录中的每一项找到对应的物理页码。

    参数:
        toc: 目录 JSON 列表
        content: 包含 <physical_index_X> 标记的文档内容
        llm_client: LLM 客户端 (必需)

    返回:
        包含物理页码索引的目录列表

    使用示例:
        >>> toc_with_index = await toc_index_extractor(toc_json, document_text, llm_client)
        >>> for item in toc_with_index:
        ...     if item.get("physical_index"):
        ...         print(f"{item['title']}: 页码 {item['physical_index']}")
    """
    if llm_client is None:
        raise ValueError("llm_client is required for toc_index_extractor")

    logger.info("开始提取目录页码索引")

    from ..json_ops import extract_json

    tob_extractor_prompt = """
    You are given a table of contents in a json format and several pages of a document, your job is to add the physical_index to the table of contents in the json format.

    The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

    The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

    The response should be in the following JSON format:
    [
        {{
            "structure": <structure index, "x.x.x" or None> (string),
            "title": <title of the section>,
            "physical_index": "<physical_index_X>" (keep the format)
        }},
        ...
    ]

    Only add the physical_index to the sections that are in the provided pages.
    If the section is not in the provided pages, do not add the physical_index to it.
    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        tob_extractor_prompt
        + "\nTable of contents:\n"
        + str(toc)
        + "\nDocument pages:\n"
        + content
    )
    response = await llm_client.chat_async(prompt, context="目录提取-提取页码索引")
    json_content = extract_json(response)
    return json_content


# ============================================================
# 目录内容续接
# ============================================================

async def check_if_toc_extraction_is_complete(
    content: str, toc: str, llm_client=None
) -> str:
    """
    检查目录提取是否完整

    参数:
        content: 文档内容
        toc: 已提取的目录
        llm_client: LLM 客户端 (必需)

    返回:
        "yes" 或 "no"
    """
    if llm_client is None:
        raise ValueError("llm_client is required")

    from ..json_ops import extract_json

    prompt = f"""
    You are given a partial document  and a  table of contents.
    Your job is to check if the  table of contents is complete, which it contains all the main sections in the partial document.

    Reply format:
    {{
        "thinking": <why do you think the table of contents is complete or not>
        "completed": "yes" or "no"
    }}
    Directly return the final JSON structure. Do not output anything else."""

    prompt = prompt + "\n Document:\n" + content + "\n Table of contents:\n" + toc
    response = await llm_client.chat_async(prompt, context="目录检测-检查提取完整性")
    json_content = extract_json(response)
    return json_content.get("completed", "no")


async def extract_toc_content(content: str, llm_client=None) -> str:
    """
    从文档中提取完整的目录内容

    处理被截断的目录，使用 LLM 续接生成完整内容。

    参数:
        content: 包含目录的文档内容
        llm_client: LLM 客户端 (必需)

    返回:
        完整的目录文本

    使用示例:
        >>> full_toc = await extract_toc_content(document_text, llm_client)
    """
    if llm_client is None:
        raise ValueError("llm_client is required for extract_toc_content")

    from ..json_ops import extract_json

    prompt = f"""
    Your job is to extract the full table of contents from the given text, replace ... with :

    Given text: {content}

    Directly return the full table of contents content. Do not output anything else."""

    response, finish_reason = await llm_client.chat_with_finish_reason_async(
        prompt=prompt, context="目录提取-提取目录内容"
    )

    if_complete = await check_if_toc_extraction_is_complete(content, response, llm_client)
    if if_complete == "yes" and finish_reason == "finished":
        return response

    chat_history = [
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": response},
    ]
    prompt = f"""please continue the generation of table of contents , directly output the remaining part of the structure"""
    new_response, finish_reason = await llm_client.chat_with_finish_reason_async(
        prompt=prompt, chat_history=chat_history, context="目录提取-继续生成"
    )
    response = response + new_response
    if_complete = await check_if_toc_extraction_is_complete(content, response, llm_client)

    max_attempts = 5
    attempt = 0
    while not (if_complete == "yes" and finish_reason == "finished"):
        chat_history = [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": response},
        ]
        prompt = f"""please continue the generation of table of contents , directly output the remaining part of the structure"""
        new_response, finish_reason = await llm_client.chat_with_finish_reason_async(
            prompt=prompt, chat_history=chat_history, context="目录提取-继续生成"
        )
        response = response + new_response
        if_complete = await check_if_toc_extraction_is_complete(content, response, llm_client)

        attempt += 1
        if attempt >= max_attempts:
            raise TOCError(
                f"目录提取失败: 达到最大重试次数 ({max_attempts})",
                stage="extraction"
            )

    return response
