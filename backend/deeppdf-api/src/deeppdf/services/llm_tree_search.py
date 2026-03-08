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


def build_tree_prompt(
    tree_structure: Dict[str, Any],
    query: str,
    doc_name: str = "",
    max_results: int = 5,
) -> str:
    """
    构建带层级路径的 Prompt

    Args:
        tree_structure: PageIndex 生成的树结构
        query: 用户查询
        doc_name: 文档名称
        max_results: 最大返回节点数

    Returns:
        完整的 Prompt 字符串
    """
    tree_text = format_tree_structure(tree_structure)

    return TREE_SEARCH_PROMPT.format(
        doc_name=doc_name or "未知文档",
        tree_structure_text=tree_text,
        query=query,
        max_results=max_results,
    )


def parse_llm_response(response_text: str) -> LLMTreeSearchResult:
    """
    解析 LLM 响应，提取 node_list 和 thinking

    Args:
        response_text: LLM 返回的原始文本

    Returns:
        LLMTreeSearchResult
    """
    try:
        # 尝试提取 JSON 块
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response_text)
        if json_match:
            json_str = json_match.group(1)
        else:
            # 尝试直接解析为 JSON
            json_str = response_text.strip()

        # 解析 JSON
        data = json.loads(json_str)

        thinking = data.get("thinking", "")
        node_list = data.get("node_list", [])

        # 验证 node_list 是列表
        if not isinstance(node_list, list):
            return LLMTreeSearchResult(
                success=False,
                error=f"node_list is not a list: {type(node_list)}",
            )

        # 验证所有元素是字符串
        if not all(isinstance(n, str) for n in node_list):
            node_list = [str(n) for n in node_list]

        return LLMTreeSearchResult(
            node_ids=node_list,
            thinking=thinking,
            success=True,
        )

    except json.JSONDecodeError as e:
        return LLMTreeSearchResult(
            success=False,
            error=f"JSON parse error: {str(e)}",
        )
    except Exception as e:
        return LLMTreeSearchResult(
            success=False,
            error=f"Parse error: {str(e)}",
        )


def extract_nodes_by_ids(
    tree_structure: Dict[str, Any],
    node_ids: List[str],
) -> List[Dict[str, Any]]:
    """
    根据 node_id 列表从 tree_structure 中提取节点内容

    Args:
        tree_structure: PageIndex 生成的树结构
        node_ids: 要提取的节点 ID 列表

    Returns:
        List of {node_id, title, text, summary, path, start_index, end_index}
    """
    results = []
    node_ids_set = set(node_ids)

    def traverse(nodes: List[Dict], parent_path: str = ""):
        for node in nodes:
            node_id = node.get("node_id", "")
            title = node.get("title", "")
            current_path = f"{parent_path} > {title}" if parent_path else title

            # 如果当前节点在目标列表中
            if node_id in node_ids_set:
                results.append({
                    "node_id": node_id,
                    "title": title,
                    "text": node.get("text", ""),
                    "summary": node.get("summary", ""),
                    "path": current_path,
                    "start_index": node.get("start_index"),
                    "end_index": node.get("end_index"),
                })

            # 递归处理子节点
            children = node.get("nodes", [])
            if children:
                traverse(children, current_path)

    # 处理 structure 字段
    if isinstance(tree_structure, dict):
        nodes = tree_structure.get("structure", [])
    elif isinstance(tree_structure, list):
        nodes = tree_structure
    else:
        return []

    traverse(nodes)

    # 按照 node_ids 的顺序排序
    id_to_node = {n["node_id"]: n for n in results}
    ordered_results = []
    for nid in node_ids:
        if nid in id_to_node:
            ordered_results.append(id_to_node[nid])

    return ordered_results


async def llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    llm_client,  # OpenAI 客户端
    model: str,
    doc_name: str = "",
    max_results: int = 5,
    timeout: int = 15,
    max_retries: int = 2,
) -> LLMTreeSearchResult:
    """
    使用 LLM 在文档树结构上进行推理检索

    Args:
        query: 用户查询
        tree_structure: PageIndex 生成的树结构
        llm_client: OpenAI 客户端
        model: 模型名称
        doc_name: 文档名称
        max_results: 最大返回节点数
        timeout: 单次调用超时（秒）
        max_retries: 最大重试次数

    Returns:
        LLMTreeSearchResult
    """
    if not tree_structure:
        return LLMTreeSearchResult(
            success=False,
            error="tree_structure is empty",
        )

    # 构建 Prompt
    prompt = build_tree_prompt(
        tree_structure=tree_structure,
        query=query,
        doc_name=doc_name,
        max_results=max_results,
    )

    # 重试逻辑
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            logger.info(f"[LLM树搜索] 尝试 {attempt + 1}/{max_retries + 1}")

            # 调用 LLM（带超时）
            response = await asyncio.wait_for(
                _call_llm_async(llm_client, model, prompt),
                timeout=timeout,
            )

            # 解析响应
            result = parse_llm_response(response)

            if result.success:
                # 验证 node_ids 是否存在
                valid_ids = _validate_node_ids(tree_structure, result.node_ids)
                if len(valid_ids) != len(result.node_ids):
                    logger.warning(
                        f"[LLM树搜索] 部分 node_id 无效: {result.node_ids} -> {valid_ids}"
                    )
                    result.node_ids = valid_ids

                if not valid_ids:
                    return LLMTreeSearchResult(
                        success=False,
                        error="No valid node_ids in LLM response",
                    )

                logger.info(f"[LLM树搜索] 成功: node_ids={result.node_ids}")
                return result
            else:
                last_error = result.error
                logger.warning(f"[LLM树搜索] 解析失败: {last_error}")

        except asyncio.TimeoutError:
            last_error = f"Timeout after {timeout}s"
            logger.warning(f"[LLM树搜索] 超时: {last_error}")
        except Exception as e:
            last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"[LLM树搜索] 错误: {last_error}")

    return LLMTreeSearchResult(
        success=False,
        error=f"Failed after {max_retries + 1} attempts: {last_error}",
    )


async def _call_llm_async(client, model: str, prompt: str) -> str:
    """
    异步调用 LLM

    Args:
        client: OpenAI 客户端
        model: 模型名称
        prompt: Prompt 字符串

    Returns:
        LLM 响应文本
    """
    # OpenAI 客户端的异步调用
    response = await asyncio.to_thread(
        client.chat.completions.create,
        model=model,
        messages=[
            {"role": "system", "content": "你是一个专业的文档检索助手。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=1000,
    )

    return response.choices[0].message.content or ""


def _validate_node_ids(tree_structure: Dict[str, Any], node_ids: List[str]) -> List[str]:
    """
    验证 node_ids 是否存在于树结构中

    Returns:
        有效的 node_id 列表
    """
    valid_ids = set()

    def collect_ids(nodes):
        for node in nodes:
            node_id = node.get("node_id")
            if node_id:
                valid_ids.add(node_id)
            children = node.get("nodes", [])
            if children:
                collect_ids(children)

    if isinstance(tree_structure, dict):
        nodes = tree_structure.get("structure", [])
    elif isinstance(tree_structure, list):
        nodes = tree_structure
    else:
        return []

    collect_ids(nodes)

    return [nid for nid in node_ids if nid in valid_ids]
