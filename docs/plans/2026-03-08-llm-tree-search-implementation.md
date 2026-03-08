# LLM 树搜索功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader 添加 "深度思考" 检索模式，使用 LLM 在 PageIndex 树结构上推理检索，替代默认向量/BM25 混合检索。

**Architecture:** 新建独立模块 `llm_tree_search.py`，扩展 API 模型，在 `querier.py` 中添加分支逻辑。LLM 树搜索完全替代混合检索，失败时静默降级。

**Tech Stack:** Python 3.10+, FastAPI, Pydantic, OpenAI API (DeepSeek), asyncio

---

## Task 1: 创建 LLM 树搜索核心模块

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`

**Step 1: 创建文件骨架和数据类**

```python
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
```

**Step 2: 验证文件创建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run python -c "from deeppdf.services.llm_tree_search import LLMTreeSearchResult, LLMTreeSearchError; print('OK')"`

Expected: `OK`

---

## Task 2: 实现树结构格式化函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`

**Step 1: 添加 format_tree_structure 函数**

在 `TREE_SEARCH_PROMPT` 之后添加：

```python
def format_tree_structure(
    tree_structure: Dict[str, Any],
    indent: int = 0,
    max_text_length: int = 150,
    prefix: str = "",
) -> str:
    """
    将树结构格式化为可读的文本格式

    Args:
        tree_structure: PageIndex 生成的树结构（可能是 dict 或 list）
        indent: 缩进级别
        max_text_length: 摘要最大长度
        prefix: 前缀（用于树形符号）

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
        if indent == 0:
            current_prefix += "├── " if i < len(nodes) - 1 else "└── "
        else:
            current_prefix += "├── " if i < len(nodes) - 1 else "└── "

        # 添加标题行
        lines.append(f"{current_prefix}{title} (node_id: {node_id})")

        # 添加摘要（如果有）
        if summary:
            truncated_summary = summary[:max_text_length] + "..." if len(summary) > max_text_length else summary
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
```

**Step 2: 编写测试**

Create: `backend/deeppdf-api/tests/test_llm_tree_search.py`

```python
"""LLM 树搜索模块测试"""

import pytest
from deeppdf.services.llm_tree_search import format_tree_structure, LLMTreeSearchResult


class TestFormatTreeStructure:
    """测试树结构格式化"""

    def test_empty_structure(self):
        """测试空结构"""
        result = format_tree_structure({})
        assert result == ""

    def test_single_node(self):
        """测试单个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "这是摘要",
                    "nodes": [],
                }
            ]
        }
        result = format_tree_structure(tree)
        assert "第一章" in result
        assert "node_id: 0001" in result
        assert "摘要: 这是摘要" in result

    def test_nested_nodes(self):
        """测试嵌套节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "章节摘要",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "summary": "子章节摘要",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        result = format_tree_structure(tree)
        assert "第一章" in result
        assert "1.1 子章节" in result
        assert "node_id: 0001" in result
        assert "node_id: 0002" in result

    def test_truncates_long_summary(self):
        """测试截断长摘要"""
        long_summary = "x" * 200
        tree = {
            "structure": [
                {
                    "title": "章节",
                    "node_id": "0001",
                    "summary": long_summary,
                    "nodes": [],
                }
            ]
        }
        result = format_tree_structure(tree, max_text_length=50)
        assert "..." in result
        assert len([l for l in result.split("\n") if "摘要" in l][0]) < 100
```

**Step 3: 运行测试验证**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search.py -v`

Expected: 4 tests pass

**Step 4: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py backend/deeppdf-api/tests/test_llm_tree_search.py
git commit -m "feat(llm-tree-search): add format_tree_structure function with tests"
```

---

## Task 3: 实现 Prompt 构建函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`
- Modify: `backend/deeppdf-api/tests/test_llm_tree_search.py`

**Step 1: 添加 build_tree_prompt 函数**

在 `format_tree_structure` 之后添加：

```python
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
```

**Step 2: 添加测试**

在 `tests/test_llm_tree_search.py` 中添加：

```python
class TestBuildTreePrompt:
    """测试 Prompt 构建"""

    def test_basic_prompt(self):
        """测试基本 Prompt 生成"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "摘要内容",
                    "nodes": [],
                }
            ]
        }
        prompt = build_tree_prompt(
            tree_structure=tree,
            query="什么是投资？",
            doc_name="投资学",
            max_results=5,
        )

        assert "投资学" in prompt
        assert "什么是投资？" in prompt
        assert "第一章" in prompt
        assert "node_id: 0001" in prompt
        assert "最多 5 个" in prompt

    def test_prompt_with_empty_doc_name(self):
        """测试空文档名称"""
        tree = {"structure": [{"title": "章节", "node_id": "001", "nodes": []}]}
        prompt = build_tree_prompt(tree, "查询", max_results=3)

        assert "未知文档" in prompt
        assert "最多 3 个" in prompt
```

**Step 3: 更新 import**

在 `test_llm_tree_search.py` 顶部更新 import：

```python
from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    LLMTreeSearchResult,
)
```

**Step 4: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search.py -v`

Expected: 6 tests pass

**Step 5: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py backend/deeppdf-api/tests/test_llm_tree_search.py
git commit -m "feat(llm-tree-search): add build_tree_prompt function with tests"
```

---

## Task 4: 实现 LLM 响应解析函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`
- Modify: `backend/deeppdf-api/tests/test_llm_tree_search.py`

**Step 1: 添加解析函数**

在 `build_tree_prompt` 之后添加：

```python
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
```

**Step 2: 添加测试**

在 `tests/test_llm_tree_search.py` 中添加：

```python
class TestParseLLMResponse:
    """测试 LLM 响应解析"""

    def test_valid_json_with_markdown(self):
        """测试带 markdown 代码块的有效 JSON"""
        response = '''```json
{
  "thinking": "用户问的是投资相关内容",
  "node_list": ["0001", "0003"]
}
```'''
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["0001", "0003"]
        assert "投资相关" in result.thinking

    def test_valid_json_without_markdown(self):
        """测试不带 markdown 的有效 JSON"""
        response = '{"thinking": "推理过程", "node_list": ["0001"]}'
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["0001"]

    def test_invalid_json(self):
        """测试无效 JSON"""
        response = "这不是 JSON"
        result = parse_llm_response(response)
        assert result.success is False
        assert "JSON parse error" in result.error

    def test_node_list_not_list(self):
        """测试 node_list 不是列表"""
        response = '{"thinking": "test", "node_list": "0001"}'
        result = parse_llm_response(response)
        assert result.success is False
        assert "not a list" in result.error

    def test_node_list_with_numbers(self):
        """测试 node_list 包含数字（自动转换）"""
        response = '{"thinking": "test", "node_list": [1, 2, 3]}'
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["1", "2", "3"]
```

**Step 3: 更新 import**

```python
from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    parse_llm_response,
    LLMTreeSearchResult,
)
```

**Step 4: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search.py::TestParseLLMResponse -v`

Expected: 5 tests pass

**Step 5: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py backend/deeppdf-api/tests/test_llm_tree_search.py
git commit -m "feat(llm-tree-search): add parse_llm_response function with tests"
```

---

## Task 5: 实现节点提取函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`
- Modify: `backend/deeppdf-api/tests/test_llm_tree_search.py`

**Step 1: 添加 extract_nodes_by_ids 函数**

在 `parse_llm_response` 之后添加：

```python
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
```

**Step 2: 添加测试**

在 `tests/test_llm_tree_search.py` 中添加：

```python
class TestExtractNodesByIds:
    """测试节点提取"""

    def test_extract_single_node(self):
        """测试提取单个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "text": "章节内容",
                    "summary": "摘要",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": [],
                }
            ]
        }
        results = extract_nodes_by_ids(tree, ["0001"])

        assert len(results) == 1
        assert results[0]["node_id"] == "0001"
        assert results[0]["title"] == "第一章"
        assert results[0]["text"] == "章节内容"

    def test_extract_multiple_nodes(self):
        """测试提取多个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "text": "子章节内容",
                            "nodes": [],
                        }
                    ],
                },
                {
                    "title": "第二章",
                    "node_id": "0003",
                    "nodes": [],
                },
            ]
        }
        results = extract_nodes_by_ids(tree, ["0002", "0003"])

        assert len(results) == 2
        # 验证顺序保持
        assert results[0]["node_id"] == "0002"
        assert results[1]["node_id"] == "0003"

    def test_extract_nonexistent_node(self):
        """测试提取不存在的节点"""
        tree = {"structure": [{"title": "章节", "node_id": "0001", "nodes": []}]}
        results = extract_nodes_by_ids(tree, ["9999"])

        assert len(results) == 0

    def test_extract_with_path(self):
        """测试路径构建"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        results = extract_nodes_by_ids(tree, ["0002"])

        assert results[0]["path"] == "第一章 > 1.1 子章节"
```

**Step 3: 更新 import**

```python
from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    parse_llm_response,
    extract_nodes_by_ids,
    LLMTreeSearchResult,
)
```

**Step 4: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search.py::TestExtractNodesByIds -v`

Expected: 4 tests pass

**Step 5: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py backend/deeppdf-api/tests/test_llm_tree_search.py
git commit -m "feat(llm-tree-search): add extract_nodes_by_ids function with tests"
```

---

## Task 6: 实现核心 LLM 树搜索函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py`

**Step 1: 添加 llm_tree_search 异步函数**

在 `extract_nodes_by_ids` 之后添加：

```python
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
```

**Step 2: 运行语法检查**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run python -c "from deeppdf.services.llm_tree_search import llm_tree_search; print('OK')"`

Expected: `OK`

**Step 3: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py
git commit -m "feat(llm-tree-search): add core llm_tree_search async function"
```

---

## Task 7: 扩展 API 模型

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py`

**Step 1: 扩展 QueryRequest**

在 `QueryRequest` 类中添加新字段（约第 106-111 行）：

```python
class QueryRequest(BaseModel):
    """查询请求"""

    query: str = Field(..., description="查询文本")
    index_id: str = Field(..., description="索引 ID")
    max_results: Optional[int] = Field(10, description="最大结果数")
    use_llm_tree_search: bool = Field(
        False,
        description="是否使用 LLM 树搜索（深度思考模式）"
    )
```

**Step 2: 扩展 QueryResponse**

在 `QueryResponse` 类中添加新字段（约第 136-143 行）：

```python
class QueryResponse(BaseModel):
    """查询响应"""

    status: str
    results: Optional[List[QueryResultItem]] = None
    error: Optional[str] = None
    index_info: Optional[dict] = None
    search_method: Optional[str] = None
    thinking: Optional[str] = None           # 新增: LLM 推理过程
    fallback: Optional[bool] = None          # 新增: 是否发生降级
    fallback_reason: Optional[str] = None    # 新增: 降级原因
```

**Step 3: 验证语法**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run python -c "from deeppdf.api.models import QueryRequest, QueryResponse; r = QueryRequest(query='test', index_id='123', use_llm_tree_search=True); print('OK')"`

Expected: `OK`

**Step 4: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/api/models.py
git commit -m "feat(api): extend QueryRequest and QueryResponse for LLM tree search"
```

---

## Task 8: 修改 querier.py 添加 LLM 树搜索支持

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/querier.py`

**Step 1: 添加导入和新异常类**

在文件顶部添加：

```python
# 在现有导入之后添加
from .llm_tree_search import llm_tree_search, extract_nodes_by_ids, LLMTreeSearchError
from deeppdf.utils.llm_client import get_llm_client
```

**Step 2: 修改 query_pdf 函数签名**

将 `query_pdf` 函数（约第 246 行）修改为：

```python
async def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 10,
    use_llm_tree_search: bool = False,
) -> Dict[str, Any]:
    """
    异步 PDF 查询

    支持两种检索模式:
    1. 混合检索（默认）: 向量 + BM25 + 标题匹配
    2. LLM 树搜索: 使用 LLM 推理定位章节

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大结果数
        use_llm_tree_search: 是否使用 LLM 树搜索

    Returns:
        查询结果字典
    """
    storage_dir_path = Path(storage_dir)
    index_metadata = get_index_metadata(storage_dir_path, index_id)
    tree_structure = index_metadata.get("tree_structure", {})

    # LLM 树搜索模式
    if use_llm_tree_search and tree_structure:
        try:
            result = await _query_with_llm_tree_search(
                query=query,
                tree_structure=tree_structure,
                index_metadata=index_metadata,
                max_results=max_results,
            )
            return result
        except LLMTreeSearchError as e:
            # 静默降级到混合检索
            logger.warning(f"[LLM树搜索] 失败，降级到混合检索: {e}")
            fallback_result = await asyncio.to_thread(
                _query_pdf_sync,
                query=query,
                index_id=index_id,
                storage_dir=storage_dir,
                max_results=max_results,
            )
            fallback_result["fallback"] = True
            fallback_result["fallback_reason"] = str(e)
            return fallback_result

    # 默认：混合检索
    return await asyncio.to_thread(
        _query_pdf_sync,
        query=query,
        index_id=index_id,
        storage_dir=storage_dir,
        max_results=max_results,
    )
```

**Step 3: 添加 _query_with_llm_tree_search 函数**

在 `query_pdf` 之后添加：

```python
async def _query_with_llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    index_metadata: Dict[str, Any],
    max_results: int,
) -> Dict[str, Any]:
    """LLM 树搜索实现"""

    # 1. 获取 LLM 客户端
    try:
        client, model = get_llm_client()
    except ValueError as e:
        raise LLMTreeSearchError(str(e), "no_api_key")

    # 2. 执行 LLM 树搜索
    search_result = await llm_tree_search(
        query=query,
        tree_structure=tree_structure,
        llm_client=client,
        model=model,
        doc_name=index_metadata.get("pdf_name", ""),
        max_results=max_results,
        timeout=15,
        max_retries=2,
    )

    if not search_result.success:
        raise LLMTreeSearchError(search_result.error or "Unknown error", "llm_error")

    # 3. 提取节点内容
    nodes = extract_nodes_by_ids(tree_structure, search_result.node_ids)

    # 4. 格式化返回结果
    results = []
    for node in nodes:
        content = node.get("text") or node.get("summary", "")
        results.append({
            "text": content,
            "metadata": {
                "section": node.get("path", ""),
                "node_id": node.get("node_id"),
                "node_name": node.get("title"),
                "page": node.get("start_index"),
                "start_index": node.get("start_index"),
                "end_index": node.get("end_index"),
            }
        })

    return {
        "status": "success",
        "results": results,
        "search_method": "llm_tree_search",
        "thinking": search_result.thinking,
        "index_info": {
            "pdf_name": index_metadata.get("pdf_name", ""),
            "pdf_path": index_metadata.get("pdf_path", ""),
            "node_count": index_metadata.get("node_count", 0),
            "created_at": index_metadata.get("created_at", ""),
        },
    }
```

**Step 4: 验证语法**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run python -c "from deeppdf.services.querier import query_pdf; print('OK')"`

Expected: `OK`

**Step 5: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/services/querier.py
git commit -m "feat(querier): add LLM tree search support with fallback"
```

---

## Task 9: 修改 API 路由

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 修改 query_index 路由**

找到 `@router.post("/query", response_model=QueryResponse)` 函数（约第 529 行），修改为：

```python
@router.post("/query", response_model=QueryResponse)
async def query_index(req: QueryRequest):
    """查询 PDF 内容（支持 LLM 树搜索）"""
    logger.info(
        f"[API] 收到查询请求: query='{req.query}', index_id='{req.index_id}', "
        f"max_results={req.max_results}, use_llm_tree_search={req.use_llm_tree_search}"
    )

    result = await query_pdf(
        req.query,
        req.index_id,
        str(settings.base_dir),
        req.max_results or settings.max_results,
        use_llm_tree_search=req.use_llm_tree_search,
    )

    # 检查是否出错
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        logger.warning(f"[API] 查询失败: {error_msg}")
        return QueryResponse(status="error", results=None, error=error_msg)

    result_count = len(result.get("results", []))
    search_method = result.get("search_method", "unknown")
    logger.info(f"[API] 查询完成: method={search_method}, 返回 {result_count} 个结果")

    return QueryResponse(**result)
```

**Step 2: 验证语法**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run python -c "from deeppdf.api.routes import router; print('OK')"`

Expected: `OK`

**Step 3: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(api): pass use_llm_tree_search parameter to query_pdf"
```

---

## Task 10: 集成测试

**Files:**
- Create: `backend/deeppdf-api/tests/test_llm_tree_search_integration.py`

**Step 1: 创建集成测试文件**

```python
"""LLM 树搜索集成测试"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from deeppdf.services.llm_tree_search import (
    llm_tree_search,
    extract_nodes_by_ids,
    build_tree_prompt,
)
from deeppdf.services.querier import _query_with_llm_tree_search


# 测试用的树结构
MOCK_TREE = {
    "structure": [
        {
            "title": "第一章 投资入门",
            "node_id": "0001",
            "summary": "介绍投资的基本概念",
            "start_index": 1,
            "end_index": 20,
            "nodes": [
                {
                    "title": "1.1 什么是投资",
                    "node_id": "0002",
                    "summary": "投资的定义和分类",
                    "text": "投资是指投入资金以获取收益的行为...",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": [],
                }
            ],
        },
        {
            "title": "第二章 股票投资",
            "node_id": "0003",
            "summary": "股票投资的基本知识",
            "start_index": 21,
            "end_index": 50,
            "nodes": [],
        },
    ]
}


class TestLLMTreeSearchIntegration:
    """LLM 树搜索集成测试"""

    @pytest.mark.asyncio
    async def test_llm_tree_search_success(self):
        """测试 LLM 树搜索成功场景"""
        # Mock LLM 客户端
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='''```json
{
  "thinking": "用户问的是投资定义，应该看第一章第一节",
  "node_list": ["0002"]
}
```'''))
        ]
        mock_client.chat.completions.create = MagicMock(return_value=mock_response)

        result = await llm_tree_search(
            query="什么是投资？",
            tree_structure=MOCK_TREE,
            llm_client=mock_client,
            model="deepseek-chat",
            doc_name="投资学",
            max_results=5,
        )

        assert result.success is True
        assert "0002" in result.node_ids
        assert "投资" in result.thinking

    @pytest.mark.asyncio
    async def test_extract_and_format(self):
        """测试节点提取和格式化"""
        nodes = extract_nodes_by_ids(MOCK_TREE, ["0002", "0003"])

        assert len(nodes) == 2
        assert nodes[0]["title"] == "1.1 什么是投资"
        assert nodes[0]["path"] == "第一章 投资入门 > 1.1 什么是投资"
        assert nodes[1]["title"] == "第二章 股票投资"

    @pytest.mark.asyncio
    async def test_query_with_llm_tree_search(self):
        """测试完整的查询流程"""
        mock_metadata = {
            "pdf_name": "投资学.pdf",
            "pdf_path": "/path/to/test.pdf",
            "node_count": 3,
            "created_at": "2026-03-08",
            "tree_structure": MOCK_TREE,
        }

        with patch("deeppdf.services.querier.get_llm_client") as mock_get_client:
            # Mock LLM 客户端
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.choices = [
                MagicMock(message=MagicMock(content='''```json
{
  "thinking": "测试推理",
  "node_list": ["0001"]
}
```'''))
            ]
            mock_client.chat.completions.create = MagicMock(return_value=mock_response)
            mock_get_client.return_value = (mock_client, "deepseek-chat")

            result = await _query_with_llm_tree_search(
                query="测试查询",
                tree_structure=MOCK_TREE,
                index_metadata=mock_metadata,
                max_results=5,
            )

            assert result["status"] == "success"
            assert result["search_method"] == "llm_tree_search"
            assert "thinking" in result
            assert len(result["results"]) > 0
```

**Step 2: 运行集成测试**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_integration.py -v`

Expected: 3 tests pass

**Step 3: Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add backend/deeppdf-api/tests/test_llm_tree_search_integration.py
git commit -m "test(llm-tree-search): add integration tests"
```

---

## Task 11: 最终验证和文档

**Step 1: 运行所有测试**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run pytest tests/test_llm_tree_search*.py -v`

Expected: All tests pass

**Step 2: 代码格式化**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent/backend/deeppdf-api && uv run ruff check src/deeppdf/services/llm_tree_search.py src/deeppdf/services/querier.py src/deeppdf/api/models.py src/deeppdf/api/routes.py --fix && uv run black src/deeppdf/services/llm_tree_search.py src/deeppdf/services/querier.py src/deeppdf/api/models.py src/deeppdf/api/routes.py`

**Step 3: 更新设计文档**

在 `docs/plans/2026-03-08-llm-tree-search-feature.md` 末尾添加实现状态：

```markdown
---

## 实现状态

- [x] Task 1: 创建 LLM 树搜索核心模块
- [x] Task 2: 实现树结构格式化函数
- [x] Task 3: 实现 Prompt 构建函数
- [x] Task 4: 实现 LLM 响应解析函数
- [x] Task 5: 实现节点提取函数
- [x] Task 6: 实现核心 LLM 树搜索函数
- [x] Task 7: 扩展 API 模型
- [x] Task 8: 修改 querier.py 添加 LLM 树搜索支持
- [x] Task 9: 修改 API 路由
- [x] Task 10: 集成测试
- [x] Task 11: 最终验证和文档

**实现完成日期**: 2026-03-08
```

**Step 4: 最终 Commit**

```bash
cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/frontend-agent
git add -A
git commit -m "feat(llm-tree-search): complete implementation with tests and docs

- Add llm_tree_search.py with tree formatting, prompt building, and LLM calls
- Extend QueryRequest with use_llm_tree_search flag
- Extend QueryResponse with thinking, fallback, fallback_reason
- Modify querier.py to support LLM tree search with automatic fallback
- Add comprehensive unit and integration tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 文件改动总结

| 文件 | 类型 | 说明 |
|------|------|------|
| `services/llm_tree_search.py` | 新建 | LLM 树搜索核心模块 |
| `services/querier.py` | 修改 | 添加 LLM 树搜索支持和降级逻辑 |
| `api/models.py` | 修改 | 扩展 QueryRequest 和 QueryResponse |
| `api/routes.py` | 修改 | 透传 use_llm_tree_search 参数 |
| `tests/test_llm_tree_search.py` | 新建 | 单元测试 |
| `tests/test_llm_tree_search_integration.py` | 新建 | 集成测试 |

---

## 前端集成要点（后续任务）

前端需要：
1. 在搜索界面添加 "深度思考" 按钮
2. 点击时设置 `use_llm_tree_search: true`
3. 展示响应中的 `thinking` 字段
4. 处理 `fallback` 状态，显示降级提示
