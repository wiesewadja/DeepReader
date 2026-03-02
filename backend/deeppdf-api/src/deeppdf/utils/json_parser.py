"""
JSON 解析工具模块
提供统一的 JSON 解析功能，支持从 LLM 响应中提取 JSON
"""

import json
import re
import logging
from typing import Any, Dict, List, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


def parse_json_object(
    content: str, default: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    从字符串中解析 JSON 对象

    支持以下格式：
    1. 纯 JSON 字符串
    2. 包含在 markdown 代码块中的 JSON
    3. 混合文本中的 JSON 对象

    Args:
        content: 可能包含 JSON 的字符串
        default: 解析失败时的默认返回值

    Returns:
        解析出的字典，失败时返回 default 或空字典
    """
    if default is None:
        default = {}

    if not content:
        return default

    content = content.strip()

    # 尝试直接解析
    try:
        result = json.loads(content)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # 尝试从 markdown 代码块中提取
    code_block_patterns = [
        r"```json\s*([\s\S]*?)\s*```",
        r"```\s*([\s\S]*?)\s*```",
    ]

    for pattern in code_block_patterns:
        matches = re.findall(pattern, content)
        for match in matches:
            try:
                result = json.loads(match.strip())
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                continue

    # 尝试提取第一个 JSON 对象
    json_patterns = [
        r"\{[\s\S]*?\}",  # 非贪婪，匹配第一个对象
        r"\{[\s\S]*\}",  # 贪婪，匹配整个对象（处理嵌套）
    ]

    for pattern in json_patterns:
        match = re.search(pattern, content)
        if match:
            try:
                result = json.loads(match.group())
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                continue

    logger.warning(f"Failed to parse JSON object from content: {content[:200]}...")
    return default


def parse_json_array(content: str, default: Optional[List[Any]] = None) -> List[Any]:
    """
    从字符串中解析 JSON 数组

    Args:
        content: 可能包含 JSON 数组的字符串
        default: 解析失败时的默认返回值

    Returns:
        解析出的列表，失败时返回 default 或空列表
    """
    if default is None:
        default = []

    if not content:
        return default

    content = content.strip()

    # 尝试直接解析
    try:
        result = json.loads(content)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass

    # 尝试从 markdown 代码块中提取
    code_block_patterns = [
        r"```json\s*([\s\S]*?)\s*```",
        r"```\s*([\s\S]*?)\s*```",
    ]

    for pattern in code_block_patterns:
        matches = re.findall(pattern, content)
        for match in matches:
            try:
                result = json.loads(match.strip())
                if isinstance(result, list):
                    return result
            except json.JSONDecodeError:
                continue

    # 尝试提取 JSON 数组
    match = re.search(r"\[[\s\S]*\]", content)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    logger.warning(f"Failed to parse JSON array from content: {content[:200]}...")
    return default


def parse_json(content: str, default: Optional[T] = None) -> T:
    """
    通用的 JSON 解析函数

    Args:
        content: 可能包含 JSON 的字符串
        default: 解析失败时的默认返回值

    Returns:
        解析出的结果，失败时返回 default
    """
    if not content:
        return default

    content = content.strip()

    # 尝试直接解析
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # 尝试从 markdown 代码块中提取
    for pattern in [r"```json\s*([\s\S]*?)\s*```", r"```\s*([\s\S]*?)\s*```"]:
        matches = re.findall(pattern, content)
        for match in matches:
            try:
                return json.loads(match.strip())
            except json.JSONDecodeError:
                continue

    # 尝试提取任意 JSON 结构
    for pattern in [r"\{[\s\S]*\}", r"\[[\s\S]*\]"]:
        match = re.search(pattern, content)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue

    logger.warning(f"Failed to parse JSON from content: {content[:200]}...")
    return default
