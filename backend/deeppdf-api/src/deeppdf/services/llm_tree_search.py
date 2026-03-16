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


# Prompt 模板（精简版）
TREE_SEARCH_PROMPT = """在目录中找到与问题最相关的 {max_results} 个章节。

文档: {doc_name}

{tree_structure_text}

问题: {query}

返回 JSON: {{"node_list": ["node_id"], "thinking": "简短推理"}}
"""


def format_tree_structure(
    tree_structure: Dict[str, Any],
    indent: int = 0,
    max_text_length: int = 100,
    max_depth: int = 4,
    max_total_chars: int = 50000,
    _current_chars: int = 0,
) -> tuple[str, int]:
    """
    将树结构格式化为可读的文本格式（带字符预算控制）

    Args:
        tree_structure: PageIndex 生成的树结构（可能是 dict 或 list）
        indent: 缩进级别
        max_text_length: 单个摘要最大长度
        max_depth: 最大递归深度（控制层级）
        max_total_chars: 总字符数预算（防止超 token）
        _current_chars: 内部使用，当前已用字符数

    Returns:
        (格式化后的文本, 使用的字符数)

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
        return "", _current_chars

    # 深度限制：超过 max_depth 只显示标题，不显示摘要
    show_summary = indent < max_depth

    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue

        title = node.get("title", "未知章节")
        node_id = node.get("node_id", "")
        summary = node.get("summary", "") if show_summary else ""

        # 构建当前行的缩进和符号
        current_prefix = "    " * indent
        current_prefix += "├── " if i < len(nodes) - 1 else "└── "

        # 添加标题行
        title_line = f"{current_prefix}{title} (node_id: {node_id})"
        line_chars = len(title_line)

        # 检查预算
        if _current_chars + line_chars > max_total_chars:
            lines.append(f"\n... [已达到长度限制，省略 {len(nodes) - i} 个节点]")
            break

        lines.append(title_line)
        _current_chars += line_chars

        # 添加摘要（如果有且在深度限制内）
        if summary:
            truncated_summary = (
                summary[:max_text_length] + "..."
                if len(summary) > max_text_length
                else summary
            )
            summary_prefix = "    " * (indent + 1) + "摘要: "
            summary_line = f"{summary_prefix}{truncated_summary}"
            summary_chars = len(summary_line)

            # 检查预算
            if _current_chars + summary_chars <= max_total_chars:
                lines.append(summary_line)
                _current_chars += summary_chars

        # 递归处理子节点
        children = node.get("nodes", [])
        if children and indent < max_depth:
            child_text, _current_chars = format_tree_structure(
                {"structure": children},
                indent=indent + 1,
                max_text_length=max_text_length,
                max_depth=max_depth,
                max_total_chars=max_total_chars,
                _current_chars=_current_chars,
            )
            if child_text:
                lines.append(child_text)

    return "\n".join(lines), _current_chars


def build_tree_prompt(
    tree_structure: Dict[str, Any],
    query: str,
    doc_name: str = "",
    max_results: int = 5,
    max_tree_chars: int = 50000,
) -> str:
    """
    构建带层级路径的 Prompt

    Args:
        tree_structure: PageIndex 生成的树结构
        query: 用户查询
        doc_name: 文档名称
        max_results: 最大返回节点数
        max_tree_chars: 树结构最大字符数（防止超 token）

    Returns:
        完整的 Prompt 字符串
    """
    tree_text, used_chars = format_tree_structure(
        tree_structure,
        max_total_chars=max_tree_chars,
    )

    if used_chars >= max_tree_chars:
        logger.warning(f"[LLM树搜索] 树结构已截断: {used_chars}/{max_tree_chars} 字符")

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
        json_match = re.search(r"```json\s*([\s\S]*?)\s*```", response_text)
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
    max_text_length: int = 12000,
) -> List[Dict[str, Any]]:
    """
    根据 node_id 列表从 tree_structure 中提取节点内容

    Args:
        tree_structure: PageIndex 生成的树结构
        node_ids: 要提取的节点 ID 列表
        max_text_length: 单个节点文本最大长度（防止返回内容过长）

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
                # 截断过长的文本
                text = node.get("text", "")
                if len(text) > max_text_length:
                    text = text[:max_text_length] + "...[内容已截断]"
                    logger.info(f"[提取节点] {node_id} 文本已截断: {len(node.get('text', ''))} -> {max_text_length}")

                results.append(
                    {
                        "node_id": node_id,
                        "title": title,
                        "text": text,
                        "summary": node.get("summary", ""),
                        "path": current_path,
                        "start_index": node.get("start_index"),
                        "end_index": node.get("end_index"),
                    }
                )

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
    timeout: int = 30,  # 从 15s 增加到 30s，DeepSeek API 响应较慢
    max_retries: int = 3,  # 增加重试次数到 3
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
    import time

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

    # 日志：输出关键信息
    logger.info(f"[LLM树搜索] 开始搜索 - 文档: {doc_name}, 模型: {model}")
    logger.info(f"[LLM树搜索] 查询: {query[:100]}{'...' if len(query) > 100 else ''}")
    logger.info(f"[LLM树搜索] Prompt 长度: {len(prompt)} 字符, 超时设置: {timeout}s")

    # 获取客户端的 base_url 信息
    client_base_url = getattr(llm_client, 'base_url', 'unknown')
    logger.info(f"[LLM树搜索] API 基础 URL: {client_base_url}")

    # 重试逻辑
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            logger.info(f"[LLM树搜索] 尝试 {attempt + 1}/{max_retries + 1}")
            call_start_time = time.time()

            # 调用 LLM（带超时）
            response = await asyncio.wait_for(
                _call_llm_async(llm_client, model, prompt),
                timeout=timeout,
            )

            call_elapsed = time.time() - call_start_time
            logger.info(f"[LLM树搜索] API 调用成功，耗时: {call_elapsed:.2f}s")

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
            call_elapsed = time.time() - call_start_time
            last_error = f"Timeout after {timeout}s (actual: {call_elapsed:.2f}s)"
            logger.warning(f"[LLM树搜索] 超时: {last_error}")
            logger.warning(f"[LLM树搜索] 超时可能原因: 1) 模型响应慢 2) Prompt 过长({len(prompt)}字符) 3) 网络问题 4) API 限流")
        except asyncio.CancelledError:
            last_error = "Request was cancelled"
            logger.warning(f"[LLM树搜索] 请求被取消: {last_error}")
        except Exception as e:
            last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"[LLM树搜索] 错误: {last_error}", exc_info=True)

    logger.error(f"[LLM树搜索] 所有尝试失败 - 模型: {model}, 最后错误: {last_error}")
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
    import time

    logger.debug(f"[LLM树搜索] 开始调用 API - 模型: {model}")

    try:
        start_time = time.time()

        # OpenAI 客户端的异步调用（不需要系统消息，prompt 已自包含）
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=model,
            messages=[
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1000,
        )

        elapsed = time.time() - start_time
        logger.debug(f"[LLM树搜索] API 响应耗时: {elapsed:.2f}s")

        content = response.choices[0].message.content or ""
        logger.debug(f"[LLM树搜索] 响应内容长度: {len(content)} 字符")

        return content

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"[LLM树搜索] API 调用异常 (耗时 {elapsed:.2f}s): {type(e).__name__}: {str(e)}")
        raise


def _validate_node_ids(
    tree_structure: Dict[str, Any], node_ids: List[str]
) -> List[str]:
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
