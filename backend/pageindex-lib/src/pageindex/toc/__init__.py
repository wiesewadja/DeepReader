"""
PageIndex 目录处理模块

本模块提供 PDF 目录 (Table of Contents) 的检测、解析、验证和修复功能。

主要组件:
    - detector: 目录检测 (find_toc_pages, _calculate_toc_confidence)
    - parser: 目录解析 (toc_transformer, toc_extractor, toc_index_extractor)
    - validator: 目录验证 (verify_toc, check_title_appearance)
    - fixer: 目录修复 (fix_incorrect_toc_with_retries, single_toc_item_index_fixer)

处理流程:
    1. 检测目录页 (detector)
    2. 提取目录内容 (parser)
    3. 转换为 JSON 结构 (parser)
    4. 验证准确性 (validator)
    5. 修复错误 (fixer)

三种处理模式:
    1. process_toc_with_page_numbers: 目录包含页码
    2. process_toc_no_page_numbers: 目录不含页码
    3. process_no_toc: 无目录，LLM 生成

使用示例:
    >>> from pageindex.toc import find_toc_pages, toc_transformer, verify_toc
    >>>
    >>> # 检测目录页
    >>> toc_pages = await find_toc_pages(page_list, opt, llm_client)
    >>>
    >>> # 转换目录为 JSON
    >>> toc_json = await toc_transformer(toc_content, llm_client)
    >>>
    >>> # 验证目录准确性
    >>> accuracy, errors = await verify_toc(page_list, toc_json, llm_client)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .detector import (
    find_toc_pages,
    toc_detector_single_page,
    _calculate_toc_confidence,
    check_toc,
)
from .parser import (
    toc_transformer,
    toc_extractor,
    toc_index_extractor,
    extract_toc_content,
    detect_page_index,
)
from .validator import (
    verify_toc,
    check_title_appearance,
    check_title_appearance_in_start,
    check_title_appearance_in_start_concurrent,
)
from .fixer import (
    fix_incorrect_toc_with_retries,
    single_toc_item_index_fixer,
)

__all__ = [
    # 目录检测
    "find_toc_pages",
    "toc_detector_single_page",
    "_calculate_toc_confidence",
    "check_toc",
    # 目录解析
    "toc_transformer",
    "toc_extractor",
    "toc_index_extractor",
    "extract_toc_content",
    "detect_page_index",
    # 目录验证
    "verify_toc",
    "check_title_appearance",
    "check_title_appearance_in_start",
    "check_title_appearance_in_start_concurrent",
    # 目录修复
    "fix_incorrect_toc_with_retries",
    "single_toc_item_index_fixer",
]
