"""
PageIndex JSON 提取器模块

本模块提供从 LLM 响应中提取和清理 JSON 的功能。

主要功能:
    - extract_json: 从文本中提取并解析 JSON
    - get_json_content: 清理 JSON 文本 (移除 markdown 标记)

处理的问题:
    1. Markdown 代码块: ```json ... ```
    2. Python 格式: None, 单引号等
    3. 尾部逗号: {"a": 1,} 或 {"a": 1, "b": 2,}
    4. 格式问题: 多余空格、换行等

使用示例:
    >>> from pageindex.json_ops.extractor import extract_json, get_json_content
    >>>
    >>> # 提取并解析 JSON
    >>> response = 'Here is the JSON:\\n```json\\n{"name": "test"}\\n```'
    >>> data = extract_json(response)
    >>> print(data["name"])  # "test"
    >>>
    >>> # 获取清理后的内容
    >>> content = get_json_content('```json\\n{"key": "value"}\\n```')
    >>> print(content)  # '{"key": "value"}'

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import json
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def get_json_content(response: str) -> str:
    """
    清理 JSON 文本，移除 markdown 代码块标记

    这个函数只移除 ```json 和 ``` 标记，不解析 JSON。
    适用于需要获取清理后的 JSON 字符串的场景。

    参数:
        response: 可能包含 markdown 标记的文本

    返回:
        清理后的 JSON 字符串

    清理规则:
        1. 移除开头的 ```json 或 ```
        2. 移除结尾的 ```
        3. 保留中间内容不变

    使用示例:
        >>> text = '```json\\n{"key": "value"}\\n```'
        >>> content = get_json_content(text)
        >>> print(content)  # '{"key": "value"}'
        >>>
        >>> # 没有 markdown 标记
        >>> content = get_json_content('{"key": "value"}')
        >>> print(content)  # '{"key": "value"}'
    """
    # 移除开头的 ```json 或 ```
    start_idx = response.find("```json")
    if start_idx != -1:
        start_idx += 7
        response = response[start_idx:]

    # 移除结尾的 ```
    end_idx = response.rfind("```")
    if end_idx != -1:
        response = response[:end_idx]

    json_content = response.strip()
    return json_content


def extract_json(content: str) -> Any:
    """
    从文本中提取并解析 JSON

    这是一个健壮的 JSON 提取函数，可以处理各种格式问题。

    处理的问题:
        1. Markdown 代码块: ```json ... ```
        2. Python 格式: None → null, 单引号 → 双引号
        3. 尾部逗号: {"a": 1,} → {"a": 1}
        4. 格式问题: 多余空格、换行

    参数:
        content: 可能包含 JSON 的文本

    返回:
        解析后的 Python 对象 (dict, list, 或基础类型)

    异常:
        如果 JSON 解析失败，返回空字典 {}

    使用示例:
        >>> # 标准 JSON
        >>> extract_json('{"name": "test"}')
        >>> # 返回: {"name": "test"}
        >>>
        >>> # 带 markdown 标记
        >>> extract_json('```json\\n{"name": "test"}\\n```')
        >>> # 返回: {"name": "test"}
        >>>
        >>> # Python 格式
        >>> extract_json("{'name': None}")
        >>> # 返回: {"name": None}
        >>>
        >>> # 尾部逗号
        >>> extract_json('{"name": "test",}')
        >>> # 返回: {"name": "test"}
    """
    try:
        # ============================================================
        # 步骤1: 提取 JSON 内容 (移除 markdown 标记)
        # ============================================================
        start_idx = content.find("```json")
        if start_idx != -1:
            start_idx += 7
            content = content[start_idx:]

        end_idx = content.rfind("```")
        if end_idx != -1:
            content = content[:end_idx]

        json_content = content.strip()

        # ============================================================
        # 步骤2: 清理常见的格式问题
        # ============================================================
        # 替换 Python None 为 JSON null
        json_content = json_content.replace("None", "null")

        # 移除换行，规范化空格
        json_content = json_content.replace("\n", " ").replace("\r", " ")

        # 规范化空白字符
        json_content = " ".join(json_content.split())

        # ============================================================
        # 步骤3: 尝试解析
        # ============================================================
        return json.loads(json_content)

    except json.JSONDecodeError as e:
        logger.debug(f"初次 JSON 解析失败: {e}")

        # ============================================================
        # 步骤4: 尝试修复尾部逗号
        # ============================================================
        try:
            # 移除 ] 前和 } 前的尾部逗号
            json_content = json_content.replace(",]", "]").replace(",}", "}")
            return json.loads(json_content)
        except json.JSONDecodeError:
            logger.error("JSON 解析失败，即使清理后仍然无效")
            return {}

    except Exception as e:
        logger.error(f"JSON 提取时发生意外错误: {e}")
        return {}


def validate_json(data: Any, expected_keys: List[str] = None) -> bool:
    """
    验证 JSON 数据的有效性

    检查 JSON 数据是否符合预期格式。

    参数:
        data: 要验证的数据
        expected_keys: 期望的键列表 (仅对 dict 有效)

    返回:
        True 如果数据有效，否则 False

    使用示例:
        >>> validate_json({"name": "test"}, ["name"])
        >>> # 返回: True
        >>>
        >>> validate_json({"name": "test"}, ["name", "age"])
        >>> # 返回: False (缺少 age 键)
    """
    if expected_keys is None:
        # 只检查是否为有效 JSON 类型
        return isinstance(data, (dict, list, str, int, float, bool, type(None)))

    if not isinstance(data, dict):
        return False

    # 检查所有期望的键是否存在
    return all(key in data for key in expected_keys)


def safe_json_loads(text: str, default: Any = None) -> Any:
    """
    安全的 JSON 解析，失败时返回默认值

    参数:
        text: 要解析的 JSON 字符串
        default: 解析失败时返回的默认值 (默认 None)

    返回:
        解析结果或默认值

    使用示例:
        >>> safe_json_loads('{"name": "test"}')
        >>> # 返回: {"name": "test"}
        >>>
        >>> safe_json_loads('invalid json', default={})
        >>> # 返回: {}
    """
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return default
