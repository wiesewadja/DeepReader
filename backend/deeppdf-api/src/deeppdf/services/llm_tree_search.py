"""
LLM 树搜索模块
使用 LLM 在 PageIndex 树结构上进行推理检索
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class LLMTreeSearchResult:
    """LLM 树搜索结果"""
    node_ids: List[str] = field(default_factory=list)  # LLM 选中的节点 ID
    thinking: str = ""  # LLM 推理过程
    success: bool = True
    error: Optional[str] = None


class LLMTreeSearchError(Exception):
    """LLM 树搜索错误"""
    def __init__(self, message: str, error_type: str = "unknown"):
        self.message = message
        self.error_type = error_type  # timeout, parse_error, invalid_node, no_api_key
        super().__init__(message)


# Prompt 模板
TREE_SEARCH_PROMPT = """你是一个专业的文档检索助手。你的任务是根据用户的问题，在文档目录结构中找到最相关的章节。

## 文档信息
文档名称: {doc_name}

## 目录结构
{tree_structure_text}

## 用户问题
{query}

## 你的任务
1. 仔细分析用户问题，理解其核心需求
2. 在目录结构中找到最可能包含答案的章节
3. 返回最相关的章节 ID 列表（最多 {max_results} 个）

## 响应格式
请严格按照以下 JSON 格式返回，不要添加任何其他内容：
```json
{{
  "thinking": "你的推理过程：分析问题的关键词，说明为什么选择这些章节...",
  "node_list": ["0001", "0003", "0005"]
}}
```

## 注意事项
- 优先选择叶子节点（最具体的章节）
- 如果问题涉及多个主题，可以跨章节选择
- 如果父章节的摘要已经涵盖了问题内容，也可以选择父章节
- node_id 必须是目录结构中存在的值
"""


def format_tree_structure(
    tree_structure: Dict[str, Any],
    indent: int = 0,
    max_text_length: int = 150,
) -> str:
    """
    将树结构格式化为可读的文本格式

    Args:
        tree_structure: PageIndex 生成的树结构（可能是 dict 或 list）
        indent: 缩进级别
        max_text_length: 摘要最大长度

    Returns:
        格式化后的文本

    输出示例:
    ├── 第一章 投资入门 (node_id: 0001)
    │   摘要: 介绍投资的基本概念...
    │   ├── 1.1 什么是投资 (node_id: 0002)
    │   │   摘要: 投资的定义和分类...
    """
    lines = []

    # 处理 structure 字段（PageIndex 返回的是 {"structure": [...]} 格式）
    if isinstance(tree_structure, dict):
        nodes = tree_structure.get("structure", [])
    elif isinstance(tree_structure, list):
        nodes = tree_structure
    else:
        return ""

    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue

        title = node.get("title", "未知章节")
        node_id = node.get("node_id", "")
        summary = node.get("summary", "")

        # 构建当前行的缩进和符号
        current_prefix = "    " * indent
        current_prefix += "├── " if i < len(nodes) - 1 else "└── "

        # 添加标题行
        lines.append(f"{current_prefix}{title} (node_id: {node_id})")

        # 添加摘要（如果有）
        if summary:
            truncated_summary = (
                summary[:max_text_length] + "..." if len(summary) > max_text_length else summary
            )
            summary_prefix = "    " * (indent + 1) + "摘要: "
            lines.append(f"{summary_prefix}{truncated_summary}")

        # 递归处理子节点
        children = node.get("nodes", [])
        if children:
            child_text = format_tree_structure(
                {"structure": children},
                indent=indent + 1,
                max_text_length=max_text_length,
            )
            if child_text:
                lines.append(child_text)

    return "\n".join(lines)
