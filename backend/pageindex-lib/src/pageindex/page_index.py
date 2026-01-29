"""
PageIndex 主入口模块

本模块提供 PDF 和 EPUB 文档结构分析的主入口函数。

主要功能:
    - page_index_main: PDF/EPUB 索引的主函数
    - page_index: 便捷的索引函数
    - tree_parser: 树状结构解析器
    - _detect_document_type: 检测文档类型 (PDF/EPUB)
    - _process_epub: 处理 EPUB 文件

使用示例:
    >>> from pageindex import page_index
    >>>
    >>> # 索引 PDF 文档
    >>> result = page_index("document.pdf")
    >>> print(result["doc_name"])
    >>> print(result["structure"])
    >>>
    >>> # 索引 EPUB 文档
    >>> result = page_index("book.epub")
    >>> print(result["doc_name"])
    >>> print(result["structure"])

作者: DeepPDF Team
创建时间: 2026-01-16
更新时间: 2026-01-28 (添加 EPUB 支持)
"""

import os
import json
import copy
import math
import random
import re
import asyncio
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

# 从新模块导入
from .pdf import PDFParser
from .pdf.parser import get_text_of_pages
from .pdf.tokens import count_tokens
from .llm import UnifiedLLM, get_provider
from .core import ConfigLoader, ValidationError, load_config
from .toc import (
    find_toc_pages,
    _calculate_toc_confidence,
    check_toc,
    toc_transformer,
    toc_extractor,
    toc_index_extractor,
    extract_toc_content,
    detect_page_index,
    verify_toc,
    check_title_appearance_in_start_concurrent,
    fix_incorrect_toc_with_retries,
)
from .structure import (
    list_to_tree,
    write_node_id,
    add_node_text,
    add_node_text_with_labels,
)
from .json_ops import extract_json, get_json_content

# 从 utils 导入尚未迁移的函数
from .utils import (
    get_page_tokens,
    get_text_of_pdf_pages,
    get_text_of_pdf_pages_with_labels,
    convert_page_to_int,
    convert_physical_index_to_int,
    post_processing,
    add_preface_if_needed,
    generate_node_summary,
    generate_summaries_for_structure,
    create_clean_structure_for_description,
    generate_doc_description,
    remove_structure_text,
    remove_fields,
    format_structure,
    JsonLogger,
    get_pdf_name,
)


################### check title in page #########################################################
async def check_title_appearance(item, page_list, start_index=1, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for check_title_appearance")

    title = item["title"]
    if "physical_index" not in item or item["physical_index"] is None:
        return {
            "list_index": item.get("list_index"),
            "answer": "no",
            "title": title,
            "page_number": None,
        }

    page_number = item["physical_index"]
    page_text = page_list[page_number - start_index][0]

    prompt = f"""
    Your job is to check if the given section title appears or starts in the given page_text.

    # Chinese Title Matching (中文标题匹配)

    ## Exact Match (精确匹配)
    The title appears exactly as given.

    ## Fuzzy Match Guidelines (模糊匹配指南)

    For Chinese documents, consider these variations as a match:

    1. **Punctuation differences**
       - TOC: "第一章：研究背景"
       - Page: "第一章 研究背景" or "第一章. 研究背景"
       - Full-width vs half-width: ：(U+FF1A) vs :(U+003A)

    2. **Spacing differences**
       - TOC: "第一章  研究背景" (multiple spaces)
       - Page: "第一章 研究背景" (single space)

    3. **Number format differences**
       - TOC: "第一章"
       - Page: "第 1 章" or "第1章"

    4. **Minor wording variations (谨慎处理)**
       - TOC: "1.1 研究意义"
       - Page: "1.1 研究的目的与意义"
       Consider as match ONLY if the core title is preserved and context is clear.

    ## Non-Matching Cases (不匹配情况)

    DO NOT consider as a match if:
    - The title is mentioned as a reference (e.g., "参见第一章...")
    - Only partial match without proper context
    - Completely different titles with similar keywords

    ---

    The given section title is: {title}

    The given page_text is: {page_text}

    Reply format:
    {{
        "thinking": <why do you think the section appears or starts in the page_text>
        "answer": "yes or no" (yes if the section appears or starts in the page_text, no otherwise)
    }}

    Directly return the final JSON structure. Do not output anything else."""

    # 添加上下文信息：显示标题和页码
    context = f"标题验证-检查'{title[:30]}...'是否在第{page_number}页"
    response = await llm_client.chat_async(prompt, context=context)
    response = extract_json(response)
    if "answer" in response:
        answer = response["answer"]
    else:
        answer = "no"
    return {
        "list_index": item["list_index"],
        "answer": answer,
        "title": title,
        "page_number": page_number,
    }


async def check_title_appearance_in_start(title, page_text, llm_client=None, logger=None):
    if llm_client is None:
        raise ValueError("llm_client is required for check_title_appearance_in_start")

    prompt = f"""
    You will be given a section title and a page text.
    Your job is to check if the section title appears at the very BEGINNING of the page text.

    # Definition of "Beginning" (开头的定义)

    **"yes" (在开头)**: The section title is the FIRST substantive content on the page
    - Minor whitespace before the title is OK
    - Page numbers or headers (like "Page 5") are OK before the title
    - No other section titles or body text before it

    **"no" (不在开头)**: There is other content before the section title
    - Previous sections continuing from the last page
    - Other section titles appearing first
    - Body paragraphs or content before this section

    # Chinese Title Matching (中文标题匹配)

    Consider these variations as the SAME title:

    1. **Punctuation differences**
       - TOC: "第一章：研究背景"
       - Page: "第一章 研究背景" or "第一章. 研究背景"

    2. **Spacing differences**
       - TOC: "第一章  研究背景"
       - Page: "第一章 研究背景"

    3. **Number format differences**
       - TOC: "第一章"
       - Page: "第 1 章" or "第1章"

    4. **Full-width vs half-width punctuation**
       - ：(U+FF1A) vs :(U+003A)
       - ．(U+FF0E) vs .(U+002E)

    # Examples (示例)

    **Example 1 - "yes" (在开头)**:
    ```
    <physical_index_5>
    第一章 研究背景

    本章主要讨论...
    ```
    Title "第一章 研究背景" appears at beginning → "yes"

    **Example 2 - "no" (不在开头)**:
    ```
    <physical_index_5>
    ...continued from previous section

    1.2 研究方法
    本章主要讨论...

    第一章 研究背景
    ```
    Title "第一章 研究背景" appears AFTER other content → "no"

    ---

    The given section title is: {title}

    The given page_text is: {page_text}

    Reply format:
    {{
        "thinking": <why do you think the section appears or starts in the page_text>
        "start_begin": "yes or no" (yes if the section starts in the beginning of the page_text, no otherwise)
    }}

    Directly return the final JSON structure. Do not output anything else."""

    # 添加上下文信息
    context = f"标题验证-检查'{title[:30]}...'是否在页面开头"
    response = await llm_client.chat_async(prompt, context=context)
    response = extract_json(response)
    if logger:
        logger.info(f"Response: {response}")
    return response.get("start_begin", "no")


async def check_title_appearance_in_start_concurrent(
    structure, page_list, llm_client=None, logger=None
):
    if logger:
        logger.info("Checking title appearance in start concurrently")

    # skip items without physical_index
    for item in structure:
        if item.get("physical_index") is None:
            item["appear_start"] = "no"

    # only for items with valid physical_index
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
                logger.error(f"Error checking start for {item['title']}: {result}")
            item["appear_start"] = "no"
        else:
            item["appear_start"] = result

    return structure


async def toc_detector_single_page(content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for toc_detector_single_page")

    prompt = f"""
    Your job is to detect if there is a table of contents in the given text.

    # Chinese PDF Table of Contents Characteristics (中文PDF目录特征)

    ## Common Keywords (常见关键词)
    - Direct indicators: 目录, 目　录 (full-width space), Contents, 目录表
    - Secondary indicators: 篇目, 章节, 索引

    ## Section Numbering Formats (章节编号格式)
    Chinese documents may use mixed numbering systems:
    - Chinese numerals: 第一章, 第二章, 第三章
    - Arabic numerals: 1. 第一章, 2. 第二章, 1.1, 1.2
    - Mixed formats: 第一章 1.1, 一、 (一) 1.

    ## Page Number Formats (页码格式)
    - Chinese style: 第5页, 第 5 页, 五
    - Arabic style: P5, Page 5, 5
    - Symbols: .............. 5 (dot leaders)

    ## Exclusions (排除项)
    The following are NOT table of contents:
    - 摘要, Abstract
    - 图表目录, List of Figures/Tables
    - 符号说明, Notation List
    - 参考文献, References
    - 致谢, Acknowledgments

    ---

    Given text: {content}

    return the following JSON format:
    {{
        "thinking": <why do you think there is a table of content in the given text>
        "toc_detected": "<yes or no>",
    }}

    Directly return the final JSON structure. Do not output anything else."""

    # 添加上下文信息
    response = await llm_client.chat_async(prompt, context="目录检测-单页")
    # print('response', response)
    json_content = extract_json(response)
    return json_content["toc_detected"]


async def check_if_toc_extraction_is_complete(content, toc, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for check_if_toc_extraction_is_complete")

    prompt = f"""
    You are given a partial document and a table of contents (TOC).
    Your job is to check if the TOC is complete - it should contain all the main sections from the document.

    # What Completeness Means (完整性的含义)

    **"yes" (完整)**: The TOC includes all main sections visible in the document
    - All chapter-level sections (第一章, 第二章, etc.) are present
    - Major subsections are included (1.1, 1.2, etc.)
    - Minor omissions OK (some sub-subsections may be missing)

    **"no" (不完整)**: The TOC is missing significant sections
    - Missing entire chapters or main sections
    - Gaps in section numbering (e.g., has 1.1 and 1.3, but missing 1.2)
    - Document continues with new major sections not in TOC

    # Chinese Document Section Patterns (中文文档章节模式)

    ## Main Sections to Include (应包含的主要章节)

    ### Academic Papers (学术论文)
    Must include:
    - 绪论/引言/第一章
    - 主要章节 (文献综述/方法/实验/结果等)
    - 结论

    May exclude:
    - 摘要/Abstract (usually before TOC)
    - 参考文献/References (usually after TOC)
    - 致谢/Acknowledgments (usually after TOC)
    - 附录/Appendix (optional, at the end)

    ### Technical Documents (技术文档)
    Must include:
    - 主要章节 (概述/安装/使用/API等)

    May exclude:
    - 版权信息
    - 目录本身

    ### Books (书籍)
    Must include:
    - 篇/章 (parts/chapters)
    - Major sections

    # Completeness Check Process (完整性检查流程)

    1. List all section titles visible in the document
    2. List all section titles in the TOC
    3. Check if all major document sections are present in TOC
    4. Consider "complete" if 90%+ of main sections are covered

    ---

    Document content: {content}

    Table of contents: {toc}

    Reply format:
    {{
        "thinking": <why do you think the table of contents is complete or not>
        "completed": "yes" or "no"
    }}

    Directly return the final JSON structure. Do not output anything else."""

    prompt = prompt + "\n Document:\n" + content + "\n Table of contents:\n" + toc
    # 添加上下文信息
    response = await llm_client.chat_async(prompt, context="目录检测-检查提取完整性")
    json_content = extract_json(response)
    return json_content["completed"]


async def check_if_toc_transformation_is_complete(content, toc, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for check_if_toc_transformation_is_complete")

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
    # 添加上下文信息
    response = await llm_client.chat_async(prompt, context="目录检测-检查转换完整性")
    json_content = extract_json(response)
    return json_content["completed"]


async def extract_toc_content(content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for extract_toc_content")

    prompt = f"""
    Your job is to extract the full table of contents from the given text, replace ... with :

    Given text: {content}

    Directly return the full table of contents content. Do not output anything else."""

    # 添加上下文信息
    response, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt, context="目录提取-提取目录内容")

    if_complete = await check_if_toc_transformation_is_complete(content, response, llm_client)
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
    if_complete = await check_if_toc_transformation_is_complete(content, response, llm_client)

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
        if_complete = await check_if_toc_transformation_is_complete(content, response, llm_client)

        # Optional: Add a maximum retry limit to prevent infinite loops
        if len(chat_history) > 5:  # Arbitrary limit of 10 attempts
            raise Exception(
                "Failed to complete table of contents after maximum retries"
            )

    return response


async def detect_page_index(toc_content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for detect_page_index")

    print("start detect_page_index")
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

    # 添加上下文信息
    response = await llm_client.chat_async(prompt, context="目录检测-检测页码")
    json_content = extract_json(response)
    return json_content["page_index_given_in_toc"]


async def toc_extractor(page_list, toc_page_list, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for toc_extractor")

    def transform_dots_to_colon(text):
        text = re.sub(r"\.{5,}", ": ", text)
        # Handle dots separated by spaces
        text = re.sub(r"(?:\. ){5,}\.?", ": ", text)
        return text

    toc_content = ""
    for page_index in toc_page_list:
        toc_content += page_list[page_index][0]
    toc_content = transform_dots_to_colon(toc_content)
    has_page_index = await detect_page_index(toc_content, llm_client=llm_client)

    return {"toc_content": toc_content, "page_index_given_in_toc": has_page_index}


async def toc_index_extractor(toc, content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for toc_index_extractor")

    print("start toc_index_extractor")
    tob_extractor_prompt = """
    You are given a table of contents in JSON format and document pages with physical location tags.
    Your job is to match each TOC entry to its physical page location.

    # Physical Page Tags (物理页码标签)

    Document pages contain tags like:
    - `<physical_index_1>` - Start of page 1
    - `<physical_index_5>` - Start of page 5

    These tags mark the exact location where each page begins.

    # Chinese Title Matching (中文标题匹配)

    ## Exact Match (精确匹配)
    Match the title exactly as it appears in the document.

    ## Fuzzy Match Guidelines (模糊匹配指南)

    When exact match is not found, consider these variations:

    1. **Punctuation differences**
       - TOC: "第一章：研究背景"
       - Page: "第一章 研究背景" or "第一章. 研究背景"

    2. **Minor wording differences**
       - TOC: "1.1 研究意义"
       - Page: "1.1 研究的目的与意义" (may match if context is clear)

    3. **Synonym variations (谨慎处理)**
       - TOC: "引言"
       - Page: "绪论" or "前言"
       Only match if confident (same context, same position in TOC)

    4. **Number format differences**
       - TOC: "第一章"
       - Page: "第 1 章" or "第1章"

    ## Matching Strategy (匹配策略)

    1. **First choice**: Exact match
    2. **Second choice**: Match after removing punctuation differences
    3. **Last choice**: Match based on structure hierarchy

    ## Important Notes (重要说明)

    - Only add physical_index to entries found in the provided pages
    - If not found, do NOT add physical_index (omit the field)
    - When title appears multiple times, use the FIRST occurrence
    - Keep the tag format exactly: `<physical_index_X>`

    ---

    Response format:
    [
        {{
            "structure": <structure index> (string),
            "title": <title> (string),
            "physical_index": "<physical_index_X>" or omit (string)
        }},
        ...
    ]

    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        tob_extractor_prompt
        + "\nTable of contents:\n"
        + str(toc)
        + "\nDocument pages:\n"
        + content
    )
    # 添加上下文信息
    response = await llm_client.chat_async(prompt, context="目录提取-提取页码索引")
    json_content = extract_json(response)
    return json_content


async def toc_transformer(toc_content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for toc_transformer")

    print("start toc_transformer")
    init_prompt = """
    You are given a table of contents. Your job is to transform it into JSON format.

    # Structure Index System (结构索引系统)

    The structure field represents the hierarchy using dot-separated numbers.

    ## Conversion Rules (转换规则)

    ### Chinese Numerals → Arabic Numerals
    - 一、二、三 → 1, 2, 3
    - 第X章、第X节 → X
    - （一）、（二） → 1.1, 1.2 (when nested)
    - 一、 (一) 1. → 1, 1.1, 1.1.1

    ### Hierarchy Examples (层级示例)

    Chinese TOC → JSON structure:
    ```
    第一篇  概论
      第一章  背景
        1.1  意义
        1.2  内容
      第二章  方法
    第二篇  实验
    ```

    ↓

    ```json
    [
      {"structure": "1", "title": "概论"},
      {"structure": "1.1", "title": "背景"},
      {"structure": "1.1.1", "title": "意义"},
      {"structure": "1.1.2", "title": "内容"},
      {"structure": "1.2", "title": "方法"},
      {"structure": "2", "title": "实验"}
    ]
    ```

    ## Special Cases (特殊情况)

    1. **No explicit numbering**: Assign structure based on indentation level
    2. **Mixed numbering**: Standardize to Arabic numerals (1, 1.1, 1.1.1)
    3. **Preface/Appendix**: Use "0" for preface, "A", "B" for appendices
    4. **Pageless entries**: Set page to null

    ## Response Format

    {{
      "table_of_contents": [
        {{
          "structure": <structure index like "1" or "1.1.1", or null> (string),
          "title": <title of the section> (string),
          "page": <page number as integer, or null> (integer or null),
        }},
        ...
      ],
    }}

    Transform the full table of contents in one go.
    Directly return the final JSON structure. Do not output anything else. """

    prompt = init_prompt + "\n Given table of contents\n:" + toc_content
    # 添加上下文信息
    last_complete, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt, context="目录转换-转换为JSON")
    if_complete = await check_if_toc_transformation_is_complete(
        toc_content, last_complete, llm_client
    )
    if if_complete == "yes" and finish_reason == "finished":
        last_complete = extract_json(last_complete)
        cleaned_response = convert_page_to_int(last_complete["table_of_contents"])
        return cleaned_response

    last_complete = get_json_content(last_complete)
    while not (if_complete == "yes" and finish_reason == "finished"):
        position = last_complete.rfind("}")
        if position != -1:
            last_complete = last_complete[: position + 2]
        prompt = f"""
        Your task is to continue the table of contents json structure, directly output the remaining part of the json structure.
        The response should be in the following JSON format:

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


def _calculate_toc_confidence(content: str) -> float:
    """
    使用规则计算页面是目录页的置信度 (0-1)

    规则包括：
    1. 目录关键词匹配
    2. 章节列表结构（多行标题）
    3. 页码模式
    4. 典型目录特征
    """
    if not content or not content.strip():
        return 0.0

    content_lower = content.lower()
    confidence = 0.0

    # 1. 目录关键词检测（权重 0.4）
    toc_keywords = [
        "目录", "contents", "content", "table of contents",
        "章节", "chapter", "chapters", "索引", "目　录"
    ]
    keyword_found = any(keyword in content_lower for keyword in toc_keywords)
    if keyword_found:
        confidence += 0.4

    # 2. 章节列表结构检测（权重 0.3）
    lines = [line.strip() for line in content.split('\n') if line.strip()]
    if len(lines) >= 5:  # 至少 5 行
        # 检查是否有类似章节标题的行（以数字、字母开头）
        chapter_patterns = sum(
            1 for line in lines
            if line and (line[0].isdigit() or line.split()[0][0].isdigit() if line.split() else False)
        )
        if chapter_patterns >= len(lines) * 0.3:  # 30% 的行有章节特征
            confidence += 0.3

    # 3. 页码模式检测（权重 0.2）
    # 检查是否有多个页码（如 "1", "2", "3" 或 "第1章", "第2章"）
    import re
    page_numbers = re.findall(r'第?\s*\d+\s*章|^\d+\s+', content, re.MULTILINE)
    if len(page_numbers) >= 3:
        confidence += 0.2

    # 4. 点号引导模式（权重 0.1）
    # 检查是否有典型的目录格式，如 "1. xxx", "Chapter 1. xxx"
    dot_pattern = re.findall(r'^\s*[\d一二三四五六七八九十]+[.、．]\s*\w+', content, re.MULTILINE)
    if len(dot_pattern) >= 3:
        confidence += 0.1

    return min(confidence, 1.0)


async def find_toc_pages(start_page_index=0, page_list=None, opt=None, llm_client=None, logger=None):
    """
    优化版目录检测：先使用规则快速过滤，只在必要时使用 LLM

    性能优化：
    - 高置信度 (>0.7): 直接使用规则结果
    - 中等置信度 (0.3-0.7): 使用 LLM 确认
    - 低置信度 (<0.3): 跳过
    """
    if page_list is None:
        raise ValueError("page_list cannot be None")

    print("start find_toc_pages (rule-based + LLM fallback)")
    toc_page_list = []
    i = start_page_index
    rule_based_count = 0
    llm_confirm_count = 0

    while i < len(page_list):
        # Only check beyond max_pages if we're still finding TOC pages
        if i >= opt.toc_check_page_num and not toc_page_list:
            break

        content = page_list[i][0]

        # 步骤 1: 使用规则计算置信度
        confidence = _calculate_toc_confidence(content)

        # 步骤 2: 根据置信度决定是否使用 LLM
        is_toc_page = False

        if confidence >= 0.7:  # 高置信度：直接使用规则结果
            is_toc_page = True
            rule_based_count += 1
            if logger:
                logger.info(f"Page {i}: TOC detected (rule-based, confidence={confidence:.2f})")
        elif confidence >= 0.3:  # 中等置信度：使用 LLM 确认
            detected_result = await toc_detector_single_page(
                content=content,
                llm_client=llm_client,
            )
            is_toc_page = (detected_result == "yes")
            llm_confirm_count += 1
            if logger:
                logger.info(f"Page {i}: TOC {'found' if is_toc_page else 'not found'} (LLM confirmed, confidence={confidence:.2f})")
        else:  # 低置信度：不是目录页
            if logger:
                logger.debug(f"Page {i}: Not a TOC page (confidence={confidence:.2f})")
            # 如果已经找到过目录页，说明目录结束了
            if toc_page_list:
                break
            i += 1
            continue

        if is_toc_page:
            toc_page_list.append(i)
        elif toc_page_list:  # 之前找到过目录，现在不是了，说明目录结束
            if logger:
                logger.info(f"Found the last TOC page: {i - 1}")
            break

        i += 1

    if not toc_page_list and logger:
        logger.info("No toc found")

    if logger:
        logger.info(f"TOC detection summary: {rule_based_count} rule-based, {llm_confirm_count} LLM-confirmed, {len(toc_page_list)} TOC pages found")

    return toc_page_list


def remove_page_number(data):
    if isinstance(data, dict):
        data.pop("page_number", None)
        for key in list(data.keys()):
            if "nodes" in key:
                remove_page_number(data[key])
    elif isinstance(data, list):
        for item in data:
            remove_page_number(item)
    return data


def extract_matching_page_pairs(toc_page, toc_physical_index, start_page_index):
    pairs = []
    for phy_item in toc_physical_index:
        for page_item in toc_page:
            if phy_item.get("title") == page_item.get("title"):
                physical_index = phy_item.get("physical_index")
                if (
                    physical_index is not None
                    and int(physical_index) >= start_page_index
                ):
                    pairs.append(
                        {
                            "title": phy_item.get("title"),
                            "page": page_item.get("page"),
                            "physical_index": physical_index,
                        }
                    )
    return pairs


def calculate_page_offset(pairs):
    differences = []
    for pair in pairs:
        try:
            physical_index = pair["physical_index"]
            page_number = pair["page"]
            difference = physical_index - page_number
            differences.append(difference)
        except (KeyError, TypeError):
            continue

    if not differences:
        return None

    difference_counts = {}
    for diff in differences:
        difference_counts[diff] = difference_counts.get(diff, 0) + 1

    most_common = max(difference_counts.items(), key=lambda x: x[1])[0]

    return most_common


def add_page_offset_to_toc_json(data, offset):
    for i in range(len(data)):
        if data[i].get("page") is not None and isinstance(data[i]["page"], int):
            data[i]["physical_index"] = data[i]["page"] + offset
            del data[i]["page"]

    return data


def page_list_to_group_text(
    page_contents, token_lengths, max_tokens=None, overlap_page=None
):
    """
    将页面内容按 token 数量分组

    将大量页面内容分成适合 LLM 处理的小组，避免超过 token 限制。

    参数:
        page_contents: 页面内容列表
        token_lengths: 每页的 token 数量列表
        max_tokens: 每组最大 token 数 (可选，默认从配置读取)
        overlap_page: 组与组之间的重叠页数 (可选，默认从配置读取)

    返回:
        分组后的文本列表

    配置读取:
        - max_tokens: 从 config.page_group_max_tokens 读取，默认 20000
        - overlap_page: 从 config.page_group_overlap_pages 读取，默认 1

    使用示例:
        >>> groups = page_list_to_group_text(pages, tokens)
        >>> print(f"分成 {len(groups)} 组")
    """
    # ============================================================
    # 从配置读取默认值
    # ============================================================
    if max_tokens is None:
        try:
            from .core.config import load_config
            config = load_config()
            max_tokens = getattr(config, "page_group_max_tokens", 20000)
        except Exception:
            max_tokens = 20000

    if overlap_page is None:
        try:
            from .core.config import load_config
            config = load_config()
            overlap_page = getattr(config, "page_group_overlap_pages", 1)
        except Exception:
            overlap_page = 1

    num_tokens = sum(token_lengths)

    if num_tokens <= max_tokens:
        # merge all pages into one text
        page_text = "".join(page_contents)
        return [page_text]

    subsets = []
    current_subset = []
    current_token_count = 0

    expected_parts_num = math.ceil(num_tokens / max_tokens)
    average_tokens_per_part = math.ceil(
        ((num_tokens / expected_parts_num) + max_tokens) / 2
    )

    for i, (page_content, page_tokens) in enumerate(zip(page_contents, token_lengths)):
        if current_token_count + page_tokens > average_tokens_per_part:
            subsets.append("".join(current_subset))
            # Start new subset from overlap if specified
            overlap_start = max(i - overlap_page, 0)
            current_subset = page_contents[overlap_start:i]
            current_token_count = sum(token_lengths[overlap_start:i])

        # Add current page to the subset
        current_subset.append(page_content)
        current_token_count += page_tokens

    # Add the last subset if it contains any pages
    if current_subset:
        subsets.append("".join(current_subset))

    print("divide page_list to groups", len(subsets))
    return subsets


async def add_page_number_to_toc(part, structure, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for add_page_number_to_toc")

    fill_prompt_seq = """
    You are given an JSON structure of a document and a partial part of the document. Your task is to check if the title that is described in the structure is started in the partial given document.

    The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

    If the full target section starts in the partial given document, insert the given JSON structure with the "start": "yes", and "start_index": "<physical_index_X>".

    If the full target section does not start in the partial given document, insert "start": "no",  "start_index": None.

    The response should be in the following format.
        [
            {
                "structure": <structure index, "x.x.x" or None> (string),
                "title": <title of the section>,
                "start": "<yes or no>",
                "physical_index": "<physical_index_X> (keep the format)" or None
            },
            ...
        ]
    The given structure contains the result of the previous part, you need to fill the result of the current part, do not change the previous result.
    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        fill_prompt_seq
        + f"\n\nCurrent Partial Document:\n{part}\n\nGiven Structure\n{json.dumps(structure, indent=2)}\n"
    )
    # 添加上下文信息
    current_json_raw = await llm_client.chat_async(prompt, context="目录阶段-页码修复")
    json_result = extract_json(current_json_raw)

    for item in json_result:
        if "start" in item:
            del item["start"]
    return json_result


def remove_first_physical_index_section(text):
    """
    Removes the first section between <physical_index_X> and <physical_index_X> tags,
    and returns the remaining text.
    """
    pattern = r"<physical_index_\d+>.*?<physical_index_\d+>"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        # Remove the first matched section
        return text.replace(match.group(0), "", 1)
    return text


### add verify completeness
async def generate_toc_continue(toc_content, part, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for generate_toc_continue")

    print("start generate_toc_continue")
    prompt = """
    You are an expert in extracting hierarchical tree structure from documents.
    You are given the previous tree structure and need to continue it for the current document part.

    # Structure Continuation Rules (结构延续规则)

    1. **Maintain hierarchy consistency** - Continue the structure numbering from the previous part
   - If previous ends at "1.2", next can be "1.3" (same level) or "2" (new main section)
   - If previous ends at "1.2.1", next can be "1.2.2" or "1.3" or "2"

2. **Detect new sections** - Identify new main sections (level 1)
   - Look for patterns like: "第二章", "2. XXX", "第二篇"
   - Start new structure number when major section begins

3. **Detect subsections** - Identify nested sections
   - Look for increased indentation or smaller headings
   - Assign appropriate sub-number (e.g., 1.1, 1.1.1)

# Chinese Document Continuation Patterns (中文文档延续模式)

## Academic Papers
- After "第一章 绪论" → "第二章 相关工作" (structure: "2")
- After "1.1 研究背景" → "1.2 研究意义" (structure: "1.2")
- After "1.2.1 方法" → "1.2.2 实验" (structure: "1.2.2")

## Technical Documents
- After "概述" → "安装指南" (structure: "2")
- After "1. 概述" → "1.1 系统要求" → "1.2 安装步骤"

## Books
- After "第一篇" → "第二篇" (structure: "2")
- After "第一章" → "第二章" (structure: "2" or "1.1" depending on context)

# Title Extraction (标题提取)

- **Keep original**: Extract title exactly as it appears
- **Fix spacing**: Normalize multiple spaces to single
- **Include numbering**: Preserve "第一章", "1.1", etc. in title
- **Skip non-sections**: Ignore 摘要, 参考文献, etc.

# Physical Index (物理索引)

Extract the `<physical_index_X>` tag where each section starts in the current text.

# Output Format

Return ONLY the NEW sections from the current part (do not repeat previous sections):
[
    {{
        "structure": <continue the numbering, e.g., "1.3" or "2"> (string),
        "title": <exact title from current text> (string),
        "physical_index": "<physical_index_X> from current text> (string)
    }},
    ...
]

Directly return the final JSON structure for the NEW sections only. Do not output anything else."""

    prompt = (
        prompt
        + "\nGiven text\n:"
        + part
        + "\nPrevious tree structure\n:"
        + json.dumps(toc_content, indent=2)
    )
    # 添加上下文信息
    response, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt, context="目录阶段-续接生成")
    if finish_reason == "finished":
        return extract_json(response)
    else:
        raise Exception(f"finish reason: {finish_reason}")


### add verify completeness
async def generate_toc_init(part, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for generate_toc_init")

    print("start generate_toc_init")

    # 计算文本长度并添加到日志
    part_length = len(part)
    estimated_pages = part_length // 2000  # 粗略估算页数

    prompt = f"""
    You are an expert in extracting hierarchical tree structure from documents.
    Your task is to generate the table of contents structure by identifying section titles and their hierarchy.

    # Structure Index System (结构索引系统)

    The structure field uses dot-separated numbers to represent hierarchy:
- Level 1: "1", "2", "3" (main sections)
- Level 2: "1.1", "1.2", "2.1" (subsections)
- Level 3: "1.1.1", "1.1.2" (sub-subsections)

# Chinese Document Patterns (中文文档模式)

## Common Section Title Patterns (常见章节标题模式)

### Academic Papers (学术论文)
- 绪论 / 引言 / 第一章 绪论
- 文献综述 /相关工作 / 第二章 文献综述
- 研究方法 / 第三章 方法
- 实验设计 / 第四章 实验
- 结果与分析 / 第五章 结果
- 结论 / 第六章 结论
- 参考文献 / 致谢

### Technical Documents (技术文档)
- 概述 / 简介
- 快速开始 / 安装指南
- 详细说明 / 使用指南
- API 参考 / 配置说明
- 常见问题 / 故障排除

### Books (书籍)
- 第一篇 / 第二篇 (parts)
- 第一章 / 第二章 (chapters)
- 第一节 / 第二节 (sections)

## Title Extraction Rules (标题提取规则)

1. **Keep original title** - Extract exactly as it appears in the document
2. **Fix spacing only** - Normalize multiple spaces to single space
3. **Include numbering** - Keep "第一章", "1.1", etc. in the title
4. **Skip non-sections** - Ignore: 摘要, Abstract, 参考文献, 目录, etc.

## Physical Index Tags (物理索引标签)

The text contains tags marking page boundaries:
- `<physical_index_5>` marks the start of page 5
- `<physical_index_10>` marks the start of page 10

Extract the physical_index where each section actually starts.

## Response Format

Return a JSON array of sections:
[
    {{
        "structure": <hierarchy index like "1" or "1.1.1"> (string),
        "title": <exact title from document, preserve spacing> (string),
        "physical_index": "<physical_index_X> where section starts> (string)
    }},
    ...
]

Directly return the final JSON structure. Do not output anything else."""

    prompt = prompt + "\nGiven text\n:" + part

    # 添加上下文信息：显示文本大小和估算页数
    context = f"目录阶段-初始生成(文本{part_length}字符,约{estimated_pages}页)"
    response, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt, context=context)

    if finish_reason == "finished":
        return extract_json(response)
    else:
        raise Exception(f"finish reason: {finish_reason}")


async def process_no_toc(page_list, start_index=1, llm_client=None, logger=None):
    if llm_client is None:
        raise ValueError("llm_client is required for process_no_toc")

    page_contents = []
    token_lengths = []
    for page_index in range(start_index, start_index + len(page_list)):
        page_text = f"<physical_index_{page_index}>\n{page_list[page_index - start_index][0]}\n<physical_index_{page_index}>\n\n"
        page_contents.append(page_text)
        token_lengths.append(count_tokens(page_text, llm_client.model))
    group_texts = page_list_to_group_text(page_contents, token_lengths)
    logger.info(f"len(group_texts): {len(group_texts)}")

    toc_with_page_number = await generate_toc_init(group_texts[0], llm_client)
    for group_text in group_texts[1:]:
        toc_with_page_number_additional = await generate_toc_continue(
            toc_with_page_number, group_text, llm_client
        )
        toc_with_page_number.extend(toc_with_page_number_additional)
    logger.info(f"generate_toc: {toc_with_page_number}")

    toc_with_page_number = convert_physical_index_to_int(toc_with_page_number)
    logger.info(f"convert_physical_index_to_int: {toc_with_page_number}")

    return toc_with_page_number


async def process_toc_no_page_numbers(
    toc_content, toc_page_list, page_list, start_index=1, llm_client=None, logger=None
):
    if llm_client is None:
        raise ValueError("llm_client is required for process_toc_no_page_numbers")

    page_contents = []
    token_lengths = []
    toc_content = await toc_transformer(toc_content, llm_client)
    logger.info(f"toc_transformer: {toc_content}")
    for page_index in range(start_index, start_index + len(page_list)):
        page_text = f"<physical_index_{page_index}>\n{page_list[page_index - start_index][0]}\n<physical_index_{page_index}>\n\n"
        page_contents.append(page_text)
        token_lengths.append(count_tokens(page_text, llm_client.model))

    group_texts = page_list_to_group_text(page_contents, token_lengths)
    logger.info(f"len(group_texts): {len(group_texts)}")

    toc_with_page_number = copy.deepcopy(toc_content)
    for group_text in group_texts:
        toc_with_page_number = await add_page_number_to_toc(
            group_text, toc_with_page_number, llm_client
        )
    logger.info(f"add_page_number_to_toc: {toc_with_page_number}")

    toc_with_page_number = convert_physical_index_to_int(toc_with_page_number)
    logger.info(f"convert_physical_index_to_int: {toc_with_page_number}")

    return toc_with_page_number


async def process_toc_with_page_numbers(
    toc_content,
    toc_page_list,
    page_list,
    toc_check_page_num=None,
    llm_client=None,
    logger=None,
):
    if llm_client is None:
        raise ValueError("llm_client is required for process_toc_with_page_numbers")

    # 从配置文件读取默认 toc_check_page_num
    if toc_check_page_num is None:
        try:
            from .core.config import load_config
            config = load_config()
            toc_check_page_num = getattr(config, "toc_check_page_num", 20)
        except Exception:
            toc_check_page_num = 20

    toc_with_page_number = await toc_transformer(toc_content, llm_client)
    logger.info(f"toc_with_page_number: {toc_with_page_number}")

    toc_no_page_number = remove_page_number(copy.deepcopy(toc_with_page_number))

    start_page_index = toc_page_list[-1] + 1
    main_content = ""
    for page_index in range(
        start_page_index, min(start_page_index + toc_check_page_num, len(page_list))
    ):
        main_content += f"<physical_index_{page_index + 1}>\n{page_list[page_index][0]}\n<physical_index_{page_index + 1}>\n\n"

    toc_with_physical_index = await toc_index_extractor(
        toc_no_page_number, main_content, llm_client
    )
    logger.info(f"toc_with_physical_index: {toc_with_physical_index}")

    toc_with_physical_index = convert_physical_index_to_int(toc_with_physical_index)
    logger.info(f"toc_with_physical_index: {toc_with_physical_index}")

    matching_pairs = extract_matching_page_pairs(
        toc_with_page_number, toc_with_physical_index, start_page_index
    )
    logger.info(f"matching_pairs: {matching_pairs}")

    offset = calculate_page_offset(matching_pairs)
    logger.info(f"offset: {offset}")

    toc_with_page_number = add_page_offset_to_toc_json(toc_with_page_number, offset)
    logger.info(f"toc_with_page_number: {toc_with_page_number}")

    toc_with_page_number = await process_none_page_numbers(
        toc_with_page_number, page_list, llm_client=llm_client
    )
    logger.info(f"toc_with_page_number: {toc_with_page_number}")

    return toc_with_page_number


##check if needed to process none page numbers
async def process_none_page_numbers(toc_items, page_list, start_index=1, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for process_none_page_numbers")

    for i, item in enumerate(toc_items):
        if "physical_index" not in item:
            # logger.info(f"fix item: {item}")
            # Find previous physical_index
            prev_physical_index = 0  # Default if no previous item exists
            for j in range(i - 1, -1, -1):
                if toc_items[j].get("physical_index") is not None:
                    prev_physical_index = toc_items[j]["physical_index"]
                    break

            # Find next physical_index
            next_physical_index = -1  # Default if no next item exists
            for j in range(i + 1, len(toc_items)):
                if toc_items[j].get("physical_index") is not None:
                    next_physical_index = toc_items[j]["physical_index"]
                    break

            page_contents = []
            for page_index in range(prev_physical_index, next_physical_index + 1):
                # Add bounds checking to prevent IndexError
                list_index = page_index - start_index
                if list_index >= 0 and list_index < len(page_list):
                    page_text = f"<physical_index_{page_index}>\n{page_list[list_index][0]}\n<physical_index_{page_index}>\n\n"
                    page_contents.append(page_text)
                else:
                    continue

            item_copy = copy.deepcopy(item)
            del item_copy["page"]
            result = await add_page_number_to_toc(page_contents, item_copy, llm_client)
            if isinstance(result[0]["physical_index"], str) and result[0][
                "physical_index"
            ].startswith("<physical_index"):
                item["physical_index"] = int(
                    result[0]["physical_index"].split("_")[-1].rstrip(">").strip()
                )
                del item["page"]

    return toc_items


async def check_toc(page_list, opt=None, llm_client=None):
    toc_page_list = await find_toc_pages(start_page_index=0, page_list=page_list, opt=opt, llm_client=llm_client)
    if len(toc_page_list) == 0:
        print("no toc found")
        return {
            "toc_content": None,
            "toc_page_list": [],
            "page_index_given_in_toc": "no",
        }
    else:
        print("toc found")
        toc_json = await toc_extractor(page_list, toc_page_list, llm_client)

        if toc_json["page_index_given_in_toc"] == "yes":
            print("index found")
            return {
                "toc_content": toc_json["toc_content"],
                "toc_page_list": toc_page_list,
                "page_index_given_in_toc": "yes",
            }
        else:
            current_start_index = toc_page_list[-1] + 1

            while (
                toc_json["page_index_given_in_toc"] == "no"
                and current_start_index < len(page_list)
                and current_start_index < opt.toc_check_page_num
            ):
                additional_toc_pages = await find_toc_pages(
                    start_page_index=current_start_index, page_list=page_list, opt=opt, llm_client=llm_client
                )

                if len(additional_toc_pages) == 0:
                    break

                additional_toc_json = await toc_extractor(
                    page_list, additional_toc_pages, llm_client
                )
                if additional_toc_json["page_index_given_in_toc"] == "yes":
                    print("index found")
                    return {
                        "toc_content": additional_toc_json["toc_content"],
                        "toc_page_list": additional_toc_pages,
                        "page_index_given_in_toc": "yes",
                    }

                else:
                    current_start_index = additional_toc_pages[-1] + 1
            print("index not found")
            return {
                "toc_content": toc_json["toc_content"],
                "toc_page_list": toc_page_list,
                "page_index_given_in_toc": "no",
            }


################### fix incorrect toc #########################################################
async def single_toc_item_index_fixer(section_title, content, llm_client=None):
    if llm_client is None:
        raise ValueError("llm_client is required for single_toc_item_index_fixer")

    tob_extractor_prompt = """
    You are given a section title and several pages of a document, your job is to find the physical index of the start page of the section in the partial document.

    The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

    Reply in a JSON format:
    {
        "thinking": <explain which page, started and closed by <physical_index_X>, contains the start of this section>,
        "physical_index": "<physical_index_X>" (keep the format)
    }
    Directly return the final JSON structure. Do not output anything else."""

    prompt = (
        tob_extractor_prompt
        + "\nSection Title:\n"
        + str(section_title)
        + "\nDocument pages:\n"
        + content
    )
    response = await llm_client.chat_async(prompt)
    json_content = extract_json(response)
    return convert_physical_index_to_int(json_content["physical_index"])


async def fix_incorrect_toc(
    toc_with_page_number,
    page_list,
    incorrect_results,
    start_index=1,
    llm_client=None,
    logger=None,
):
    print(f"start fix_incorrect_toc with {len(incorrect_results)} incorrect results")
    incorrect_indices = {result["list_index"] for result in incorrect_results}

    end_index = len(page_list) + start_index - 1

    incorrect_results_and_range_logs = []

    # Helper function to process and check a single incorrect item
    async def process_and_check_item(incorrect_item):
        list_index = incorrect_item["list_index"]

        # Check if list_index is valid
        if list_index < 0 or list_index >= len(toc_with_page_number):
            # Return an invalid result for out-of-bounds indices
            return {
                "list_index": list_index,
                "title": incorrect_item["title"],
                "physical_index": incorrect_item.get("physical_index"),
                "is_valid": False,
            }

        # Find the previous correct item
        prev_correct = None
        for i in range(list_index - 1, -1, -1):
            if i not in incorrect_indices and i >= 0 and i < len(toc_with_page_number):
                physical_index = toc_with_page_number[i].get("physical_index")
                if physical_index is not None:
                    prev_correct = physical_index
                    break
        # If no previous correct item found, use start_index
        if prev_correct is None:
            prev_correct = start_index - 1

        # Find the next correct item
        next_correct = None
        for i in range(list_index + 1, len(toc_with_page_number)):
            if i not in incorrect_indices and i >= 0 and i < len(toc_with_page_number):
                physical_index = toc_with_page_number[i].get("physical_index")
                if physical_index is not None:
                    next_correct = physical_index
                    break
        # If no next correct item found, use end_index
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

        page_contents = []
        for page_index in range(prev_correct, next_correct + 1):
            # Add bounds checking to prevent IndexError
            list_index = page_index - start_index
            if list_index >= 0 and list_index < len(page_list):
                page_text = f"<physical_index_{page_index}>\n{page_list[list_index][0]}\n<physical_index_{page_index}>\n\n"
                page_contents.append(page_text)
            else:
                continue
        content_range = "".join(page_contents)

        physical_index_int = await single_toc_item_index_fixer(
            incorrect_item["title"], content_range, llm_client
        )

        # Check if the result is correct
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

    # Process incorrect items concurrently
    tasks = [process_and_check_item(item) for item in incorrect_results]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for item, result in zip(incorrect_results, results):
        if isinstance(result, Exception):
            print(f"Processing item {item} generated an exception: {result}")
            continue
    results = [result for result in results if not isinstance(result, Exception)]

    # Update the toc_with_page_number with the fixed indices and check for any invalid results
    invalid_results = []
    for result in results:
        if result["is_valid"]:
            # Add bounds checking to prevent IndexError
            list_idx = result["list_index"]
            if 0 <= list_idx < len(toc_with_page_number):
                toc_with_page_number[list_idx]["physical_index"] = result[
                    "physical_index"
                ]
            else:
                # Index is out of bounds, treat as invalid
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

    logger.info(f"incorrect_results_and_range_logs: {incorrect_results_and_range_logs}")
    logger.info(f"invalid_results: {invalid_results}")

    return toc_with_page_number, invalid_results


async def fix_incorrect_toc_with_retries(
    toc_with_page_number,
    page_list,
    incorrect_results,
    start_index=1,
    max_attempts=3,
    llm_client=None,
    logger=None,
):
    print("start fix_incorrect_toc")
    fix_attempt = 0
    current_toc = toc_with_page_number
    current_incorrect = incorrect_results

    while current_incorrect:
        print(f"Fixing {len(current_incorrect)} incorrect results")

        current_toc, current_incorrect = await fix_incorrect_toc(
            current_toc, page_list, current_incorrect, start_index, llm_client, logger
        )

        fix_attempt += 1
        if fix_attempt >= max_attempts:
            logger.info("Maximum fix attempts reached")
            break

    return current_toc, current_incorrect


################### verify toc #########################################################
async def verify_toc(page_list, list_result, start_index=1, N=None, llm_client=None):
    print("start verify_toc")
    # Find the last non-None physical_index
    last_physical_index = None
    for item in reversed(list_result):
        if item.get("physical_index") is not None:
            last_physical_index = item["physical_index"]
            break

    # Early return if we don't have valid physical indices
    if last_physical_index is None or last_physical_index < len(page_list) / 2:
        return 0, []

    # Determine which items to check
    if N is None:
        print("check all items")
        sample_indices = range(0, len(list_result))
    else:
        N = min(N, len(list_result))
        print(f"check {N} items")
        sample_indices = random.sample(range(0, len(list_result)), N)

    # Prepare items with their list indices
    indexed_sample_list = []
    for idx in sample_indices:
        item = list_result[idx]
        # Skip items with None physical_index (these were invalidated by validate_and_truncate_physical_indices)
        if item.get("physical_index") is not None:
            item_with_index = item.copy()
            item_with_index["list_index"] = idx  # Add the original index in list_result
            indexed_sample_list.append(item_with_index)

    # Run checks concurrently
    tasks = [
        check_title_appearance(item, page_list, start_index, llm_client)
        for item in indexed_sample_list
    ]
    results = await asyncio.gather(*tasks)

    # Process results
    correct_count = 0
    incorrect_results = []
    for result in results:
        if result["answer"] == "yes":
            correct_count += 1
        else:
            incorrect_results.append(result)

    # Calculate accuracy
    checked_count = len(results)
    accuracy = correct_count / checked_count if checked_count > 0 else 0
    print(f"accuracy: {accuracy * 100:.2f}%")
    return accuracy, incorrect_results


################### main process #########################################################
async def meta_processor(
    page_list,
    mode=None,
    toc_content=None,
    toc_page_list=None,
    start_index=1,
    opt=None,
    logger=None,
    llm_client=None,
):
    print(mode)
    print(f"start_index: {start_index}")

    if mode == "process_toc_with_page_numbers":
        toc_with_page_number = await process_toc_with_page_numbers(
            toc_content,
            toc_page_list,
            page_list,
            toc_check_page_num=opt.toc_check_page_num,
            llm_client=llm_client,
            logger=logger,
        )
    elif mode == "process_toc_no_page_numbers":
        toc_with_page_number = await process_toc_no_page_numbers(
            toc_content,
            toc_page_list,
            page_list,
            llm_client=llm_client,
            logger=logger,
        )
    else:
        toc_with_page_number = await process_no_toc(
            page_list,
            start_index=start_index,
            llm_client=llm_client,
            logger=logger,
        )

    toc_with_page_number = [
        item for item in toc_with_page_number if item.get("physical_index") is not None
    ]

    # 如果目录为空，根据 mode 降级到更简单的处理方式
    if len(toc_with_page_number) == 0:
        logger.warning("目录解析为空，将降级到无目录模式")
        if mode == "process_toc_with_page_numbers":
            # 从有页码的目录降级到无页码目录
            return await meta_processor(
                page_list,
                mode="process_toc_no_page_numbers",
                toc_content=toc_content,
                toc_page_list=toc_page_list,
                start_index=start_index,
                opt=opt,
                logger=logger,
                llm_client=llm_client,
            )
        elif mode == "process_toc_no_page_numbers":
            # 从无页码目录降级到完全无目录模式
            return await meta_processor(
                page_list,
                mode="process_no_toc",
                start_index=start_index,
                opt=opt,
                logger=logger,
                llm_client=llm_client,
            )
        else:
            # mode="process_no_toc" 且目录为空，说明 LLM 生成目录失败
            # 返回空数组，让调用者处理
            logger.warning("无目录模式下 LLM 生成目录失败，返回空结构")
            return []

    toc_with_page_number = validate_and_truncate_physical_indices(
        toc_with_page_number, len(page_list), start_index=start_index, logger=logger
    )

    accuracy, incorrect_results = await verify_toc(
        page_list,
        toc_with_page_number,
        start_index=start_index,
        llm_client=llm_client,
    )

    logger.info(
        {
            "mode": "process_toc_with_page_numbers",
            "accuracy": accuracy,
            "incorrect_results": incorrect_results,
        }
    )
    if accuracy == 1.0 and len(incorrect_results) == 0:
        return toc_with_page_number
    if accuracy > 0.6 and len(incorrect_results) > 0:
        toc_with_page_number, incorrect_results = await fix_incorrect_toc_with_retries(
            toc_with_page_number,
            page_list,
            incorrect_results,
            start_index=start_index,
            max_attempts=3,
            llm_client=llm_client,
            logger=logger,
        )
        return toc_with_page_number
    else:
        if mode == "process_toc_with_page_numbers":
            return await meta_processor(
                page_list,
                mode="process_toc_no_page_numbers",
                toc_content=toc_content,
                toc_page_list=toc_page_list,
                start_index=start_index,
                opt=opt,
                logger=logger,
                llm_client=llm_client,
            )
        elif mode == "process_toc_no_page_numbers":
            return await meta_processor(
                page_list,
                mode="process_no_toc",
                start_index=start_index,
                opt=opt,
                logger=logger,
                llm_client=llm_client,
            )
        else:
            raise Exception("Processing failed")


async def process_large_node_recursively(node, page_list, opt=None, logger=None, llm_client=None):
    node_page_list = page_list[node["start_index"] - 1 : node["end_index"]]
    token_num = sum([page[1] for page in node_page_list])

    if (
        node["end_index"] - node["start_index"] > opt.max_page_num_each_node
        and token_num >= opt.max_token_num_each_node
    ):
        print(
            "large node:",
            node["title"],
            "start_index:",
            node["start_index"],
            "end_index:",
            node["end_index"],
            "token_num:",
            token_num,
        )

        node_toc_tree = await meta_processor(
            node_page_list,
            mode="process_no_toc",
            start_index=node["start_index"],
            opt=opt,
            logger=logger,
            llm_client=llm_client,
        )
        node_toc_tree = await check_title_appearance_in_start_concurrent(
            node_toc_tree,
            page_list,
            llm_client=llm_client,
            logger=logger,
        )

        # Filter out items with None physical_index before post_processing
        valid_node_toc_items = [
            item for item in node_toc_tree if item.get("physical_index") is not None
        ]

        if (
            valid_node_toc_items
            and node["title"].strip() == valid_node_toc_items[0]["title"].strip()
        ):
            node["nodes"] = post_processing(valid_node_toc_items[1:], node["end_index"])
            node["end_index"] = (
                valid_node_toc_items[1]["start_index"]
                if len(valid_node_toc_items) > 1
                else node["end_index"]
            )
        else:
            node["nodes"] = post_processing(valid_node_toc_items, node["end_index"])
            node["end_index"] = (
                valid_node_toc_items[0]["start_index"]
                if valid_node_toc_items
                else node["end_index"]
            )

    if "nodes" in node and node["nodes"]:
        tasks = [
            process_large_node_recursively(child_node, page_list, opt, logger=logger, llm_client=llm_client)
            for child_node in node["nodes"]
        ]
        await asyncio.gather(*tasks)

    return node


async def tree_parser(page_list, opt, doc=None, logger=None, llm_client=None):
    check_toc_result = await check_toc(page_list, opt, llm_client=llm_client)
    logger.info(check_toc_result)

    if (
        check_toc_result.get("toc_content")
        and check_toc_result["toc_content"].strip()
        and check_toc_result["page_index_given_in_toc"] == "yes"
    ):
        toc_with_page_number = await meta_processor(
            page_list,
            mode="process_toc_with_page_numbers",
            start_index=1,
            toc_content=check_toc_result["toc_content"],
            toc_page_list=check_toc_result["toc_page_list"],
            opt=opt,
            logger=logger,
            llm_client=llm_client,
        )
    else:
        toc_with_page_number = await meta_processor(
            page_list, mode="process_no_toc", start_index=1, opt=opt, logger=logger, llm_client=llm_client
        )

    toc_with_page_number = add_preface_if_needed(toc_with_page_number)
    toc_with_page_number = await check_title_appearance_in_start_concurrent(
        toc_with_page_number,
        page_list,
        llm_client=llm_client,
        logger=logger,
    )

    # Filter out items with None physical_index before post_processings
    valid_toc_items = [
        item for item in toc_with_page_number if item.get("physical_index") is not None
    ]

    # 如果所有模式都失败，创建一个基本的文档结构
    if len(valid_toc_items) == 0:
        logger.warning("所有目录解析模式均失败，创建基本文档结构")
        # 创建包含整个文档的单个节点
        from .pdf.tokens import count_tokens
        total_tokens = sum([page[1] for page in page_list])
        toc_tree = [{
            "structure": "1",
            "title": "文档内容",
            "start_index": 1,
            "end_index": len(page_list),
            "physical_index": 1,
            "level": 0,
            "tokens": total_tokens,
        }]
    else:
        toc_tree = post_processing(valid_toc_items, len(page_list))
    tasks = [
        process_large_node_recursively(node, page_list, opt, logger=logger, llm_client=llm_client)
        for node in toc_tree
    ]
    await asyncio.gather(*tasks)

    return toc_tree


################### EPUB 支持 #########################################################
def _detect_document_type(file_path: str) -> str:
    """
    检测文档类型

    支持的文档类型:
    - PDF (.pdf)
    - EPUB (.epub)

    参数:
        file_path: 文件路径

    返回:
        "pdf" 或 "epub"

    异常:
        ValueError: 不支持的文件类型

    检测策略:
        1. 优先检查文件扩展名
        2. 备用 magic bytes 检测（防止错误扩展名）
        3. PDF magic bytes: %PDF
        4. EPUB magic bytes: PK (EPUB 是 ZIP 格式)

    使用示例:
        >>> _detect_document_type("document.pdf")
        'pdf'
        >>> _detect_document_type("book.epub")
        'epub'
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    # 优先检查扩展名
    if ext == ".pdf":
        return "pdf"
    elif ext == ".epub":
        return "epub"

    # magic bytes 检测（防止错误扩展名）
    try:
        with open(file_path, "rb") as f:
            header = f.read(4)

            if header[:4] == b"%PDF":
                return "pdf"
            elif header[:2] == b"PK":  # EPUB 是 ZIP 格式
                return "epub"
    except Exception as e:
        print(f"[索引] 警告: 无法读取文件: {e}")

    raise ValueError(f"无法识别的文档类型: {file_path}")


def _process_epub(
    file_path: str,
    config=None
) -> Dict[str, Any]:
    """
    处理 EPUB 文件

    解析 EPUB 文件并转换为 PageIndex tree_structure 格式。

    参数:
        file_path: EPUB 文件路径
        config: 配置字典，可选字段:
            - use_llm: 是否生成摘要 (bool)
            - llm_client: LLM 客户端

    返回:
        PageIndex tree_structure 格式的字典，包含:
        - title: 书籍标题
        - structure: 树结构列表
        - (可选) doc_description: 文档描述

    异常:
        Exception: EPUB 解析失败

    处理流程:
        1. 使用 EpubParser 解析 EPUB
        2. 使用 epub_to_tree 转换为树结构
        3. (可选) 使用 _generate_summaries 生成摘要

    使用示例:
        >>> tree = _process_epub("book.epub")
        >>> print(tree["title"])
        >>> for node in tree["structure"]:
        ...     print(f"{node['node_id']}: {node['title']}")
    """
    from .epub_parser import EpubParser
    from .epub_to_tree import epub_to_tree

    print(f"[索引] 开始处理 EPUB: {file_path}")

    # 1. 解析 EPUB
    parser = EpubParser(file_path)
    parser.load()

    epub_data = {
        "metadata": parser.get_metadata(),
        "toc": parser.get_toc(),
        "chapters": parser.get_chapters(),
    }

    # 2. 转换为树结构
    tree = epub_to_tree(epub_data, assign_node_ids=True)
    print(f"[索引] EPUB 树结构转换完成，节点数: {_count_nodes(tree)}")

    # 3. 可选：生成摘要
    if config and config.get("use_llm"):
        from .utils import generate_summaries_for_structure

        # 需要异步运行
        async def add_summaries():
            llm_client = config.get("llm_client")
            if llm_client is None:
                print("[索引] 未提供 llm_client，跳过摘要生成")
                return tree
            await generate_summaries_for_structure(tree, llm_client=llm_client)
            print("[索引] EPUB 摘要生成完成")
            return tree

        # 如果在事件循环中，使用 nest_asyncio
        try:
            loop = asyncio.get_running_loop()
            import nest_asyncio
            nest_asyncio.apply()
            tree = loop.run_until_complete(add_summaries())
        except RuntimeError:
            tree = asyncio.run(add_summaries())

    print("[索引] EPUB 处理完成")

    return tree


def _count_nodes(tree: Dict[str, Any]) -> int:
    """
    计算树结构中的节点总数

    参数:
        tree: PageIndex tree_structure

    返回:
        节点总数（包括嵌套节点）
    """
    def count_recursive(nodes):
        count = 0
        for node in nodes:
            count += 1
            if "nodes" in node and node["nodes"]:
                count += count_recursive(node["nodes"])
        return count

    return count_recursive(tree.get("structure", []))


def save_result(result: dict, pdf_path: str) -> str:
    """
    保存最终索引结果到 results/ 目录

    参数:
        result: 索引结果字典，包含 doc_name 和 structure
        pdf_path: 原始 PDF 文件路径

    返回:
        保存的结果文件路径
    """
    from datetime import datetime

    # 确保 results 目录存在
    os.makedirs("results", exist_ok=True)

    # 生成结果文件名
    pdf_name = result.get("doc_name", get_pdf_name(pdf_path))
    current_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    result_filename = f"{pdf_name}_{current_time}.json"
    result_filepath = os.path.join("results", result_filename)

    # 保存结果
    with open(result_filepath, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"索引结果已保存到: {result_filepath}")
    return result_filepath


def page_index_main(doc, opt=None, llm_client=None):
    """
    主入口：生成文档索引

    支持 PDF 和 EPUB 文档。

    参数:
        doc: 文档文件路径（.pdf 或 .epub）
        opt: 配置对象
        llm_client: LLM 客户端（可选）

    返回:
        包含 doc_name 和 structure 的字典

    异常:
        ValueError: 不支持的文档类型
    """
    # 强制输出调试信息 - 使用 logging
    import logging
    logging.basicConfig(level=logging.DEBUG, force=True)
    logging.debug("[DEBUG] page_index_main called")
    logging.debug(f"[DEBUG] doc={doc}, opt={opt is not None}, llm_client={llm_client is not None}")

    logger = JsonLogger(doc)

    # 检查是否是 EPUB 文件
    is_epub = isinstance(doc, str) and os.path.isfile(doc) and doc.lower().endswith(".epub")
    is_pdf = (
        isinstance(doc, str) and os.path.isfile(doc) and doc.lower().endswith(".pdf")
    ) or isinstance(doc, BytesIO)

    if not is_pdf and not is_epub:
        raise ValueError(
            "Unsupported input type. Expected a PDF/EPUB file path or PDF BytesIO object."
        )

    # 如果是 EPUB，使用专门的 EPUB 处理流程
    if is_epub:
        logging.debug("[DEBUG] Processing EPUB file")
        logger.info(f"[索引] 检测到 EPUB 文档: {doc}")

        # 准备配置
        config = {
            "use_llm": (opt.if_add_node_summary if opt else False) and (opt.if_add_node_summary == "yes" if isinstance(opt.if_add_node_summary, str) else opt.if_add_node_summary),
            "llm_client": llm_client,
        }

        try:
            # 处理 EPUB
            tree = _process_epub(doc, config)

            # 添加文档名称
            doc_name = os.path.basename(doc)
            result = {
                "doc_name": doc_name,
                "structure": tree["structure"],
            }

            # 可选：添加文档描述
            if hasattr(opt, 'if_add_doc_description') and opt.if_add_doc_description:
                from .utils import generate_doc_description, create_clean_structure_for_description

                logger.info("[PageIndex] 生成文档描述")
                clean_structure = create_clean_structure_for_description(tree["structure"])
                doc_description = generate_doc_description(clean_structure, llm_client=llm_client)
                result["doc_description"] = doc_description

            # 保存结果
            save_result(result, doc)

            return result

        except Exception as e:
            logger.error(f"[索引] EPUB 处理失败: {e}")
            raise

    # 如果是 PDF，继续原有的处理流程
    logging.debug("[DEBUG] Processing PDF file")
    is_valid_pdf = is_pdf
    if not is_valid_pdf:
        raise ValueError(
            "Unsupported input type. Expected a PDF file path or BytesIO object."
        )

    logging.debug("[DEBUG] About to call get_page_tokens")
    print("Parsing PDF...")
    page_list = get_page_tokens(doc)
    logging.debug(f"[DEBUG] get_page_tokens returned {len(page_list)} pages")

    logger.info({"total_page_number": len(page_list)})
    logger.info({"total_token": sum([page[1] for page in page_list])})

    async def page_index_builder():
        logging.debug("[DEBUG] page_index_builder async function started")
        # 解析 PDF 结构
        logging.debug("[DEBUG] About to call tree_parser")
        structure = await tree_parser(page_list, opt, doc=doc, logger=logger, llm_client=llm_client)
        logging.debug(f"[DEBUG] tree_parser returned, structure length: {len(structure) if structure else 0}")

        if not structure:
            logger.error("[PageIndex] structure 为空")
            return {"doc_name": get_pdf_name(doc), "structure": []}

        # 将配置转换为布尔值
        add_node_id = (opt.if_add_node_id if isinstance(opt.if_add_node_id, bool)
                       else opt.if_add_node_id == "yes")
        add_node_text_config = (opt.if_add_node_text if isinstance(opt.if_add_node_text, bool)
                               else opt.if_add_node_text == "yes")
        add_node_summary_config = (opt.if_add_node_summary if isinstance(opt.if_add_node_summary, bool)
                                  else opt.if_add_node_summary == "yes")

        logger.info(f"[PageIndex] 配置: add_node_id={add_node_id}, add_node_text={add_node_text_config}, add_node_summary={add_node_summary_config}")

        # 步骤 1: 添加节点 ID
        if add_node_id:
            write_node_id(structure)
            logger.info("[PageIndex] ✓ 节点 ID 已添加")

        # 步骤 2 & 3: 处理文本和摘要
        # 确定是否需要保留文本
        keep_text = add_node_text_config

        # 如果需要摘要但没有文本，临时添加文本用于摘要生成
        if add_node_summary_config and not add_node_text_config:
            logger.info("[PageIndex] 临时添加文本用于摘要生成（带物理页码标记）")
            add_node_text_with_labels(structure, page_list)

        # 添加文本（如果需要）
        if add_node_text_config:
            logger.info("[PageIndex] 添加带物理页码标记的文本")
            add_node_text_with_labels(structure, page_list)
            logger.info("[PageIndex] ✓ 节点文本已添加（含 <physical_index_N> 标记）")

        # 生成摘要
        if add_node_summary_config:
            logger.info(f"[PageIndex] 开始生成摘要 (llm_client={'None' if llm_client is None else 'available'})")
            await generate_summaries_for_structure(structure, llm_client=llm_client)
            logger.info("[PageIndex] ✓ 摘要生成完成")

            # 验证摘要是否添加成功
            first_node = structure[0] if structure else None
            if first_node and "summary" not in first_node:
                logger.warning(f"[PageIndex] ⚠ 第一个节点缺少 summary 字段，现有键: {list(first_node.keys())}")

        # 重要变更：不再移除 text 字段
        # 原始文本(text)和摘要(summary)应该同时保留
        # text: 原始 PDF 文本
        # summary: LLM 生成的摘要

        # 检查 doc_description 选项
        add_doc_description = (opt.if_add_doc_description if hasattr(opt, 'if_add_doc_description') and isinstance(opt.if_add_doc_description, bool)
                             else (hasattr(opt, 'if_add_doc_description') and opt.if_add_doc_description == "yes"))

        if add_doc_description:
            logger.info("[PageIndex] 生成文档描述")
            clean_structure = create_clean_structure_for_description(structure)
            doc_description = generate_doc_description(clean_structure, llm_client=llm_client)
            return {
                "doc_name": get_pdf_name(doc),
                "doc_description": doc_description,
                "structure": structure,
            }

        return {
            "doc_name": get_pdf_name(doc),
            "structure": structure,
        }

    try:
        # 检查是否已有运行中的事件循环
        logging.debug("[DEBUG] Checking for running loop...")
        loop = asyncio.get_running_loop()
        logging.debug(f"[DEBUG] Found running loop: {loop}")
        # 如果已有事件循环，使用 nest_asyncio 来允许嵌套调用
        import nest_asyncio
        nest_asyncio.apply()
        logging.debug("[DEBUG] Applied nest_asyncio")
        result = loop.run_until_complete(page_index_builder())
        logging.debug("[DEBUG] run_until_complete returned")
    except RuntimeError:
        # 没有运行中的事件循环（如在子线程中），使用 asyncio.run()
        logging.debug("[DEBUG] No running loop, using asyncio.run()")
        result = asyncio.run(page_index_builder())
        logging.debug("[DEBUG] asyncio.run returned")

    # 保存最终结果到 results/ 目录
    save_result(result, doc)

    return result


def page_index(
    doc,
    model=None,
    toc_check_page_num=None,
    max_page_num_each_node=None,
    max_token_num_each_node=None,
    if_add_node_id=None,
    if_add_node_summary=None,
    if_add_doc_description=None,
    if_add_node_text=None,
):
    user_opt = {
        arg: value
        for arg, value in locals().items()
        if arg != "doc" and value is not None
    }
    opt = ConfigLoader().load(user_opt)
    return page_index_main(doc, opt)


def validate_and_truncate_physical_indices(
    toc_with_page_number, page_list_length, start_index=1, logger=None
):
    """
    Validates and truncates physical indices that exceed the actual document length.
    This prevents errors when TOC references pages that don't exist in the document (e.g. the file is broken or incomplete).
    """
    if not toc_with_page_number:
        return toc_with_page_number

    max_allowed_page = page_list_length + start_index - 1
    truncated_items = []

    for i, item in enumerate(toc_with_page_number):
        if item.get("physical_index") is not None:
            original_index = item["physical_index"]
            if original_index > max_allowed_page:
                item["physical_index"] = None
                truncated_items.append(
                    {
                        "title": item.get("title", "Unknown"),
                        "original_index": original_index,
                    }
                )
                if logger:
                    logger.info(
                        f"Removed physical_index for '{item.get('title', 'Unknown')}' (was {original_index}, too far beyond document)"
                    )

    if truncated_items and logger:
        logger.info(f"Total removed items: {len(truncated_items)}")

    print(
        f"Document validation: {page_list_length} pages, max allowed index: {max_allowed_page}"
    )
    if truncated_items:
        print(
            f"Truncated {len(truncated_items)} TOC items that exceeded document length"
        )

    return toc_with_page_number
