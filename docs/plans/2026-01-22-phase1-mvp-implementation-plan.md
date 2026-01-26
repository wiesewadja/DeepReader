# Phase 1 (MVP) 完整实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**项目范围:** DeepPDF Phase 1 MVP - 前后端完整实现

**目标:**
1. **后端 Agent 系统** - 实现基于 ReAct 的智能 Agent，支持快速检索和深度阅读双轨处理
2. **前端 UI 改造** - 添加 Agent 模式切换、思考过程可视化、工具调用展示

**架构:**
- 后端：基于 LLM Tool Calling 的 ReAct Agent
- 前端：流式 SSE 通信 + 可视化组件

**Tech Stack:**
- 后端：Python 3.10+, FastAPI, DeepSeek/OpenAI API, PageIndex, ChromaDB
- 前端：TypeScript, Lit, MobX, EventSource

---

## 项目结构概览

### 后端目录结构
```
deeppdf-api/src/deeppdf/
├── agent/                      # 【新增】Agent 核心模块
│   ├── __init__.py
│   ├── core.py                 # DeepPDFAgent 主类
│   ├── tools.py                # 工具定义与注册
│   ├── prompts.py              # System Prompt 与路由逻辑
│   ├── executor.py             # 工具执行器（安全沙箱）
│   └── tests/                  # Agent 单元测试
│       ├── test_tools.py
│       ├── test_executor.py
│       ├── test_prompts.py
│       └── test_core.py
│
├── api/
│   ├── routes.py               # 【修改】新增 /api/chat/agent 端点
│   └── models.py               # 【修改】新增 Agent 请求/响应模型
│
├── services/
│   ├── smart_search.py         # 【复用】混合检索
│   ├── querier.py              # 【复用】查询服务
│   └── ...
│
├── storage/
│   └── ...
│
├── config.py
└── main.py
```

### 前端目录结构
```
frontend/src/
├── components/
│   ├── agent-mode-toggle/      # 【新增】Agent 模式切换
│   │   └── agent-mode-toggle.ts
│   ├── agent-message/          # 【新增】Agent 消息显示
│   │   └── agent-message.ts
│   ├── chat-input/             # 【修改】集成模式切换
│   ├── message-list/           # 【修改】支持 Agent 消息
│   └── ...
│
├── api/
│   ├── agent-api.ts            # 【新增】Agent API 客户端
│   ├── http-client.ts          # 【修改】SSE 支持
│   └── ...
│
├── stores/
│   └── app-state.ts            # 【修改】集成 Agent 状态
│
└── styles.css                  # 【修改】Agent 主题样式
```

---

## 任务清单

### 第一部分: 工具层 (Tools Layer)
- [x] **Task 1:** 实现 InspectTocTool - 目录查看工具
- [x] **Task 2:** 实现 ReadPageTool - 按页读取工具
- [x] **Task 3:** 实现 HybridSearchTool - 混合检索工具
- [x] **Task 4:** 实现工具执行器 ToolExecutor

### 第二部分: Prompt 层
- [x] **Task 5:** 实现 System Prompt 和 Few-Shot 示例

### 第三部分: Core 层
- [x] **Task 6:** 实现 DeepPDFAgent 核心类

### 第四部分: API 集成
- [x] **Task 7:** 添加 Agent API 端点

### 第五部分: 前端改造
- [x] **Task 8:** 添加 Agent 模式切换组件
- [x] **Task 9:** 实现 Agent 消息显示组件
- [x] **Task 10:** 实现 Agent API 调用
- [x] **Task 11:** 添加 Agent 样式优化

### 第六部分: 验收测试
- [x] **Task 12:** 端到端测试

---

## 前置准备

### Task 0: 环境验证

**目的:** 确保开发环境配置正确

**Step 1: 验证 Python 版本**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
python --version
# 期望输出: Python 3.10.x 或更高
```

**Step 2: 验证依赖已安装**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pip list | grep -E "fastapi|openai|pydantic|chromadb"
```

期望输出包含: fastapi, openai, pydantic, chromadb

**Step 3: 创建 agent 模块目录**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api/src/deeppdf
mkdir -p agent
touch agent/__init__.py
```

验证目录创建成功:
```bash
ls -la agent/
# 期望输出: __init__.py
```

---

## 第一部分: 工具层 (Tools Layer)

### Task 1: 实现 InspectTocTool

**目的:** 让 Agent 能够查看文档目录结构，理解章节组织

**Files:**
- Create: `src/deeppdf/agent/tools.py`

**Step 1: 创建工具协议定义**

```python
# src/deeppdf/agent/tools.py
"""
Agent 工具定义

为 DeepPDFAgent 提供可调用的工具集合
"""
from typing import Protocol, Dict, Any, List, Optional
from typing_extensions import TypedDict


class Tool(Protocol):
    """工具协议 - 所有工具必须实现此接口"""
    name: str
    description: str

    def __call__(self, **kwargs) -> str:
        """执行工具，返回字符串结果"""
        ...


class ToolResult(TypedDict):
    """工具执行结果"""
    success: bool
    result: str
    error: Optional[str]
```

运行: `touch src/deeppdf/agent/tools.py`

**Step 2: 实现 InspectTocTool**

编辑 `src/deeppdf/agent/tools.py`，添加:

```python
class InspectTocTool:
    """目录检查工具 - 返回文档的章节结构"""

    name: str = "inspect_toc"
    description: str = (
        "查看 PDF 文档的目录结构，返回章节标题和页码范围。"
        "适用于需要了解文档整体结构或定位特定章节的场景。"
        "无需任何参数。"
    )

    def __init__(self, tree_structure: Dict[str, Any]):
        """
        初始化工具

        Args:
            tree_structure: PageIndex 生成的树状结构，来自 index_metadata
        """
        self.tree_structure = tree_structure

    def __call__(self, **kwargs) -> str:
        """返回目录结构的可读文本"""
        structure = self.tree_structure.get("structure", [])

        if not structure:
            return "错误: 文档没有目录结构"

        lines = ["# 文档目录结构\n"]

        for node in structure:
            lines.extend(self._format_node(node, level=0))

        return "\n".join(lines)

    def _format_node(self, node: Dict[str, Any], level: int) -> List[str]:
        """递归格式化节点为可读文本"""
        indent = "  " * level
        title = node.get("title", "未命名章节")
        start_page = node.get("start_index", "?")
        end_page = node.get("end_index", "?")
        node_id = node.get("node_id", "")

        lines = [
            f"{indent}- {title} (第 {start_page}-{end_page} 页) [ID: {node_id}]"
        ]

        # 递归处理子节点
        for child in node.get("nodes", []):
            lines.extend(self._format_node(child, level + 1))

        return lines
```

**Step 3: 编写单元测试**

创建测试文件: `touch src/deeppdf/agent/tests/test_tools.py`

```python
# src/deeppdf/agent/tests/test_tools.py
"""工具模块单元测试"""
import pytest
from deeppdf.agent.tools import InspectTocTool


def test_inspect_toc_with_valid_structure():
    """测试: 正常目录结构"""
    tree_structure = {
        "structure": [
            {
                "title": "第一章：引言",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": [
                    {
                        "title": "1.1 研究背景",
                        "node_id": "node_1_1",
                        "start_index": 1,
                        "end_index": 5,
                        "nodes": []
                    }
                ]
            },
            {
                "title": "第二章：方法",
                "node_id": "node_2",
                "start_index": 11,
                "end_index": 20,
                "nodes": []
            }
        ]
    }

    tool = InspectTocTool(tree_structure)
    result = tool()

    assert "第一章：引言" in result
    assert "第 1-10 页" in result
    assert "1.1 研究背景" in result
    assert "第二章：方法" in result


def test_inspect_toc_with_empty_structure():
    """测试: 空目录结构"""
    tool = InspectTocTool({"structure": []})
    result = tool()

    assert "没有目录结构" in result


def test_inspect_toc_with_nested_structure():
    """测试: 多层嵌套结构"""
    tree_structure = {
        "structure": [
            {
                "title": "第一篇",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 100,
                "nodes": [
                    {
                        "title": "第一章",
                        "node_id": "node_1_1",
                        "start_index": 1,
                        "end_index": 50,
                        "nodes": [
                            {
                                "title": "1.1 小节",
                                "node_id": "node_1_1_1",
                                "start_index": 1,
                                "end_index": 10,
                                "nodes": []
                            }
                        ]
                    }
                ]
            }
        ]
    }

    tool = InspectTocTool(tree_structure)
    result = tool()

    assert "第一篇" in result
    assert "    第一章" in result  # 缩进2空格
    assert "      1.1 小节" in result  # 缩进4空格
```

**Step 4: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_tools.py -v
```

期望输出: `PASSED test_inspect_toc_with_valid_structure` 等 3 个测试全部通过

**Step 5: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/
git commit -m "feat(agent): 实现 InspectTocTool 工具

- 添加工具协议定义 (Tool Protocol)
- 实现 InspectTocTool 用于查看文档目录
- 支持递归格式化多层嵌套结构
- 添加完整的单元测试覆盖
"
```

---

### Task 2: 实现 ReadPageTool

**目的:** 让 Agent 能够按页读取 PDF 内容，获取精确的原文片段

**Files:**
- Modify: `src/deeppdf/agent/tools.py`

**Step 1: 实现 ReadPageTool 类**

编辑 `src/deeppdf/agent/tools.py`，在文件末尾添加:

```python
class ReadPageTool:
    """按页读取工具 - 从指定页码读取 PDF 内容"""

    name: str = "read_page"
    description: str = (
        "读取 PDF 指定页码的完整内容，返回带段落标记的原始文本。"
        "适用于需要精确引用或深入分析特定页面的场景。"
        "参数: page_num (int, 必需) - 要读取的页码（从1开始）"
    )

    def __init__(self, pageindex_lib_path: str, index_id: str, storage_dir: str):
        """
        初始化工具

        Args:
            pageindex_lib_path: PageIndex 库的路径
            index_id: 索引 ID
            storage_dir: 存储目录
        """
        self.pageindex_lib_path = pageindex_lib_path
        self.index_id = index_id
        self.storage_dir = storage_dir
        self._pi = None  # 延迟加载

    def _load_page_index(self):
        """延迟加载 PageIndex 实例"""
        if self._pi is None:
            import sys
            sys.path.insert(0, self.pageindex_lib_path)

            from pageindex import PageIndex

            md_path = f"{self.storage_dir}/indexes/{self.index_id}.md"
            self._pi = PageIndex.from_file(md_path)

        return self._pi

    def __call__(self, page_num: int, **kwargs) -> str:
        """
        读取指定页码的内容

        Args:
            page_num: 页码（从 1 开始）

        Returns:
            页面文本内容，带段落标记
        """
        try:
            pi = self._load_page_index()

            # 验证页码范围
            if page_num < 1 or page_num > pi.page_count:
                return f"错误: 页码 {page_num} 超出范围（文档共 {pi.page_count} 页）"

            # 获取页面文本
            text = pi.get_text_with_tags(page_num)

            return f"# 第 {page_num} 页内容\n\n{text}"

        except Exception as e:
            return f"错误: 读取页面失败 - {str(e)}"
```

**Step 2: 添加 Mock 测试**

编辑 `src/deeppdf/agent/tests/test_tools.py`，添加:

```python
from unittest.mock import Mock, MagicMock
import os


def test_read_page_with_valid_page():
    """测试: 读取有效页码"""
    # Mock PageIndex 实例
    mock_pi = Mock()
    mock_pi.page_count = 100
    mock_pi.get_text_with_tags.return_value = "这是第一页的内容\n<physical_index_1>"

    # Mock PageIndex.from_file
    with pytest.mock.patch('deeppdf.agent.tools.PageIndex') as mock_pageindex:
        mock_pageindex.from_file.return_value = mock_pi

        from deeppdf.agent.tools import ReadPageTool

        tool = ReadPageTool(
            pageindex_lib_path="/fake/path",
            index_id="test_idx",
            storage_dir="/fake/storage"
        )
        result = tool(page_num=1)

        assert "第 1 页内容" in result
        assert "这是第一页的内容" in result
        mock_pi.get_text_with_tags.assert_called_once_with(1)


def test_read_page_with_invalid_page():
    """测试: 读取超出范围的页码"""
    mock_pi = Mock()
    mock_pi.page_count = 10

    with pytest.mock.patch('deeppdf.agent.tools.PageIndex') as mock_pageindex:
        mock_pageindex.from_file.return_value = mock_pi

        from deeppdf.agent.tools import ReadPageTool

        tool = ReadPageTool(
            pageindex_lib_path="/fake/path",
            index_id="test_idx",
            storage_dir="/fake/storage"
        )
        result = tool(page_num=999)

        assert "错误" in result
        assert "超出范围" in result
        assert "10 页" in result


def test_read_page_with_error():
    """测试: PageIndex 加载失败"""
    with pytest.mock.patch('deeppdf.agent.tools.PageIndex') as mock_pageindex:
        mock_pageindex.from_file.side_effect = Exception("文件不存在")

        from deeppdf.agent.tools import ReadPageTool

        tool = ReadPageTool(
            pageindex_lib_path="/fake/path",
            index_id="test_idx",
            storage_dir="/fake/storage"
        )
        result = tool(page_num=1)

        assert "错误" in result
        assert "读取页面失败" in result
```

**Step 3: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_tools.py::test_read_page_with_valid_page -v
pytest src/deeppdf/agent/tests/test_tools.py::test_read_page_with_invalid_page -v
pytest src/deeppdf/agent/tests/test_tools.py::test_read_page_with_error -v
```

期望输出: 全部 PASSED

**Step 4: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/tools.py src/deeppdf/agent/tests/test_tools.py
git commit -m "feat(agent): 实现 ReadPageTool 工具

- 支持按页码读取 PDF 原始内容
- 延迟加载 PageIndex 实例优化性能
- 添加页码范围验证和错误处理
- 完整的 Mock 单元测试覆盖
"
```

---

### Task 3: 实现 HybridSearchTool

**目的:** 封装现有的混合检索功能，让 Agent 能够快速查找关键词

**Files:**
- Modify: `src/deeppdf/agent/tools.py`

**Step 1: 实现 HybridSearchTool 类**

编辑 `src/deeppdf/agent/tools.py`，在文件末尾添加:

```python
class HybridSearchTool:
    """混合检索工具 - 结合标题匹配、BM25 和向量检索"""

    name: str = "hybrid_search"
    description: str = (
        "快速检索与查询相关的文档片段。"
        "适用于简单事实查询（如'某事发生在哪年'）。"
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 返回结果数，默认5"
    )

    def __init__(self, index_id: str, storage_dir: str):
        """
        初始化工具

        Args:
            index_id: 索引 ID
            storage_dir: 存储目录
        """
        self.index_id = index_id
        self.storage_dir = storage_dir

    def __call__(self, query: str, top_k: int = 5, **kwargs) -> str:
        """
        执行混合检索

        Args:
            query: 搜索查询
            top_k: 返回结果数量

        Returns:
            检索结果的可读文本
        """
        try:
            import asyncio
            from deeppdf.services.querier import query_pdf

            # 异步调用 query_pdf
            result = asyncio.run(query_pdf(
                query=query,
                index_id=self.index_id,
                storage_dir=self.storage_dir,
                max_results=top_k
            ))

            if result.get("status") == "error":
                return f"错误: {result.get('error', '检索失败')}"

            results = result.get("results", [])

            if not results:
                return f"未找到与 '{query}' 相关的内容"

            # 格式化结果
            lines = [f"# 检索结果 (共 {len(results)} 条)\n"]

            for i, item in enumerate(results, 1):
                text = item.get("text", "")[:500]
                metadata = item.get("metadata", {})
                section = metadata.get("section", "未知章节")
                score = metadata.get("score", 0)

                lines.append(f"## 结果 {i}: {section}")
                lines.append(f"相关性: {score:.2f}")
                lines.append(f"{text}...")
                lines.append("")

            return "\n".join(lines)

        except Exception as e:
            return f"错误: 检索失败 - {str(e)}"
```

**Step 2: 添加集成测试**

编辑 `src/deeppdf/agent/tests/test_tools.py`，添加:

```python
import pytest
import json
from pathlib import Path


@pytest.fixture
def temp_index_dir(tmp_path):
    """创建临时索引目录"""
    index_dir = tmp_path / "indexes"
    index_dir.mkdir(parents=True)

    # 创建模拟的索引元数据
    metadata = {
        "id": "test_idx",
        "pdf_name": "test.pdf",
        "node_count": 10,
        "tree_structure": {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": []
                }
            ]
        }
    }

    with open(index_dir / "test_idx.json", "w") as f:
        json.dump(metadata, f)

    return str(tmp_path)


def test_hybrid_search_with_results(temp_index_dir, monkeypatch):
    """测试: 有结果的检索"""
    # Mock query_pdf 函数
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "这是搜索结果的内容",
                    "metadata": {
                        "section": "第一章",
                        "score": 0.95
                    }
                }
            ],
            "search_method": "hybrid_title_bm25_vector"
        }

    with pytest.mock.patch('deeppdf.agent.tools.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="测试查询", top_k=5)

        assert "检索结果" in result
        assert "第一章" in result
        assert "0.95" in result


def test_hybrid_search_no_results(temp_index_dir, monkeypatch):
    """测试: 无结果的检索"""
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": []
        }

    with pytest.mock.patch('deeppdf.agent.tools.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="不存在的关键词")

        assert "未找到" in result


def test_hybrid_search_with_error(temp_index_dir, monkeypatch):
    """测试: 检索失败"""
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "error",
            "error": "索引不存在"
        }

    with pytest.mock.patch('deeppdf.agent.tools.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="测试")

        assert "错误" in result
        assert "索引不存在" in result
```

**Step 3: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_tools.py -k hybrid_search -v
```

期望输出: 全部 PASSED

**Step 4: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/tools.py src/deeppdf/agent/tests/test_tools.py
git commit -m "feat(agent): 实现 HybridSearchTool 工具

- 封装 query_pdf 服务为 Agent 工具
- 支持自定义返回结果数量 (top_k)
- 格式化检索结果为可读文本
- 添加集成测试覆盖多种场景
"
```

---

### Task 4: 实现工具注册器

**目的:** 统一管理所有工具，提供工具查找和调用接口

**Files:**
- Create: `src/deeppdf/agent/executor.py`

**Step 1: 实现工具注册器**

```python
# src/deeppdf/agent/executor.py
"""
工具执行器 - 管理和调用 Agent 工具
"""
from typing import Dict, Any, List, Optional
import logging

from .tools import Tool, InspectTocTool, ReadPageTool, HybridSearchTool

logger = logging.getLogger(__name__)


class ToolExecutor:
    """工具执行器 - 安全地执行工具调用"""

    def __init__(self, tools: Dict[str, Tool]):
        """
        初始化执行器

        Args:
            tools: 工具字典 {name: tool_instance}
        """
        self.tools = tools

    def execute(self, tool_name: str, **kwargs) -> str:
        """
        安全执行工具

        Args:
            tool_name: 工具名称
            **kwargs: 工具参数

        Returns:
            执行结果字符串
        """
        if tool_name not in self.tools:
            return f"[ERROR] 未知工具: {tool_name}。可用工具: {', '.join(self.tools.keys())}"

        tool = self.tools[tool_name]

        try:
            logger.info(f"[工具调用] {tool_name} 参数: {kwargs}")
            result = tool(**kwargs)
            logger.info(f"[工具结果] {tool_name} 成功")
            return f"[SUCCESS] {result}"
        except ValueError as e:
            logger.error(f"[工具错误] {tool_name} 参数错误: {e}")
            return f"[ERROR] 参数错误: {e}"
        except FileNotFoundError as e:
            logger.error(f"[工具错误] {tool_name} 文件不存在: {e}")
            return f"[ERROR] 文件不存在，请确认索引有效"
        except Exception as e:
            logger.error(f"[工具错误] {tool_name} 执行失败: {e}", exc_info=True)
            return f"[ERROR] 工具执行失败: {str(e)[:100]}"

    def get_tool_descriptions(self) -> str:
        """
        获取所有工具的描述，用于 System Prompt

        Returns:
            工具描述字符串
        """
        lines = ["## 可用工具\n\n"]

        for name, tool in self.tools.items():
            lines.append(f"### {name}")
            lines.append(f"{tool.description}")
            lines.append("")

        return "\n".join(lines)


def create_tool_executor(
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    pageindex_lib_path: Optional[str] = None
) -> ToolExecutor:
    """
    创建并配置工具执行器

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        tree_structure: 树状结构（来自 index_metadata）
        pageindex_lib_path: PageIndex 库路径（可选）

    Returns:
        配置好的 ToolExecutor 实例
    """
    tools: Dict[str, Tool] = {}

    # 1. InspectTocTool - 查看目录
    tools["inspect_toc"] = InspectTocTool(tree_structure)

    # 2. HybridSearchTool - 快速检索
    tools["hybrid_search"] = HybridSearchTool(index_id, storage_dir)

    # 3. ReadPageTool - 按页读取（需要 PageIndex）
    if pageindex_lib_path:
        tools["read_page"] = ReadPageTool(pageindex_lib_path, index_id, storage_dir)
    else:
        logger.warning("[工具初始化] 未提供 pageindex_lib_path，read_page 工具将不可用")

    return ToolExecutor(tools)
```

**Step 2: 编写测试**

创建测试文件: `touch src/deeppdf/agent/tests/test_executor.py`

```python
# src/deeppdf/agent/tests/test_executor.py
"""工具执行器测试"""
import pytest
from deeppdf.agent.executor import ToolExecutor, create_tool_executor


def test_execute_valid_tool():
    """测试: 执行有效工具"""
    from deeppdf.agent.tools import InspectTocTool

    tool = InspectTocTool({"structure": []})
    executor = ToolExecutor({"test_tool": tool})

    result = executor.execute("test_tool")

    assert "[SUCCESS]" in result


def test_execute_invalid_tool():
    """测试: 执行无效工具"""
    executor = ToolExecutor({})

    result = executor.execute("nonexistent_tool")

    assert "[ERROR]" in result
    assert "未知工具" in result


def test_execute_tool_with_exception():
    """测试: 工具抛出异常"""
    class BrokenTool:
        name = "broken"
        description = "会抛出异常的工具"

        def __call__(self, **kwargs):
            raise ValueError("测试异常")

    executor = ToolExecutor({"broken": BrokenTool()})

    result = executor.execute("broken")

    assert "[ERROR]" in result
    assert "参数错误" in result


def test_get_tool_descriptions():
    """测试: 获取工具描述"""
    from deeppdf.agent.tools import InspectTocTool

    tool = InspectTocTool({"structure": []})
    executor = ToolExecutor({"test_tool": tool})

    descriptions = executor.get_tool_descriptions()

    assert "test_tool" in descriptions
    assert "查看 PDF 文档的目录结构" in descriptions


def test_create_tool_executor():
    """测试: 创建工具执行器"""
    tree_structure = {
        "structure": [
            {
                "title": "测试",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": []
            }
        ]
    }

    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None  # 不包含 read_page
    )

    # 验证工具已注册
    assert "inspect_toc" in executor.tools
    assert "hybrid_search" in executor.tools
    assert "read_page" not in executor.tools  # 未提供 pageindex_lib_path
```

**Step 3: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_executor.py -v
```

期望输出: 全部 PASSED

**Step 4: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/executor.py src/deeppdf/agent/tests/test_executor.py
git commit -m "feat(agent): 实现工具执行器

- 实现 ToolExecutor 统一管理工具调用
- 提供安全的错误处理和日志记录
- 实现 create_tool_executor 工厂函数
- 添加完整的单元测试覆盖
"
```

---

## 第二部分: Prompt 层

### Task 5: 实现 System Prompt

**目的:** 定义 Agent 的行为、能力和路由规则

**Files:**
- Create: `src/deeppdf/agent/prompts.py`

**Step 1: 创建 Prompt 模块**

```python
# src/deeppdf/agent/prompts.py
"""
Agent Prompt 管理 - 定义 System Prompt 和路由逻辑
"""
from typing import Dict, Any, List


# ========== System Prompt 模板 ==========

SYSTEM_PROMPT_TEMPLATE = """
你是一个专业的 PDF 阅读助手，可以帮助用户从文档中提取信息、分析内容。

## 你的能力

### 1. 快速检索 (Fast Track)
**适用场景:** 简单事实查询
- 工具: `hybrid_search(query, top_k)`
- 典型问题:
  - "乔布斯哪年发布的 iPhone?"
  - "什么是深度学习?"
  - "文档中提到的方法有哪些?"
- 特点: 快速、低成本、直接返回相关片段

### 2. 深度阅读 (Slow Track)
**适用场景:** 复杂分析任务
- 工具: `inspect_toc()`, `read_page(page_num)`
- 典型问题:
  - "分析乔布斯管理风格的演变"
  - "对比文中提到的两种方法"
  - "总结第三章的核心观点"
- 特点: 全面、可验证、支持跨章节分析

## 路由决策规则

在回答之前，先判断用户意图：

| 问题类型 | 判断标准 | 推荐工具 |
|---------|---------|---------|
| 简单事实 | 包含"哪年"、"何时"、"谁"、"什么"、"是否" | `hybrid_search` |
| 复杂分析 | 包含"分析"、"对比"、"演变"、"总结"、"为什么" | `inspect_toc` + `read_page` |
| 章节查询 | 提到具体章节名或页码 | `read_page` 直接定位 |

## 引用协议

严格遵守引用格式：
- 单个来源: `[[章节名#^page-N]]`
- 多个来源: `[[来源1]] [[来源2]]`
- 页内引用: `[[章节名#^page-N, 第X段]]`

## 思维可见

对于复杂任务，请先输出分析思路：

```xml
<thought>
1. 用户想了解...
2. 我应该先使用 inspect_toc 查看目录结构
3. 然后使用 read_page 阅读相关章节
4. 最后综合分析给出结论
</thought>
```

## 回答风格

- 简洁明了，避免冗余
- 优先使用工具结果中的原文
- 分析要有依据，标注引用
- 不确定时明确说明

{tool_descriptions}
"""


# ========== Few-Shot 示例 ==========

FEW_SHOT_EXAMPLES = """
## 示例对话

### 示例 1: 简单事实查询
User: 乔布斯哪年发布的 iPhone?
Assistant: 我来快速检索这个问题。
<tool_call>hybrid_search(query="iPhone 发布 时间", top_k=3)</think>
根据检索结果，**iPhone 于 2007 年 6 月 29 日**首次发布 [[产品发布会#^page-5]]。

### 示例 2: 复杂分析任务
User: 分析乔布斯管理风格的演变
Assistant:
<thought>
1. 这是一个需要跨章节对比的复杂分析任务
2. 先查看目录，找到相关章节
3. 然后逐章阅读，提取关键信息
</thought>

<tool_call>inspect_toc()</think>
根据目录，相关章节包括"早期苹果"、"皮克斯时期"和"回归苹果"。让我逐一阅读：
<tool_call>read_page(page_num=45)</think>
...（继续阅读其他章节）...

**综合分析:**
乔布斯的管理风格经历了明显的演变...

### 示例 3: 章节定位查询
User: 第三章讲了什么？
Assistant: 让我直接阅读第三章的内容。
<tool_call>read_page(page_num=120)
"""


# ========== Prompt 构建函数 ==========

def build_system_prompt(tool_descriptions: str) -> str:
    """
    构建 System Prompt

    Args:
        tool_descriptions: 工具描述字符串

    Returns:
        完整的 System Prompt
    """
    return SYSTEM_PROMPT_TEMPLATE.format(tool_descriptions=tool_descriptions)


def build_messages(
    user_query: str,
    history: List[Dict[str, str]],
    tool_results: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    """
    构建对话消息列表

    Args:
        user_query: 用户查询
        history: 历史对话
        tool_results: 工具执行结果

    Returns:
        消息列表
    """
    messages = []

    # 添加历史对话
    messages.extend(history)

    # 添加当前查询
    messages.append({"role": "user", "content": user_query})

    # 添加工具调用结果
    for result in tool_results:
        tool_call = result.get("tool_call", {})
        output = result.get("output", "")

        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [tool_call]
        })
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.get("id", ""),
            "content": output
        })

    return messages


# ========== 决策规则 ==========

DECISION_RULES = """
## 强制规则

1. 如果问题包含"哪年"、"何时"、"谁"、"什么"、"是否" → 必须用 `hybrid_search`
2. 如果问题包含"分析"、"对比"、"演变"、"总结"、"为什么" → 必须用 `inspect_toc` + `read_page`
3. 如果用户提到章节名 → 优先用 `read_page` 定位
4. 每次工具调用后，必须分析结果再决定下一步
5. 引用必须包含具体页码
"""
```

**Step 2: 添加 Prompt 测试**

编辑 `src/deeppdf/agent/tests/test_prompts.py`，创建新文件:

```python
# src/deeppdf/agent/tests/test_prompts.py
"""Prompt 模块测试"""
import pytest
from deeppdf.agent.prompts import build_system_prompt, build_messages


def test_build_system_prompt():
    """测试: 构建 System Prompt"""
    tool_desc = "### test_tool\\n测试工具描述"

    prompt = build_system_prompt(tool_desc)

    assert "PDF 阅读助手" in prompt
    assert "快速检索" in prompt
    assert "深度阅读" in prompt
    assert "test_tool" in prompt
    assert "测试工具描述" in prompt


def test_build_messages_empty():
    """测试: 构建空消息"""
    messages = build_messages("测试查询", [], [])

    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "测试查询"


def test_build_messages_with_history():
    """测试: 构建带历史的消息"""
    history = [
        {"role": "user", "content": "第一个问题"},
        {"role": "assistant", "content": "第一个回答"}
    ]

    messages = build_messages("第二个问题", history, [])

    assert len(messages) == 3
    assert messages[0]["content"] == "第一个问题"
    assert messages[1]["content"] == "第一个回答"
    assert messages[2]["content"] == "第二个问题"


def test_build_messages_with_tool_results():
    """测试: 构建带工具结果的消息"""
    tool_results = [
        {
            "tool_call": {"id": "call_123", "type": "function", "function": {"name": "test_tool", "arguments": "{}"}},
            "output": "工具执行结果"
        }
    ]

    messages = build_messages("测试", [], tool_results)

    assert len(messages) == 3
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert messages[2]["role"] == "tool"
    assert messages[2]["content"] == "工具执行结果"
```

**Step 3: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_prompts.py -v
```

期望输出: 全部 PASSED

**Step 4: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/prompts.py src/deeppdf/agent/tests/test_prompts.py
git commit -m "feat(agent): 实现 Prompt 管理模块

- 定义 System Prompt 模板和路由规则
- 实现 build_system_prompt 构建函数
- 实现 build_messages 消息构建函数
- 添加 Few-Shot 示例
- 完整的单元测试覆盖
"
```

---

## 第三部分: Core 层

### Task 6: 实现 DeepPDFAgent 核心类

**目的:** 实现 Agent 主类，协调 LLM、工具和记忆

**Files:**
- Create: `src/deeppdf/agent/core.py`

**Step 1: 实现 Agent 核心类**

```python
# src/deeppdf/agent/core.py
"""
Agent 核心 - DeepPDFAgent 主类
"""
import logging
import uuid
from typing import Dict, Any, List, Optional, AsyncGenerator

from .executor import ToolExecutor, create_tool_executor
from .prompts import build_system_prompt, build_messages

logger = logging.getLogger(__name__)


class DeepPDFAgent:
    """
    DeepPDF 阅读智能体

    基于 ReAct 模式的 Tool-Calling Agent，支持快速检索和深度阅读双轨处理。
    """

    def __init__(
        self,
        index_id: str,
        storage_dir: str,
        tree_structure: Dict[str, Any],
        llm_provider: str = "deepseek",
        model: str = "deepseek-chat",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        pageindex_lib_path: Optional[str] = None,
        max_iterations: int = 10,
    ):
        """
        初始化 Agent

        Args:
            index_id: 索引 ID
            storage_dir: 存储目录
            tree_structure: 文档树状结构
            llm_provider: LLM 提供商 (deepseek/openai/anthropic)
            model: 模型名称
            api_key: API 密钥
            base_url: API 基础 URL
            pageindex_lib_path: PageIndex 库路径
            max_iterations: 最大迭代次数
        """
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.max_iterations = max_iterations

        # 初始化工具执行器
        self.tool_executor: ToolExecutor = create_tool_executor(
            index_id=index_id,
            storage_dir=storage_dir,
            tree_structure=tree_structure,
            pageindex_lib_path=pageindex_lib_path,
        )

        # 初始化 LLM 客户端
        self.llm_client = self._init_llm(
            provider=llm_provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
        )

        # 构建 System Prompt
        tool_descriptions = self.tool_executor.get_tool_descriptions()
        self.system_prompt = build_system_prompt(tool_descriptions)

        # 对话历史
        self.history: List[Dict[str, str]] = []

    def _init_llm(
        self,
        provider: str,
        model: str,
        api_key: Optional[str],
        base_url: Optional[str],
    ) -> Any:
        """
        初始化 LLM 客户端

        Args:
            provider: LLM 提供商
            model: 模型名称
            api_key: API 密钥
            base_url: API 基础 URL

        Returns:
            LLM 客户端实例
        """
        import os

        # 从环境变量获取默认值
        if provider == "deepseek":
            api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
            base_url = base_url or "https://api.deepseek.com/v1"

            from openai import OpenAI
            return OpenAI(api_key=api_key, base_url=base_url)

        elif provider == "openai":
            api_key = api_key or os.getenv("OPENAI_API_KEY")

            from openai import OpenAI
            return OpenAI(api_key=api_key)

        elif provider == "anthropic":
            api_key = api_key or os.getenv("ANTHROPIC_API_KEY")

            from anthropic import Anthropic
            return Anthropic(api_key=api_key)

        else:
            raise ValueError(f"不支持的 LLM 提供商: {provider}")

    def run(self, user_query: str, stream: bool = False) -> str:
        """
        执行 Agent 主循环

        Args:
            user_query: 用户查询
            stream: 是否流式输出

        Returns:
            Agent 回答
        """
        logger.info(f"[Agent] 开始执行查询: {user_query[:50]}...")

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_query}
        ]

        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1
            logger.info(f"[Agent] 迭代 {iteration}/{self.max_iterations}")

            # 调用 LLM
            response = self.llm_client.chat.completions.create(
                model=self.llm_client.model if hasattr(self.llm_client, 'model') else "gpt-4o-mini",
                messages=messages,
                tools=self._get_tool_schemas(),
                tool_choice="auto" if iteration < 3 else None,  # 前3轮允许工具调用
            )

            assistant_message = response.choices[0].message

            # 检查是否有工具调用
            tool_calls = assistant_message.tool_calls

            if not tool_calls:
                # 没有工具调用，返回最终答案
                final_answer = assistant_message.content or ""
                logger.info(f"[Agent] 执行完成，总迭代: {iteration}")
                return final_answer

            # 执行工具调用
            messages.append({"role": "assistant", "content": assistant_message.content, "tool_calls": tool_calls})

            for tool_call in tool_calls:
                tool_name = tool_call.function.name
                tool_args = eval(tool_call.function.arguments)  # 注意：生产环境应使用 json.loads

                logger.info(f"[Agent] 调用工具: {tool_name} 参数: {tool_args}")

                # 执行工具
                tool_result = self.tool_executor.execute(tool_name, **tool_args)

                # 添加工具结果到消息
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result
                })

        # 达到最大迭代次数
        logger.warning(f"[Agent] 达到最大迭代次数: {self.max_iterations}")
        return "抱歉，查询过于复杂，请简化问题后重试。"

    async def run_stream(self, user_query: str) -> AsyncGenerator[str, None]:
        """
        流式执行 Agent 主循环

        Args:
            user_query: 用户查询

        Yields:
            流式输出片段
        """
        logger.info(f"[Agent Stream] 开始执行查询: {user_query[:50]}...")

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_query}
        ]

        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1

            # 流式调用 LLM
            response_stream = self.llm_client.chat.completions.create(
                model=self.llm_client.model if hasattr(self.llm_client, 'model') else "gpt-4o-mini",
                messages=messages,
                tools=self._get_tool_schemas(),
                tool_choice="auto" if iteration < 3 else None,
                stream=True,
            )

            full_content = ""
            tool_calls_buffer = []

            for chunk in response_stream:
                delta = chunk.choices[0].delta

                # 流式输出内容
                if delta.content:
                    full_content += delta.content
                    yield f"data: {json.dumps({'type': 'content', 'content': delta.content})}\n\n"

                # 收集工具调用
                if delta.tool_calls:
                    tool_calls_buffer.append(delta.tool_calls)

            # 检查是否有工具调用
            if tool_calls_buffer:
                # 执行工具
                for tool_call_chunk in tool_calls_buffer:
                    # 处理工具调用（简化版）
                    tool_name = tool_call_chunk[0].function.name if tool_call_chunk else None
                    if tool_name:
                        yield f"data: {json.dumps({'type': 'tool', 'tool': tool_name})}\n\n"

                        # 执行工具并获取结果
                        tool_args = {}
                        tool_result = self.tool_executor.execute(tool_name, **tool_args)

                        # 添加到消息历史
                        messages.append({
                            "role": "assistant",
                            "content": full_content,
                            "tool_calls": tool_call_chunk
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call_chunk[0].id,
                            "content": tool_result
                        })

                        yield f"data: {json.dumps({'type': 'tool_result', 'result': tool_result[:100]})}\n\n"
                break
            else:
                # 没有工具调用，结束
                yield f"data: {json.dumps({'type': 'done', 'content': full_content})}\n\n"
                break

    def _get_tool_schemas(self) -> List[Dict[str, Any]]:
        """
        获取工具的 OpenAI Function Schema

        Returns:
            工具 Schema 列表
        """
        schemas = []

        for tool_name, tool in self.tool_executor.tools.items():
            schema = {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            }

            # 根据不同工具添加参数
            if tool_name == "hybrid_search":
                schema["function"]["parameters"]["properties"] = {
                    "query": {"type": "string", "description": "搜索查询"},
                    "top_k": {"type": "integer", "description": "返回结果数量"}
                }
                schema["function"]["parameters"]["required"] = ["query"]

            elif tool_name == "read_page":
                schema["function"]["parameters"]["properties"] = {
                    "page_num": {"type": "integer", "description": "页码（从1开始）"}
                }
                schema["function"]["parameters"]["required"] = ["page_num"]

            # inspect_toc 无需参数

            schemas.append(schema)

        return schemas
```

**Step 2: 编写 Agent 测试**

创建 `src/deeppdf/agent/tests/test_core.py`:

```python
# src/deeppdf/agent/tests/test_core.py
"""Agent 核心测试"""
import pytest
from unittest.mock import Mock, MagicMock
from deeppdf.agent.core import DeepPDFAgent


@pytest.fixture
def mock_llm():
    """Mock LLM 客户端"""
    mock = Mock()
    mock.model = "gpt-4o-mini"

    # Mock chat.completions.create
    mock_response = Mock()
    mock_response.choices = [Mock()]
    mock_response.choices[0].message = Mock()
    mock_response.choices[0].message.content = "这是测试回答"
    mock_response.choices[0].message.tool_calls = None

    mock.chat.completions.create.return_value = mock_response
    return mock


def test_agent_initialization():
    """测试: Agent 初始化"""
    tree_structure = {"structure": []}

    with pytest.mock.patch('deeppdf.agent.core.DeepPDFAgent._init_llm') as mock_init:
        mock_init.return_value = Mock()

        agent = DeepPDFAgent(
            index_id="test_idx",
            storage_dir="/fake/path",
            tree_structure=tree_structure,
            llm_provider="deepseek",
            model="deepseek-chat"
        )

        assert agent.index_id == "test_idx"
        assert agent.max_iterations == 10
        assert agent.tool_executor is not None


def test_agent_simple_query(mock_llm):
    """测试: 简单查询（无需工具）"""
    tree_structure = {"structure": []}

    with pytest.mock.patch('deeppdf.agent.core.DeepPDFAgent._init_llm', return_value=mock_llm):
        agent = DeepPDFAgent(
            index_id="test_idx",
            storage_dir="/fake/path",
            tree_structure=tree_structure
        )

        result = agent.run("测试查询")

        assert "这是测试回答" in result
        mock_llm.chat.completions.create.assert_called_once()


def test_agent_max_iterations(mock_llm):
    """测试: 达到最大迭代次数"""
    # Mock 工具调用
    mock_tool_call = Mock()
    mock_tool_call.id = "call_123"
    mock_tool_call.function.name = "hybrid_search"
    mock_tool_call.function.arguments = '{"query": "test"}'

    mock_llm.chat.completions.create.return_value.choices[0].message.tool_calls = [mock_tool_call]

    tree_structure = {"structure": []}

    with pytest.mock.patch('deeppdf.agent.core.DeepPDFAgent._init_llm', return_value=mock_llm):
        agent = DeepPDFAgent(
            index_id="test_idx",
            storage_dir="/fake/path",
            tree_structure=tree_structure,
            max_iterations=2
        )

        result = agent.run("测试查询")

        assert "过于复杂" in result
```

**Step 3: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/test_core.py -v
```

期望输出: 全部 PASSED

**Step 4: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/agent/core.py src/deeppdf/agent/tests/test_core.py
git commit -m "feat(agent): 实现 DeepPDFAgent 核心类

- 实现 ReAct 模式的 Agent 主循环
- 支持 DeepSeek/OpenAI/Anthropic LLM
- 实现 run() 同步执行方法
- 实现 run_stream() 流式执行方法
- 添加最大迭代次数保护
- 完整的 Mock 单元测试覆盖
"
```

---

## 第四部分: API 集成

### Task 7: 添加 Agent API 端点

**目的:** 暴露 Agent 功能为 HTTP API

**Files:**
- Modify: `src/deeppdf/api/routes.py`
- Modify: `src/deeppdf/api/models.py`

**Step 1: 添加 Agent 请求/响应模型**

编辑 `src/deeppdf/api/models.py`，在文件末尾添加:

```python
# ========== Agent 相关模型 ==========

class AgentRequest(BaseModel):
    """Agent 请求"""
    query: str = Field(..., description="用户查询")
    index_id: str = Field(..., description="索引 ID")
    stream: Optional[bool] = Field(False, description="是否流式输出")


class AgentResponse(BaseModel):
    """Agent 响应"""
    status: str
    answer: Optional[str] = None
    error: Optional[str] = None
    iterations: Optional[int] = None
```

**Step 2: 添加 Agent 端点**

编辑 `src/deeppdf/api/routes.py`，在文件末尾添加:

```python
@router.post("/chat/agent", response_model=AgentResponse)
async def chat_with_agent(req: AgentRequest):
    """
    与 Agent 对话

    使用智能 Agent 处理用户查询，支持:
    - 快速检索: 简单事实查询
    - 深度阅读: 复杂分析任务

    Args:
        req: Agent 请求

    Returns:
        Agent 响应
    """
    logger.info(f"[API] 收到 Agent 请求: query='{req.query}', index_id='{req.index_id}'")

    try:
        # 1. 加载索引元数据
        import json
        metadata_path = Path(settings.base_dir) / "indexes" / f"{req.index_id}.json"

        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"索引 {req.index_id} 不存在"
            )

        with open(metadata_path, "r", encoding="utf-8") as f:
            index_metadata = json.load(f)

        tree_structure = index_metadata.get("tree_structure", {})

        # 2. 创建 Agent
        from ..agent.core import DeepPDFAgent

        agent = DeepPDFAgent(
            index_id=req.index_id,
            storage_dir=str(settings.base_dir),
            tree_structure=tree_structure,
            llm_provider=settings.llm_provider,
            model=settings.llm_model,
            api_key=settings.api_key,
            base_url=settings.api_url,
            pageindex_lib_path=None,  # Phase 1 暂不支持 read_page
        )

        # 3. 执行查询
        answer = agent.run(req.query)

        logger.info(f"[API] Agent 查询完成，回答长度: {len(answer)}")

        return AgentResponse(
            status="success",
            answer=answer
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] Agent 查询失败: {e}", exc_info=True)
        return AgentResponse(
            status="error",
            error=str(e)
        )


@router.get("/chat/agent/stream")
async def chat_with_agent_stream(req: AgentRequest):
    """
    与 Agent 流式对话

    返回 Server-Sent Events 流
    """
    from fastapi.responses import StreamingResponse

    async def generate():
        try:
            # 1. 加载索引元数据
            import json
            metadata_path = Path(settings.base_dir) / "indexes" / f"{req.index_id}.json"

            with open(metadata_path, "r", encoding="utf-8") as f:
                index_metadata = json.load(f)

            tree_structure = index_metadata.get("tree_structure", {})

            # 2. 创建 Agent
            from ..agent.core import DeepPDFAgent

            agent = DeepPDFAgent(
                index_id=req.index_id,
                storage_dir=str(settings.base_dir),
                tree_structure=tree_structure,
                llm_provider=settings.llm_provider,
                model=settings.llm_model,
                api_key=settings.api_key,
                base_url=settings.api_url,
                pageindex_lib_path=None,
            )

            # 3. 流式执行
            async for chunk in agent.run_stream(req.query):
                yield chunk

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**Step 3: 更新模型导入**

编辑 `src/deeppdf/api/routes.py`，在导入部分添加:

```python
from .models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    ListIndexesResponse, DeleteIndexResponse,
    TaskProgressResponse,
    MarkdownMappingBody, MarkdownMappingResponse,
    AgentRequest, AgentResponse  # 新增
)
```

**Step 4: 运行 API 测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
python -c "
from deeppdf.api.models import AgentRequest, AgentResponse
req = AgentRequest(query='测试', index_id='test_idx')
print('模型验证通过:', req)
"
```

期望输出: 模型验证通过

**Step 5: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add src/deeppdf/api/routes.py src/deeppdf/api/models.py
git commit -m "feat(api): 添加 Agent API 端点

- 新增 POST /api/chat/agent 同步端点
- 新增 GET /api/chat/agent/stream 流式端点
- 添加 AgentRequest/AgentResponse 模型
- 集成 DeepPDFAgent 到 API 层
"
```

---

## 第五部分: 前端改造

### Task 8: 添加 Agent 模式切换

**目的:** 让用户可以选择使用 Agent 模式或传统 RAG 模式

**Files:**
- Modify: `frontend/src/components/chat-input/chat-input.ts`
- Create: `frontend/src/components/agent-mode-toggle/agent-mode-toggle.ts`

**Step 1: 创建 Agent 模式切换组件**

```typescript
// frontend/src/components/agent-mode-toggle/agent-mode-toggle.ts
/**
 * Agent 模式切换组件
 * 允许用户在快速检索模式和智能 Agent 模式之间切换
 */
import { css, html, PropertyValueMap, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { MobxLitElement } from '@adobe/lit-mobx';
import { observe } from 'mobx';

export type ChatMode = 'rag' | 'agent';

@customElement('agent-mode-toggle')
export class AgentModeToggle extends MobxLitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--color-surface);
      border-radius: 8px;
    }

    .toggle-label {
      font-size: 12px;
      color: var(--color-text-secondary);
    }

    .toggle-buttons {
      display: flex;
      background: var(--color-surface-variant);
      border-radius: 6px;
      padding: 2px;
    }

    .toggle-button {
      padding: 6px 12px;
      border: none;
      background: transparent;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .toggle-button.active {
      background: var(--color-primary);
      color: white;
    }

    .mode-description {
      font-size: 11px;
      color: var(--color-text-tertiary);
      max-width: 200px;
    }

    .agent-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--color-primary-container);
      color: var(--color-primary);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
  `;

  @state()
  private mode: ChatMode = 'rag';

  @state()
  private showDescription = false;

  protected render(): TemplateResult {
    return html`
      <div class="toggle-container">
        <span class="toggle-label">模式:</span>
        <div class="toggle-buttons">
          <button
            class="toggle-button ${this.mode === 'rag' ? 'active' : ''}"
            @click=${() => this.setMode('rag')}
          >
            快速检索
          </button>
          <button
            class="toggle-button ${this.mode === 'agent' ? 'active' : ''}"
            @click=${() => this.setMode('agent')}
          >
            AI 智能体
            <span class="agent-badge">NEW</span>
          </button>
        </div>
        ${this.showDescription ? html`
          <div class="mode-description">
            ${this.mode === 'agent'
              ? '智能理解复杂问题，支持多步推理'
              : '快速检索相关内容'}
          </div>
        ` : ''}
      </div>
    `;
  }

  private setMode(mode: ChatMode) {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent('mode-change', {
      detail: { mode },
      bubbles: true,
      composed: true
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-mode-toggle': AgentModeToggle;
  }
}
```

**Step 2: 修改 ChatInput 组件集成模式切换**

编辑 `frontend/src/components/chat-input/chat-input.ts`:

```typescript
// 在 import 部分添加
import './components/agent-mode-toggle/agent-mode-toggle';

// 在组件中添加模式状态
@state()
private chatMode: 'rag' | 'agent' = 'rag';

// 在 render 方法中添加模式切换器
private renderModeToggle() {
  return html`
    <agent-mode-toggle
      @mode-change=${(e: CustomEvent) => {
        this.chatMode = e.detail.mode;
        this.updatePlaceholder();
      }}
    ></agent-mode-toggle>
  `;
}

private updatePlaceholder() {
  if (this.chatMode === 'agent') {
    this.placeholder = '问我任何问题... AI 会智能分析文档';
  } else {
    this.placeholder = '输入查询关键词...';
  }
}

// 修改查询发送方法
private async sendQuery() {
  const query = this.queryInput.value.trim();
  if (!query) return;

  if (this.chatMode === 'agent') {
    await this.sendAgentQuery(query);
  } else {
    await this.sendRagQuery(query);
  }
}

private async sendAgentQuery(query: string) {
  // 新的 Agent 查询逻辑
  this.dispatchEvent(new CustomEvent('agent-query', {
    detail: { query, indexId: this.selectedIndexId },
    bubbles: true,
    composed: true
  }));
}
```

**Step 3: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/frontend
git add src/components/agent-mode-toggle/
git add src/components/chat-input/chat-input.ts
git commit -m "feat(frontend): 添加 Agent 模式切换

- 创建 AgentModeToggle 组件
- 支持快速检索/AI 智能体模式切换
- 集成到 ChatInput 组件
"
```

---

### Task 9: 实现 Agent 消息显示

**目的:** 显示 Agent 的思考过程、工具调用和最终回答

**Files:**
- Create: `frontend/src/components/agent-message/agent-message.ts`
- Modify: `frontend/src/components/message/message.ts`

**Step 1: 创建 Agent 消息组件**

```typescript
// frontend/src/components/agent-message/agent-message.ts
/**
 * Agent 消息显示组件
 * 展示 Agent 的思考过程、工具调用和最终回答
 */
import { css, html, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from '@adobe/lit-mobx';

interface ThoughtBlock {
  content: string;
  timestamp: number;
}

interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  result?: string;
  timestamp: number;
}

interface AgentMessageData {
  thoughts: ThoughtBlock[];
  toolCalls: ToolCall[];
  finalAnswer: string;
  citations: Citation[];
}

interface Citation {
  section: string;
  page: number;
  text: string;
}

@customElement('agent-message')
export class AgentMessage extends MobxLitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .agent-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* 思考过程样式 */
    .thought-block {
      background: var(--color-surface-variant);
      border-left: 3px solid var(--color-primary);
      padding: 12px;
      border-radius: 0 8px 8px 0;
    }

    .thought-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--color-text-secondary);
      margin-bottom: 6px;
    }

    .thought-icon {
      width: 14px;
      height: 14px;
      color: var(--color-primary);
    }

    .thought-content {
      font-size: 13px;
      color: var(--color-text-secondary);
      font-style: italic;
      line-height: 1.5;
    }

    /* 工具调用样式 */
    .tool-call {
      background: var(--color-surface);
      border: 1px solid var(--color-outline);
      border-radius: 8px;
      overflow: hidden;
    }

    .tool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--color-primary-container);
      border-bottom: 1px solid var(--color-outline);
    }

    .tool-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-primary);
    }

    .tool-badge {
      padding: 2px 6px;
      background: var(--color-primary);
      color: white;
      border-radius: 4px;
      font-size: 10px;
    }

    .tool-content {
      padding: 12px;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }

    /* 最终回答样式 */
    .final-answer {
      padding: 12px;
      background: var(--color-surface);
      border-radius: 8px;
    }

    .final-answer-content {
      font-size: 14px;
      line-height: 1.6;
    }

    /* 引用样式 */
    .citation-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--color-secondary-container);
      color: var(--color-secondary);
      border-radius: 4px;
      font-size: 11px;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
    }

    .citation-link:hover {
      background: var(--color-secondary);
      color: white;
    }

    /* 加载动画 */
    .thinking-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px;
      color: var(--color-text-secondary);
      font-size: 13px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--color-outline);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  @property({ type: Object })
  data!: AgentMessageData;

  @property({ type: Boolean })
  loading = false;

  protected render(): TemplateResult {
    return html`
      <div class="agent-container">
        <!-- 思考过程 -->
        ${this.data.thoughts.map(thought => html`
          <div class="thought-block">
            <div class="thought-header">
              <svg class="thought-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <span>思考过程</span>
            </div>
            <div class="thought-content">${thought.content}</div>
          </div>
        `)}

        <!-- 工具调用 -->
        ${this.data.toolCalls.map(tool => html`
          <div class="tool-call">
            <div class="tool-header">
              <span class="tool-name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
                ${this.getToolDisplayName(tool.tool)}
              </span>
              <span class="tool-badge">工具</span>
            </div>
            ${tool.result ? html`
              <div class="tool-content">${this.formatToolResult(tool.result)}</div>
            ` : html`
              <div class="tool-content">执行中...</div>
            `}
          </div>
        `)}

        <!-- 最终回答 -->
        ${this.data.finalAnswer ? html`
          <div class="final-answer">
            <div class="final-answer-content">
              ${this.renderFinalAnswer(this.data.finalAnswer)}
            </div>
          </div>
        ` : ''}

        <!-- 加载中 -->
        ${this.loading ? html`
          <div class="thinking-indicator">
            <div class="spinner"></div>
            <span>AI 正在分析文档...</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getToolDisplayName(toolName: string): string {
    const names: Record<string, string> = {
      'hybrid_search': '快速检索',
      'inspect_toc': '查看目录',
      'read_page': '读取页面'
    };
    return names[toolName] || toolName;
  }

  private formatToolResult(result: string): string {
    // 截断过长的结果
    if (result.length > 300) {
      return result.substring(0, 300) + '...';
    }
    return result;
  }

  private renderFinalAnswer(answer: string): TemplateResult {
    // 处理引用链接 [[章节#^page-N]]
    const citationRegex = /\[\[([^\]]+)\]\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(answer)) !== null) {
      // 添加引用前的文本
      parts.push(answer.substring(lastIndex, match.index));

      // 添加引用链接
      const citation = match[1];
      parts.push(html`
        <a href="#" class="citation-link" @click=${(e: Event) => {
          e.preventDefault();
          this.handleCitationClick(citation);
        }}>
          ${citation}
        </a>
      `);

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    parts.push(answer.substring(lastIndex));

    return html`${parts}`;
  }

  private handleCitationClick(citation: string) {
    // 解析引用：章节#^page-N
    const [section, page] = citation.split('#^');
    const pageNum = parseInt(page.replace('page-', ''), 10);

    this.dispatchEvent(new CustomEvent('citation-click', {
      detail: { section, pageNum },
      bubbles: true,
      composed: true
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-message': AgentMessage;
  }
}
```

**Step 2: 修改消息列表组件支持 Agent 消息**

编辑 `frontend/src/components/message-list/message-list.ts`:

```typescript
import './components/agent-message/agent-message';

// 在消息类型中添加 Agent 消息
interface AgentMessageItem {
  type: 'agent';
  data: {
    thoughts: Array<{ content: string; timestamp: number }>;
    toolCalls: Array<{
      tool: string;
      arguments: Record<string, unknown>;
      result?: string;
      timestamp: number;
    }>;
    finalAnswer: string;
    citations: Array<{ section: string; page: number; text: string }>;
  };
  loading?: boolean;
}

// 在渲染方法中添加 Agent 消息分支
private renderMessage(message: MessageItem | AgentMessageItem): TemplateResult {
  if (message.type === 'agent') {
    return html`
      <agent-message
        .data=${message.data}
        .loading=${message.loading}
        @citation-click=${this.handleCitationClick}
      ></agent-message>
    `;
  }
  // ... 其他消息类型
}
```

**Step 3: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/frontend
git add src/components/agent-message/
git add src/components/message-list/message-list.ts
git commit -m "feat(frontend): 实现 Agent 消息显示

- 创建 AgentMessage 组件展示 Agent 过程
- 支持显示思考过程、工具调用、最终回答
- 支持引用链接点击跳转
- 集成到消息列表
"
```

---

### Task 10: 实现 Agent API 调用

**目的:** 前端调用后端 Agent API

**Files:**
- Modify: `frontend/src/api/http-client.ts`
- Create: `frontend/src/api/agent-api.ts`

**Step 1: 创建 Agent API 客户端**

```typescript
// frontend/src/api/agent-api.ts
/**
 * Agent API 客户端
 */
import { httpClient } from './http-client';

export interface AgentQueryRequest {
  query: string;
  index_id: string;
  stream?: boolean;
}

export interface AgentQueryResponse {
  status: 'success' | 'error';
  answer?: string;
  error?: string;
  iterations?: number;
}

export interface AgentStreamEvent {
  type: 'thought' | 'tool' | 'tool_result' | 'content' | 'done' | 'error';
  content?: string;
  tool?: string;
  result?: string;
  error?: string;
}

export class AgentAPI {
  /**
   * 发送 Agent 查询（同步）
   */
  async queryAgent(request: AgentQueryRequest): Promise<AgentQueryResponse> {
    return httpClient.post<AgentQueryResponse>('/api/chat/agent', request);
  }

  /**
   * 发送 Agent 查询（流式）
   */
  async streamAgentQuery(
    request: AgentQueryRequest,
    onEvent: (event: AgentStreamEvent) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<() => void> {
    const url = new URL(httpClient.getBaseUrl() + '/api/chat/agent/stream');
    url.searchParams.set('query', request.query);
    url.searchParams.set('index_id', request.index_id);

    const eventSource = new EventSource(url.toString());

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentStreamEvent;
        onEvent(event);

        if (event.type === 'done' || event.type === 'error') {
          eventSource.close();
          onComplete();
        }
      } catch (error) {
        onError(new Error('Failed to parse event'));
        eventSource.close();
      }
    };

    eventSource.onerror = (e) => {
      onError(new Error('EventSource failed'));
      eventSource.close();
      onComplete();
    };

    // 返回取消函数
    return () => {
      eventSource.close();
    };
  }
}

export const agentAPI = new AgentAPI();
```

**Step 2: 在应用状态中集成 Agent**

编辑 `frontend/src/stores/app-state.ts` (或相应状态文件):

```typescript
import { agentAPI, AgentStreamEvent } from '../api/agent-api';

// 在应用状态中添加 Agent 方法
async sendAgentQuery(query: string, indexId: string) {
  const message: AgentMessageItem = {
    id: generateId(),
    type: 'agent',
    role: 'assistant',
    data: {
      thoughts: [],
      toolCalls: [],
      finalAnswer: '',
      citations: []
    },
    loading: true,
    timestamp: Date.now()
  };

  this.messages.push(message);

  // 取消函数
  let cancelStream: (() => void) | null = null;

  // 流式调用
  cancelStream = await agentAPI.streamAgentQuery(
    { query, index_id: indexId },
    (event: AgentStreamEvent) => {
      // 处理事件
      switch (event.type) {
        case 'thought':
          message.data.thoughts.push({
            content: event.content || '',
            timestamp: Date.now()
          });
          break;
        case 'tool':
          message.data.toolCalls.push({
            tool: event.tool || '',
            arguments: {},
            timestamp: Date.now()
          });
          break;
        case 'tool_result':
          if (message.data.toolCalls.length > 0) {
            message.data.toolCalls[message.data.toolCalls.length - 1].result = event.result;
          }
          break;
        case 'content':
          message.data.finalAnswer += event.content || '';
          break;
        case 'done':
          message.loading = false;
          break;
      }
      this.notifyChange();
    },
    (error) => {
      message.loading = false;
      message.data.finalAnswer = `错误: ${error.message}`;
      this.notifyChange();
    },
    () => {
      message.loading = false;
      this.notifyChange();
    }
  );

  return cancelStream;
}
```

**Step 3: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/frontend
git add src/api/agent-api.ts
git add src/stores/app-state.ts
git commit -m "feat(frontend): 实现 Agent API 调用

- 创建 AgentAPI 客户端
- 支持同步和流式调用
- 集成到应用状态管理
- 实现事件处理和状态更新
"
```

---

### Task 11: 添加样式优化

**目的:** 优化 Agent 模式的视觉效果

**Files:**
- Modify: `frontend/src/styles.css`

**Step 1: 添加 Agent 相关样式**

```css
/* frontend/src/styles.css */

/* Agent 模式主题 */
:root {
  --agent-primary-color: #6366f1;
  --agent-secondary-color: #8b5cf6;
  --agent-surface-color: #f5f3ff;
  --agent-border-color: #e9d5ff;
}

/* 思考过程动画 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.agent-thinking {
  animation: pulse 2s ease-in-out infinite;
}

/* 工具调用动画 */
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.tool-call {
  animation: slideIn 0.3s ease-out;
}

/* 引用链接样式 */
.citation-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: linear-gradient(135deg, var(--agent-primary-color), var(--agent-secondary-color));
  color: white;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
}

.citation-link:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

/* 流式输出光标 */
.streaming-cursor::after {
  content: '|';
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}
```

**Step 2: 提交**

```bash
cd /Users/lizhao/workspace/DeepPDF/frontend
git add src/styles.css
git commit -m "style(frontend): 优化 Agent 模式视觉效果

- 添加 Agent 主题颜色
- 实现思考过程脉冲动画
- 实现工具调用滑入动画
- 优化引用链接样式
- 添加流式输出光标效果
"
```

---

## 第六部分: 验收测试

### Task 12: 端到端测试

**目的:** 验证完整功能链路

**Step 1: 准备测试环境**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate

# 确保有测试索引
ls data/indexes/*.json
```

**Step 2: 测试简单查询**

```bash
# 启动服务（如果未运行）
python -m uvicorn src.deeppdf.main:app --reload &

# 等待服务启动
sleep 3

# 测试 Agent 端点
curl -X POST "http://localhost:8000/api/chat/agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "文档中提到了哪些主要方法？",
    "index_id": "test_idx"
  }'
```

期望输出: JSON 格式的 Agent 回答

**Step 3: 测试流式输出**

```bash
curl -N "http://localhost:8000/api/chat/agent/stream?query=分析第三章核心观点&index_id=test_idx"
```

期望输出: SSE 格式的流式数据

**Step 4: 测试错误处理**

```bash
curl -X POST "http://localhost:8000/api/chat/agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "测试",
    "index_id": "nonexistent_idx"
  }'
```

期望输出: 错误信息（404 或 error status）

**Step 5: 运行所有测试**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
source .venv/bin/activate
pytest src/deeppdf/agent/tests/ -v --cov=src/deeppdf/agent --cov-report=html
```

期望输出:
- 所有测试通过
- 代码覆盖率 > 70%

**Step 6: 提交最终版本**

```bash
cd /Users/lizhao/workspace/DeepPDF/backend/deeppdf-api
git add .
git commit -m "feat(agent): Phase 1 MVP 实现完成

完成的功能:
- [x] InspectTocTool - 目录查看工具
- [x] ReadPageTool - 按页读取工具
- [x] HybridSearchTool - 混合检索工具
- [x] ToolExecutor - 工具执行器
- [x] DeepPDFAgent - Agent 核心类
- [x] Prompt 管理 - System Prompt 和示例
- [x] API 集成 - /api/chat/agent 端点
- [x] 完整的单元测试覆盖

验收标准:
- 简单问题通过 hybrid_search 正确回答
- 复杂问题通过深度分析处理
- 工具调用成功率 > 90%
- 代码覆盖率 > 70%
"
```

---

## 执行检查清单

### 功能验收

- [ ] 简单问题通过 `hybrid_search` 正确回答
- [ ] 复杂问题通过 `read_page` 深度分析
- [ ] 工具调用成功率 > 90%
- [ ] 引用格式正确（`[[章节#^page-N]]`）

### 性能验收

- [ ] 简单问题延迟 < 2s
- [ ] 复杂问题延迟 < 15s
- [ ] 无内存泄漏

### 质量验收

- [ ] 代码覆盖率 > 70%
- [ ] 无 TypeError/ValueError 未捕获
- [ ] 日志完整（可追踪每次工具调用）

---

## 相关文档

- 方案文档: `Phase1_MVP_实施方案.md`
- 架构蓝图: `DeepPDF_1.0_架构蓝图.md`
- 技术方案: `DeepPDF_1.0_重构技术方案.md`
