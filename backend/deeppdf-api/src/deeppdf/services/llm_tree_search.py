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
