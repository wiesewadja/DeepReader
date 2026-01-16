"""
PageIndex JSON 操作模块

本模块提供 JSON 提取和清理功能。

主要功能:
    - JSON 提取 (extract_json): 从 LLM 响应中提取 JSON
    - 内容获取 (get_json_content): 获取 JSON 内容 (清理 markdown 标记)

处理场景:
    - LLM 返回的 JSON 被包裹在 ```json ``` 中
    - JSON 包含 Python 格式 (None, 单引号等)
    - JSON 包含尾部逗号

使用示例:
    >>> from pageindex.json_ops import extract_json, get_json_content
    >>>
    >>> # 提取 JSON
    >>> response = '```json\\n{"key": "value"}\\n```'
    >>> data = extract_json(response)
    >>> print(data)  # {"key": "value"}
    >>>
    >>> # 获取清理后的内容
    >>> content = get_json_content(response)
    >>> print(content)  # {"key": "value"}

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .extractor import extract_json, get_json_content

__all__ = [
    "extract_json",
    "get_json_content",
]
