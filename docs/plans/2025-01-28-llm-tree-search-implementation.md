# LLMTreeSearchTool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 `LLMTreeSearchTool`，一个基于 LLM 推理的树搜索工具，与 `HybridSearchTool` 形成互补。

**Architecture:** 两阶段检索架构：阶段 1 使用 `HybridSearchTool` 粗筛获取 Top-20 候选，阶段 2 使用 LLM 对候选子树进行推理精排。失败时优雅降级到 `HybridSearchTool`。

**Tech Stack:** Python 3.10+, OpenAI-compatible API (DeepSeek/OpenAI), pytest, logging with custom prefixes.

---

## Task 1: 创建 PromptBuilder 工具类

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/agent/prompt_builder.py`
- Test: `backend/deeppdf-api/tests/test_prompt_builder.py`

**Step 1: Write the failing test**

```python
# tests/test_prompt_builder.py
import pytest
from deeppdf.agent.prompt_builder import PromptBuilder

def test_build_with_summary():
    """测试有 summary 字段的树结构构建 Prompt"""
    builder = PromptBuilder()
    tree = {
        "structure": [
            {
                "title": "Chapter 1",
                "node_id": "0001",
                "summary": "This is chapter 1 summary",
                "start_index": 1
            }
        ]
    }
    prompt = builder.build("What is this about?", tree)

    assert "What is this about?" in prompt
    assert "This is chapter 1 summary" in prompt
    assert '{"thinking":' in prompt
    assert '"node_list":' in prompt

def test_build_without_summary():
    """测试无 summary 字段的树结构构建 Prompt"""
    builder = PromptBuilder()
    tree = {
        "structure": [
            {
                "title": "Chapter 1",
                "node_id": "0001",
                "start_index": 1
            }
        ]
    }
    prompt = builder.build("What is this about?", tree)

    assert "What is this about?" in prompt
    assert "Chapter 1" in prompt
    assert "summary" not in prompt.lower() or "标题" in prompt

def test_count_nodes():
    """测试节点计数"""
    builder = PromptBuilder()
    tree = {
        "structure": [
            {"title": "C1", "node_id": "0001"},
            {"title": "C2", "node_id": "0002"},
        ]
    }
    prompt = builder.build("query", tree)
    assert "共 2 个" in prompt or "2 nodes" in prompt
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_prompt_builder.py -v`

Expected: `ImportError: No module named 'deeppdf.agent.prompt_builder'`

**Step 3: Write minimal implementation**

```python
# src/deeppdf/agent/prompt_builder.py
"""
Prompt 构建器 - 根据树结构动态构建 LLM Prompt
"""
import json
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


class PromptBuilder:
    """
    Prompt 构建器

    根据候选子树的字段（summary、title、prefix_summary）动态构建 Prompt
    """

    def __init__(self):
        self._has_summary = None

    def _check_has_summary(self, tree: Dict[str, Any]) -> bool:
        """检查树结构中是否有 summary 字段"""
        def check_node(node: Dict[str, Any]) -> bool:
            if "summary" in node and node["summary"]:
                return True
            for child in node.get("nodes", []):
                if check_node(child):
                    return True
            return False

        structure = tree.get("structure", [])
        for node in structure:
            if check_node(node):
                return True
        return False

    def _count_nodes(self, tree: Dict[str, Any]) -> int:
        """统计节点数量"""
        def count(node):
            total = 1
            for child in node.get("nodes", []):
                total += count(child)
            return total

        structure = tree.get("structure", [])
        return sum(count(node) for node in structure)

    def _build_tree_text(self, tree: Dict[str, Any], include_summary: bool) -> str:
        """构建树结构的文本表示"""
        lines = []

        def format_node(node: Dict[str, Any], level: int = 0):
            indent = "  " * level
            title = node.get("title", "未命名")
            node_id = node.get("node_id", "")

            if include_summary:
                summary = node.get("summary", "")
                prefix = node.get("prefix_summary", "")
                lines.append(f"{indent}- {title} [ID: {node_id}]")
                if prefix:
                    lines.append(f"{indent}  摘要: {prefix[:100]}...")
                elif summary:
                    lines.append(f"{indent}  摘要: {summary[:100]}...")
            else:
                lines.append(f"{indent}- {title} [ID: {node_id}]")

            for child in node.get("nodes", []):
                format_node(child, level + 1)

        for node in tree.get("structure", []):
            format_node(node)

        return "\n".join(lines)

    def build(self, query: str, tree: Dict[str, Any]) -> str:
        """
        构建 Prompt

        Args:
            query: 用户查询
            tree: 候选子树结构

        Returns:
            完整的 Prompt 字符串
        """
        has_summary = self._check_has_summary(tree)
        node_count = self._count_nodes(tree)
        tree_text = self._build_tree_text(tree, include_summary=has_summary)

        logger.info(
            f"[LLM_TREE_SEARCH][PROMPT] 构建完成: "
            f"节点数={node_count}, 包含摘要={has_summary}"
        )

        if has_summary:
            prompt = f"""问题：{query}

文档候选章节（共 {node_count} 个）：
{tree_text}

请分析上述章节，找出最可能包含答案的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
直接返回最终的 JSON 结构，不要输出其他内容。"""
        else:
            prompt = f"""问题：{query}

文档候选章节标题（共 {node_count} 个）：
{tree_text}

请根据章节标题判断相关性，找出可能相关的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
直接返回最终的 JSON 结构，不要输出其他内容。"""

        return prompt
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_prompt_builder.py -v`

Expected: PASS (3 passed)

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/prompt_builder.py backend/deeppdf-api/tests/test_prompt_builder.py
git commit -m "feat(agent): 添加 PromptBuilder 工具类"
```

---

## Task 2: 创建 LLMTreeSearchTool 基础结构

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py` (添加 LLMTreeSearchTool 类)
- Test: `backend/deeppdf-api/tests/test_llm_tree_search_tool.py`

**Step 1: Write the failing test**

```python
# tests/test_llm_tree_search_tool.py
import pytest
from unittest.mock import Mock, MagicMock
from deeppdf.agent.tools import LLMTreeSearchTool
from deeppdf.agent.markdown_locator import MarkdownLocator

def test_tool_initialization():
    """测试工具初始化"""
    hybrid_tool = Mock()
    locator = Mock(spec=MarkdownLocator)
    node_map = {"0001": {"title": "Test", "start_index": 1}}
    llm_client = Mock()

    tool = LLMTreeSearchTool(
        hybrid_search_tool=hybrid_tool,
        markdown_locator=locator,
        node_map=node_map,
        llm_client=llm_client,
    )

    assert tool.name == "llm_tree_search"
    assert "深度理解" in tool.description
    assert tool._hybrid_search == hybrid_tool
    assert tool._node_map == node_map

def test_tool_description_format():
    """测试工具描述包含必要信息"""
    tool = LLMTreeSearchTool(
        hybrid_search_tool=Mock(),
        markdown_locator=Mock(),
        node_map={},
        llm_client=Mock(),
    )

    desc = tool.description
    assert "query" in desc.lower()
    assert "obsidian_link" in desc or "json" in desc.lower()
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_tool_initialization -v`

Expected: `ImportError: cannot import name 'LLMTreeSearchTool'`

**Step 3: Write minimal implementation**

在 `tools.py` 末尾添加：

```python
# 在 tools.py 文件末尾添加

class LLMTreeSearchTool:
    """
    LLM 树搜索工具 - 基于深度理解的智能检索

    通过分析文档树结构找到相关章节，适合跨章节推理、模糊问题。
    """

    name: str = "llm_tree_search"
    description: str = (
        "基于深度理解的智能检索，通过分析文档逻辑结构找到相关章节。"
        "适合跨章节推理、模糊问题或需要理解文档整体脉络的查询。"
        "参数: query (str, 必需) - 搜索问题\n\n"
        "**返回格式：** JSON 数组，包含 obsidian_link、page、text（与 hybrid_search 相同）"
    )

    def __init__(
        self,
        hybrid_search_tool: HybridSearchTool,
        markdown_locator: MarkdownLocator,
        node_map: Dict[str, Any],
        llm_client: Any,
        cache_ttl: int = 300,
    ):
        """
        初始化 LLM 树搜索工具

        Args:
            hybrid_search_tool: HybridSearchTool 实例（用于粗筛）
            markdown_locator: Markdown 定位器
            node_map: node_id 到节点的映射字典
            llm_client: LLM 客户端
            cache_ttl: 缓存生存时间（秒），默认 300（5分钟）
        """
        self._hybrid_search = hybrid_search_tool
        self._markdown_locator = markdown_locator
        self._node_map = node_map
        self._llm_client = llm_client
        self._cache_ttl = cache_ttl
        self._cache: Dict[str, str] = {}

        logger = logging.getLogger(__name__)
        logger.info("[LLM_TREE_SEARCH] 工具初始化完成")
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_tool_initialization -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/tools.py backend/deeppdf-api/tests/test_llm_tree_search_tool.py
git commit -m "feat(agent): 添加 LLMTreeSearchTool 基础结构"
```

---

## Task 3: 实现缓存机制

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py` (LLMTreeSearchTool 类)
- Test: `backend/deeppdf-api/tests/test_llm_tree_search_tool.py`

**Step 1: Write the failing test**

```python
import time

def test_cache_hit():
    """测试缓存命中"""
    tool = LLMTreeSearchTool(
        hybrid_search_tool=Mock(),
        markdown_locator=Mock(),
        node_map={},
        llm_client=Mock(),
        cache_ttl=10,
    )

    # 手动设置缓存
    tool._cache["test query"] = '{"result": "cached"}'

    # 验证缓存被使用（LLM 不应被调用）
    result = tool(query="test query")

    assert "cached" in result
    # LLM client 不应该被调用
    assert not tool._llm_client.chat.called

def test_cache_expiry():
    """测试缓存过期（需要模拟时间）"""
    # 实际测试中可以使用 time.sleep 或 mock 时间
    # 这里简化为测试不同 query 不共享缓存
    tool = LLMTreeSearchTool(
        hybrid_search_tool=Mock(return_value='{"results": []}'),
        markdown_locator=Mock(),
        node_map={},
        llm_client=Mock(return_value='{"node_list": []}'),
    )

    tool._cache["query1"] = "result1"
    tool._cache["query2"] = "result2"

    assert tool._cache["query1"] == "result1"
    assert tool._cache["query2"] == "result2"
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_cache_hit -v`

Expected: 测试会失败，因为缓存逻辑尚未实现

**Step 3: Implement cache logic**

在 `LLMTreeSearchTool` 类中添加缓存相关方法：

```python
# 在 LLMTreeSearchTool 类中添加

import time
import hashlib

def _get_cache_key(self, query: str) -> str:
    """生成缓存键"""
    return hashlib.md5(query.encode()).hexdigest()

def _get_from_cache(self, query: str) -> Optional[str]:
    """从缓存获取结果（带过期检查）"""
    cache_key = self._get_cache_key(query)
    if cache_key in self._cache:
        logger.info(f"[LLM_TREE_SEARCH][CACHE] 缓存命中: query='{query[:30]}...'")
        return self._cache[cache_key]
    logger.info(f"[LLM_TREE_SEARCH][CACHE] 缓存未命中: query='{query[:30]}...'")
    return None

def _save_to_cache(self, query: str, result: str):
    """保存结果到缓存"""
    cache_key = self._get_cache_key(query)
    self._cache[cache_key] = result
    logger.info(f"[LLM_TREE_SEARCH][CACHE] 结果已缓存")
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_cache_hit -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/tools.py backend/deeppdf-api/tests/test_llm_tree_search_tool.py
git commit -m "feat(agent): 实现缓存机制"
```

---

## Task 4: 实现阶段 1 - 粗筛（调用 HybridSearchTool）

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py`
- Test: `backend/deeppdf-api/tests/test_llm_tree_search_tool.py`

**Step 1: Write the failing test**

```python
def test_stage1_hybrid_search_called():
    """测试阶段 1 调用 HybridSearchTool"""
    hybrid_mock = Mock(return_value='[{"text": "result", "metadata": {"node_id": "0001"}}]')
    locator = Mock()
    locator.generate_citation_metadata.return_value = {
        "node_id": "0001",
        "obsidian_link": "[[test.md]]",
        "text": "result"
    }

    tool = LLMTreeSearchTool(
        hybrid_search_tool=hybrid_mock,
        markdown_locator=locator,
        node_map={"0001": {"title": "Test", "start_index": 1}},
        llm_client=Mock(return_value='{"node_list": ["0001"]}'),
    )

    # 调用工具
    result = tool(query="test query")

    # 验证 HybridSearchTool 被正确调用
    hybrid_mock.assert_called_once()
    call_args = hybrid_mock.call_args
    assert call_args[1]["query"] == "test query"
    assert call_args[1]["top_k"] == 20
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_stage1_hybrid_search_called -v`

Expected: 测试失败，因为 `__call__` 方法尚未完整实现

**Step 3: Implement stage 1 logic**

在 `LLMTreeSearchTool` 类中实现 `__call__` 方法的基础结构：

```python
# 在 LLMTreeSearchTool 类中添加

def __call__(self, query: str, top_k: int = 5) -> str:
    """
    执行 LLM 树搜索

    Args:
        query: 搜索查询
        top_k: 返回结果数量（注意：阶段 1 固定使用 20 进行粗筛）

    Returns:
        JSON 字符串，与 HybridSearchTool 返回格式一致
    """
    logger = logging.getLogger(__name__)

    # 检查缓存
    cached = self._get_from_cache(query)
    if cached is not None:
        return cached

    # ===== 阶段 1: 粗筛 =====
    logger.info(f"[LLM_TREE_SEARCH][STAGE1] 开始粗筛: query='{query[:30]}...'")

    try:
        hybrid_result = self._hybrid_search(query=query, top_k=20)
        logger.info(f"[LLM_TREE_SEARCH][STAGE1] 粗筛完成")
    except Exception as e:
        logger.error(f"[LLM_TREE_SEARCH][STAGE1] 粗筛失败: {e}")
        # 粗筛失败，直接返回错误
        return json.dumps({"error": f"检索失败: {str(e)}"}, ensure_ascii=False)

    # 解析 HybridSearchTool 结果
    try:
        hybrid_data = json.loads(hybrid_result)
        if "error" in hybrid_data:
            return hybrid_result
        search_results = hybrid_data if isinstance(hybrid_data, list) else hybrid_data.get("results", [])
    except json.JSONDecodeError:
        search_results = []

    if not search_results:
        return json.dumps([], ensure_ascii=False)

    # 继续实现阶段 2...
    # TODO: 下一步实现
    return hybrid_result  # 临时返回
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_stage1_hybrid_search_called -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/tools.py backend/deeppdf-api/tests/test_llm_tree_search_tool.py
git commit -m "feat(agent): 实现阶段 1 粗筛逻辑"
```

---

## Task 5: 实现阶段 2 - 精排（LLM 推理）

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py`
- Test: `backend/deeppdf-api/tests/test_llm_tree_search_tool.py`

**Step 1: Write the failing test**

```python
def test_stage2_llm_called():
    """测试阶段 2 调用 LLM"""
    from deeppdf.agent.prompt_builder import PromptBuilder

    hybrid_mock = Mock(return_value=''[
        {"text": "result1", "metadata": {"node_id": "0001", "page": 1}},
        {"text": "result2", "metadata": {"node_id": "0002", "page": 2}}
    ]''')

    locator = Mock()
    locator.generate_citation_metadata.side_effect = [
        {"node_id": "0001", "obsidian_link": "[[c1.md#^page-1]]", "page": 1, "text": "result1"},
        {"node_id": "0002", "obsidian_link": "[[c2.md#^page-2]]", "page": 2, "text": "result2"},
    ]

    llm_mock = Mock(return_value='''{"thinking": "Both nodes are relevant", "node_list": ["0001", "0002"]}''')

    tool = LLMTreeSearchTool(
        hybrid_search_tool=hybrid_mock,
        markdown_locator=locator,
        node_map={
            "0001": {"title": "Chapter 1", "node_id": "0001", "summary": "Summary 1", "start_index": 1},
            "0002": {"title": "Chapter 2", "node_id": "0002", "summary": "Summary 2", "start_index": 2},
        },
        llm_client=llm_mock,
    )

    result = tool(query="test query")
    result_data = json.loads(result)

    # 验证 LLM 被调用
    assert llm_mock.called
    # 验证返回格式正确
    assert len(result_data) == 2
    assert result_data[0]["obsidian_link"] == "[[c1.md#^page-1]]"
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_stage2_llm_called -v`

Expected: 测试失败，阶段 2 尚未实现

**Step 3: Implement stage 2 logic**

更新 `__call__` 方法，添加阶段 2 实现：

```python
# 更新 __call__ 方法，替换 "TODO" 部分

    # ===== 阶段 2: 精排 =====
    # 构建候选子树
    candidate_tree = self._build_candidate_tree(search_results)
    node_count = self._count_nodes(candidate_tree)

    logger.info(f"[LLM_TREE_SEARCH][STAGE2] 候选子树: {node_count} 个节点")

    # 选择 LLM 模型
    model_name = self._select_model(node_count)
    logger.info(f"[LLM_TREE_SEARCH][STAGE2] 使用模型: {model_name}")

    # 构建 Prompt
    from deeppdf.agent.prompt_builder import PromptBuilder
    prompt_builder = PromptBuilder()
    prompt = prompt_builder.build(query, candidate_tree)

    # 调用 LLM
    try:
        llm_response = self._llm_client.chat(prompt)
        logger.info(f"[LLM_TREE_SEARCH][STAGE2] LLM 响应成功")
    except Exception as e:
        logger.warning(f"[LLM_TREE_SEARCH][FALLBACK] LLM 调用失败，回退到 hybrid_search: {e}")
        self._save_to_cache(query, hybrid_result)
        return hybrid_result

    # 解析 LLM 响应
    try:
        llm_data = self._extract_json(llm_response)
        node_list = llm_data.get("node_list", [])
    except Exception as e:
        logger.warning(f"[LLM_TREE_SEARCH][FALLBACK] JSON 解析失败，回退到 hybrid_search: {e}")
        self._save_to_cache(query, hybrid_result)
        return hybrid_result

    if not node_list:
        logger.warning("[LLM_TREE_SEARCH][FALLBACK] 空结果，使用 hybrid_search 原始结果")
        self._save_to_cache(query, hybrid_result)
        return hybrid_result

    # 生成最终结果
    final_results = self._generate_results(node_list)
    result_json = json.dumps(final_results, ensure_ascii=False)

    # 缓存并返回
    self._save_to_cache(query, result_json)
    logger.info(f"[LLM_TREE_SEARCH][RESULT] 返回 {len(final_results)} 个节点")

    return result_json
```

添加辅助方法：

```python
# 在 LLMTreeSearchTool 类中添加辅助方法

def _build_candidate_tree(self, search_results: list) -> Dict[str, Any]:
    """从搜索结果构建候选子树"""
    tree_nodes = []
    for result in search_results:
        metadata = result.get("metadata", {})
        node_id = metadata.get("node_id")
        if node_id and node_id in self._node_map:
            node = self._node_map[node_id].copy()
            # 只保留必要字段
            tree_nodes.append({
                "title": node.get("title", ""),
                "node_id": node_id,
                "summary": node.get("summary", ""),
                "prefix_summary": node.get("prefix_summary", ""),
                "start_index": node.get("start_index"),
            })

    return {"structure": tree_nodes}

def _count_nodes(self, tree: Dict[str, Any]) -> int:
    """统计树节点数量"""
    def count(node):
        total = 1
        for child in node.get("nodes", []):
            total += count(child)
        return total

    return sum(count(node) for node in tree.get("structure", []))

def _select_model(self, node_count: int) -> str:
    """根据节点数量选择 LLM 模型"""
    # 简化实现：实际可以根据配置选择不同模型
    return "lightweight" if node_count <= 10 else "reasoning"

def _extract_json(self, response: str) -> Dict[str, Any]:
    """从 LLM 响应中提取 JSON"""
    try:
        # 尝试直接解析
        return json.loads(response)
    except json.JSONDecodeError:
        # 尝试提取 ```json``` 代码块
        if "```json" in response:
            start = response.find("```json") + 7
            end = response.rfind("```")
            if end > start:
                return json.loads(response[start:end].strip())
        raise

def _generate_results(self, node_list: list) -> list:
    """根据 node_list 生成最终结果"""
    results = []
    for node_id in node_list:
        if node_id not in self._node_map:
            logger.warning(f"[LLM_TREE_SEARCH][RESULT] node_id {node_id} 不在 node_map 中")
            continue

        node = self._node_map[node_id]
        citation = self._markdown_locator.generate_citation_metadata(
            node_id=node_id,
            page_num=node.get("start_index"),
            text=node.get("text", "")[:500],
        )
        results.append(citation)

    return results
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_llm_tree_search_tool.py::test_stage2_llm_called -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/tools.py backend/deeppdf-api/tests/test_llm_tree_search_tool.py
git commit -m "feat(agent): 实现阶段 2 精排逻辑"
```

---

## Task 6: 注册 LLMTreeSearchTool 到工具执行器

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/executor.py`
- Test: `backend/deeppdf-api/tests/test_executor.py`

**Step 1: Write the failing test**

```python
def test_tool_executor_includes_llm_tree_search():
    """测试工具执行器包含 LLMTreeSearchTool"""
    from deeppdf.agent.tools import LLMTreeSearchTool

    executor = create_tool_executor(
        index_id="test_id",
        storage_dir="/tmp/test",
        tree_structure={"structure": []},
        pageindex_lib_path=None,
        markdown_locator=None,
        enable_llm_tree_search=True,  # 新参数
    )

    assert "llm_tree_search" in executor.tools
    assert isinstance(executor.tools["llm_tree_search"], LLMTreeSearchTool)

def test_tool_executor_llm_tree_search_optional():
    """测试 LLMTreeSearchTool 是可选的"""
    executor = create_tool_executor(
        index_id="test_id",
        storage_dir="/tmp/test",
        tree_structure={"structure": []},
        pageindex_lib_path=None,
        markdown_locator=None,
        enable_llm_tree_search=False,  # 禁用
    )

    assert "llm_tree_search" not in executor.tools
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_executor.py::test_tool_executor_includes_llm_tree_search -v`

Expected: 测试失败，`create_tool_executor` 尚不支持 `enable_llm_tree_search` 参数

**Step 3: Implement tool registration**

更新 `executor.py`:

```python
# 在 executor.py 顶部导入
from .tools import Tool, InspectTocTool, ReadPageTool, HybridSearchTool, LLMTreeSearchTool

# 更新 create_tool_executor 函数签名
def create_tool_executor(
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    pageindex_lib_path: Optional[str] = None,
    markdown_locator: Optional[MarkdownLocator] = None,
    enable_llm_tree_search: bool = False,  # 新参数
    llm_client: Optional[Any] = None,  # 新参数
) -> ToolExecutor:
    """
    创建并配置工具执行器

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        tree_structure: 树状结构（来自 index_metadata）
        pageindex_lib_path: PageIndex 库路径（可选）
        markdown_locator: Markdown 定位器（可选，用于生成引用链接）
        enable_llm_tree_search: 是否启用 LLM 树搜索工具（默认 False）
        llm_client: LLM 客户端（启用 LLMTreeSearchTool 时必需）

    Returns:
        配置好的 ToolExecutor 实例
    """
    tools: Dict[str, Tool] = {}

    # 1. InspectTocTool - 查看目录
    tools["inspect_toc"] = InspectTocTool(tree_structure)

    # 2. HybridSearchTool - 快速检索
    tools["hybrid_search"] = HybridSearchTool(
        index_id, storage_dir, markdown_locator=markdown_locator
    )

    # 3. LLMTreeSearchTool - LLM 树搜索（可选）
    if enable_llm_tree_search:
        if not llm_client:
            logger.warning("[工具初始化] 未提供 llm_client，LLMTreeSearchTool 将不可用")
        else:
            # 创建 node_map
            from pageindex.utils import create_node_mapping
            node_map = create_node_mapping({"structure": tree_structure.get("structure", [])})

            tools["llm_tree_search"] = LLMTreeSearchTool(
                hybrid_search_tool=tools["hybrid_search"],
                markdown_locator=markdown_locator,
                node_map=node_map,
                llm_client=llm_client,
            )
            logger.info("[工具初始化] LLMTreeSearchTool 已启用")

    # 4. ReadPageTool - 按页读取（需要 PageIndex）
    if pageindex_lib_path:
        tools["read_page"] = ReadPageTool(pageindex_lib_path, index_id, storage_dir)
    else:
        logger.warning("[工具初始化] 未提供 pageindex_lib_path，read_page 工具将不可用")

    # 如果提供了 markdown_locator，存储在 ToolExecutor 中供后续使用
    executor = ToolExecutor(tools)
    if markdown_locator:
        executor.markdown_locator = markdown_locator
        logger.info("[工具初始化] MarkdownLocator 已注入到 ToolExecutor")

    return executor
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_executor.py::test_tool_executor_includes_llm_tree_search -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/executor.py backend/deeppdf-api/tests/test_executor.py
git commit -m "feat(agent): 注册 LLMTreeSearchTool 到工具执行器"
```

---

## Task 7: 更新 DeepPDFAgent 支持新工具

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/core.py`
- Test: `backend/deeppdf-api/tests/test_core.py`

**Step 1: Write the failing test**

```python
def test_agent_with_llm_tree_search_enabled():
    """测试 Agent 启用 LLMTreeSearchTool"""
    from unittest.mock import patch

    tree_structure = {"structure": [{"title": "Test", "node_id": "0001"}]}

    with patch('deeppdf.agent.core.create_tool_executor') as mock_executor:
        agent = DeepPDFAgent(
            index_id="test",
            storage_dir="/tmp",
            tree_structure=tree_structure,
            enable_llm_tree_search=True,  # 新参数
        )

        # 验证 create_tool_executor 被正确调用
        mock_executor.assert_called_once()
        call_kwargs = mock_executor.call_args[1]
        assert call_kwargs.get("enable_llm_tree_search") is True
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_core.py::test_agent_with_llm_tree_search_enabled -v`

Expected: 测试失败，`DeepPDFAgent` 不支持 `enable_llm_tree_search` 参数

**Step 3: Implement agent support**

更新 `core.py` 中 `DeepPDFAgent.__init__`:

```python
# 更新 __init__ 方法签名
def __init__(
    self,
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    *,
    index_metadata: Optional[Dict[str, Any]] = None,
    llm_provider: str = "deepseek",
    llm_model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    pageindex_lib_path: Optional[str] = None,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    max_iterations: Optional[int] = None,
    enable_llm_tree_search: bool = False,  # 新参数
):
    """
    初始化 DeepPDFAgent

    Args:
        index_id: PDF 索引 ID
        storage_dir: 存储目录路径
        tree_structure: 文档树状结构 (来自 index_metadata)
        index_metadata: 完整的索引元数据（包含 markdown_files 映射）
        llm_provider: LLM 提供商 (deepseek, openai, anthropic)
        llm_model: 模型名称 (默认根据 provider 自动选择)
        api_key: API 密钥 (如果为 None，从环境变量读取)
        base_url: API 基础 URL (如果为 None，使用 provider 默认值)
        pageindex_lib_path: PageIndex 库路径 (用于 read_page 工具)
        temperature: 采样温度
        top_p: nucleus 采样参数
        max_iterations: 最大工具调用迭代次数
        enable_llm_tree_search: 是否启用 LLM 树搜索工具 (默认 False)
    """
    # ... (保留现有初始化代码)

    # 初始化工具执行器（更新调用）
    self.executor: ToolExecutor = create_tool_executor(
        index_id=index_id,
        storage_dir=storage_dir,
        tree_structure=tree_structure,
        pageindex_lib_path=pageindex_lib_path,
        markdown_locator=markdown_locator,
        enable_llm_tree_search=enable_llm_tree_search,
        llm_client=self.client if enable_llm_tree_search else None,
    )
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_core.py::test_agent_with_llm_tree_search_enabled -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/core.py backend/deeppdf-api/tests/test_core.py
git commit -m "feat(agent): 更新 DeepPDFAgent 支持 LLMTreeSearchTool"
```

---

## Task 8: 添加 API 路由支持

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`
- Test: `backend/deeppdf-api/tests/test_api_routes.py`

**Step 1: Write the failing test**

```python
def test_chat_with_llm_tree_search():
    """测试聊天 API 支持 enable_llm_tree_search 参数"""
    # 需要先有一个已索引的文档
    response = client.post("/api/chat", json={
        "index_id": "test_index",
        "message": "分析文档中各章节的关系",
        "enable_llm_tree_search": True,  # 新参数
    })

    assert response.status_code == 200
    # 验证 Agent 被正确初始化
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_api_routes.py::test_chat_with_llm_tree_search -v`

Expected: 测试失败，API 不支持 `enable_llm_tree_search` 参数

**Step 3: Implement API support**

更新 `routes.py` 中的聊天端点：

```python
# 在聊天路由中添加新参数
@app.post("/api/chat")
async def chat_completion(request: ChatRequest):
    """
    聊天完成接口
    """
    try:
        # ... (现有代码)

        # 创建 Agent（更新参数）
        agent = DeepPDFAgent(
            index_id=request.index_id,
            storage_dir=storage_dir,
            tree_structure=index_metadata.get("tree_structure", {}),
            index_metadata=index_metadata,
            enable_llm_tree_search=getattr(request, "enable_llm_tree_search", False),
        )

        # ... (其余代码保持不变)
```

同时更新 `ChatRequest` 模型：

```python
# 在 models.py 中更新
class ChatRequest(BaseModel):
    """聊天请求模型"""
    index_id: str
    message: str
    enable_llm_tree_search: bool = False  # 新字段
    # ... (其他字段)
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_api_routes.py::test_chat_with_llm_tree_search -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/routes.py backend/deeppdf-api/src/deeppdf/api/models.py backend/deeppdf-api/tests/test_api_routes.py
git commit -m "feat(api): 添加 enable_llm_tree_search 参数支持"
```

---

## Task 9: 集成测试

**Files:**
- Create: `backend/deeppdf-api/tests/integration/test_llm_tree_search_e2e.py`

**Step 1: Write the integration test**

```python
# tests/integration/test_llm_tree_search_e2e.py
"""
LLMTreeSearchTool 端到端集成测试
"""
import pytest
from unittest.mock import Mock, patch

@pytest.fixture
def mock_index_metadata():
    return {
        "pdf_name": "test.pdf",
        "tree_structure": {
            "structure": [
                {
                    "title": "Chapter 1",
                    "node_id": "0001",
                    "summary": "Introduction to the topic",
                    "start_index": 1,
                    "end_index": 5,
                },
                {
                    "title": "Chapter 2",
                    "node_id": "0002",
                    "summary": "Deep dive into details",
                    "start_index": 6,
                    "end_index": 10,
                },
            ]
        },
        "markdown_files": {
            "0001": "chapter1.md",
            "0002": "chapter2.md",
        },
    }

@pytest.mark.integration
def test_llm_tree_search_full_flow(mock_index_metadata):
    """测试完整的 LLM 树搜索流程"""
    from deeppdf.agent.core import DeepPDFAgent

    # Mock LLM 响应
    mock_llm_response = '{"thinking": "Chapter 1 is relevant", "node_list": ["0001"]}'

    with patch('deeppdf.agent.core.OpenAI') as mock_client_class:
        mock_client = Mock()
        mock_client.chat.return_value = mock_llm_response
        mock_client_class.return_value = mock_client

        # 创建 Agent
        agent = DeepPDFAgent(
            index_id="test",
            storage_dir="/tmp/test",
            tree_structure=mock_index_metadata["tree_structure"],
            index_metadata=mock_index_metadata,
            enable_llm_tree_search=True,
        )

        # 验证工具已注册
        assert "llm_tree_search" in agent.executor.tools

        # 模拟聊天
        responses = list(agent.chat("What is this about?"))
        assert len(responses) > 0

@pytest.mark.integration
def test_llm_tree_search_fallback_to_hybrid(mock_index_metadata):
    """测试 LLM 失败时回退到 hybrid_search"""
    from deeppdf.agent.core import DeepPDFAgent

    with patch('deeppdf.agent.core.OpenAI') as mock_client_class:
        mock_client = Mock()
        # 模拟 LLM 调用失败
        mock_client.chat.side_effect = Exception("API Error")
        mock_client_class.return_value = mock_client

        agent = DeepPDFAgent(
            index_id="test",
            storage_dir="/tmp/test",
            tree_structure=mock_index_metadata["tree_structure"],
            index_metadata=mock_index_metadata,
            enable_llm_tree_search=True,
        )

        # Agent 应该仍然能工作（回退到 hybrid_search）
        responses = list(agent.chat("What is this about?"))
        # 验证没有崩溃
        assert True
```

**Step 2: Run integration tests**

Run: `cd backend/deeppdf-api && uv run pytest tests/integration/test_llm_tree_search_e2e.py -v`

Expected: PASS (2 passed)

**Step 3: Commit**

```bash
git add backend/deeppdf-api/tests/integration/test_llm_tree_search_e2e.py
git commit -m "test(agent): 添加 LLMTreeSearchTool 集成测试"
```

---

## Task 10: 文档更新

**Files:**
- Modify: `README.md` 或相关文档
- Create: `docs/llm-tree-search-guide.md`

**Step 1: Update README**

在 README 中添加新功能说明：

```markdown
## Agent 工具

DeepPDFAgent 支持以下检索工具：

| 工具 | 适用场景 |
|------|----------|
| `hybrid_search` | 特定内容定位、关键词查找、向量相似度匹配 |
| `llm_tree_search` | 跨章节推理、模糊问题、需要理解文档逻辑 |

### 启用 LLM 树搜索

```python
agent = DeepPDFAgent(
    index_id="...",
    enable_llm_tree_search=True,
)
```

或在 API 调用中：

```bash
curl -X POST http://localhost:6088/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "index_id": "...",
    "message": "分析文档中各章节的关系",
    "enable_llm_tree_search": true
  }'
```
```

**Step 2: Create detailed guide**

```markdown
# LLM 树搜索指南

## 概述

LLM 树搜索是 DeepPDF 的高级检索功能，通过 LLM 理解文档逻辑结构来回答复杂问题。

## 使用场景

- 跨章节推理：如"XXX 在不同章节中的观点变化"
- 模糊问题：如"作者对 XXX 的态度"
- 文档整体理解：如"总结文档的核心论点"

## 架构

两阶段检索：
1. 粗筛：使用 HybridSearchTool 快速获取 Top-20 候选
2. 精排：LLM 对候选子树进行推理，选择最相关节点

## 日志标识

所有 LLM 树搜索日志使用 `[LLM_TREE_SEARCH]` 前缀。
```

**Step 3: Commit**

```bash
git add README.md docs/llm-tree-search-guide.md
git commit -m "docs: 添加 LLM 树搜索功能文档"
```

---

## Task 11: 最终验证

**Step 1: Run all tests**

```bash
cd backend/deeppdf-api
uv run pytest tests/ -v --cov=src/deeppdf/agent
```

Expected: All tests pass, coverage report generated

**Step 2: Manual verification**

启动服务器并测试：

```bash
cd backend/deeppdf-api
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio
```

发送测试请求：

```bash
curl -X POST http://localhost:6088/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "index_id": "your_index_id",
    "message": "分析文档的核心论点",
    "enable_llm_tree_search": true
  }'
```

检查日志中的 `[LLM_TREE_SEARCH]` 标识，验证：
- `[STAGE1]` 粗筛日志
- `[STAGE2]` 精排日志
- `[RESULT]` 结果日志
- 如果触发回退，应有 `[FALLBACK]` 日志

**Step 3: Final commit**

```bash
git add .
git commit -m "feat(agent): 完成 LLMTreeSearchTool 实现"
```

---

## 总结

此实现计划包含 11 个任务，涵盖：

1. **PromptBuilder** - 动态 Prompt 构建工具
2. **LLMTreeSearchTool** - 核心检索工具
3. **两阶段检索** - 粗筛 + 精排架构
4. **优雅降级** - 失败时回退到 hybrid_search
5. **缓存机制** - 5 分钟 TTL
6. **API 集成** - 端到端支持
7. **完整测试** - 单元测试 + 集成测试
8. **文档** - 用户指南 + 日志标识

所有实现遵循 TDD 原则，每个任务包含：写测试 → 运行失败 → 实现代码 → 测试通过 → 提交。
