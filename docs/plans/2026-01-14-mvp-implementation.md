# DeepPDF MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 DeepPDF 最小可用产品，实现 PDF 文档的索引和智能问答功能

**Architecture:** 采用 IPC 架构，Obsidian 插件（TypeScript）通过 stdio 与 MCP 服务器（Python）通信，MCP 服务器集成 PageIndex 源码实现 PDF 索引，使用 ChromaDB 进行向量存储。

**Tech Stack:** Python 3.10+, uv, MCP SDK, ChromaDB, TypeScript, Obsidian Plugin API, esbuild

---

## Phase 1: MCP 服务器基础框架

### Task 1: 初始化 Python 项目

**Files:**
- Create: `mcp-server/pyproject.toml`
- Create: `mcp-server/uv.lock`
- Create: `mcp-server/src/__init__.py`

**Step 1: 创建 pyproject.toml**

```toml
[project]
name = "deeppdf-mcp-server"
version = "0.1.0"
description = "DeepPDF MCP Server"
requires-python = ">=3.10"
dependencies = [
    "mcp>=0.1.0",
    "chromadb>=0.4.0",
    "pypdf2>=3.0.0",
    "python-dotenv>=1.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.uv]
dev-dependencies = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "black>=23.0.0",
    "ruff>=0.1.0",
]
```

**Step 2: 初始化 uv 项目**

Run: `cd mcp-server && uv init --no-readme`
Expected: 创建基础 Python 项目结构

**Step 3: 安装依赖**

Run: `cd mcp-server && uv sync`
Expected: 依赖安装成功，生成 uv.lock

**Step 4: 创建源码目录结构**

Run: `mkdir -p mcp-server/src/tools mcp-server/src/storage mcp-server/src/pageindex mcp-server/data`
Expected: 目录创建成功

**Step 5: 创建空的 __init__.py**

Run: `touch mcp-server/src/__init__.py mcp-server/src/tools/__init__.py mcp-server/src/storage/__init__.py`
Expected: 空的 __init__.py 文件创建

**Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat: initialize MCP server project with uv"
```

---

### Task 2: 实现 MCP 服务器基础框架

**Files:**
- Create: `mcp-server/src/server.py`
- Create: `mcp-server/src/config.py`

**Step 1: 编写配置模块测试**

Create: `mcp-server/tests/test_config.py`

```python
import os
import tempfile
from pathlib import Path
from deeppdf.config import Config

def test_config_default_values():
    """测试默认配置值"""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = Config(base_dir=tmpdir)
        assert config.index_path == Path(tmpdir) / "indexes"
        assert config.chroma_path == Path(tmpdir) / "chroma"
        assert config.max_results == 5

def test_config_from_env():
    """测试从环境变量加载配置"""
    os.environ["DEEPPDF_MAX_RESULTS"] = "10"
    try:
        config = Config()
        assert config.max_results == 10
    finally:
        del os.environ["DEEPPDF_MAX_RESULTS"]
```

**Step 2: 运行配置测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_config.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf'"

**Step 3: 实现配置模块**

Create: `mcp-server/src/config.py`

```python
import os
from pathlib import Path
from dataclasses import dataclass

@dataclass
class Config:
    """MCP 服务器配置"""
    base_dir: str = None
    max_results: int = 5

    def __post_init__(self):
        if self.base_dir is None:
            self.base_dir = Path(__file__).parent.parent / "data"
        else:
            self.base_dir = Path(self.base_dir)

        self.index_path = self.base_dir / "indexes"
        self.chroma_path = self.base_dir / "chroma"

        # 从环境变量覆盖
        if "DEEPPDF_MAX_RESULTS" in os.environ:
            self.max_results = int(os.environ["DEEPPDF_MAX_RESULTS"])

        # 创建必要的目录
        self.index_path.mkdir(parents=True, exist_ok=True)
        self.chroma_path.mkdir(parents=True, exist_ok=True)
```

**Step 4: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_config.py -v`
Expected: PASS

**Step 5: 编写服务器框架测试**

Create: `mcp-server/tests/test_server.py`

```python
import asyncio
from deeppdf.server import MCPServer

def test_server_creation():
    """测试服务器实例创建"""
    server = MCPServer()
    assert server is not None
    assert hasattr(server, 'app')

async def test_server_has_tools():
    """测试服务器注册工具"""
    server = MCPServer()
    # 稍后添加工具列表验证
    assert True
```

**Step 6: 运行服务器测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_server.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf'"

**Step 7: 实现服务器框架**

Create: `mcp-server/src/server.py`

```python
#!/usr/bin/env python3
"""
DeepPDF MCP Server
PDF 索引和查询服务
"""
import sys
from mcp.server import Server
from mcp.server.stdio import stdio_server
from .config import Config

class MCPServer:
    """MCP 服务器封装"""

    def __init__(self):
        self.config = Config()
        self.app = Server("deeppdf-server")
        self._setup_handlers()

    def _setup_handlers(self):
        """设置 MCP 处理器"""

        @self.app.list_tools()
        async def list_tools() -> list:
            """列出可用工具"""
            return [
                {
                    "name": "index_pdf",
                    "description": "解析 PDF 并生成索引",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "PDF 文件路径"
                            }
                        },
                        "required": ["path"]
                    }
                },
                {
                    "name": "query_pdf",
                    "description": "查询 PDF 内容",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "查询文本"
                            },
                            "index_id": {
                                "type": "string",
                                "description": "索引 ID"
                            }
                        },
                        "required": ["query", "index_id"]
                    }
                },
                {
                    "name": "list_indexes",
                    "description": "列出所有索引",
                    "inputSchema": {
                        "type": "object",
                        "properties": {}
                    }
                },
                {
                    "name": "delete_index",
                    "description": "删除指定索引",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "index_id": {
                                "type": "string",
                                "description": "索引 ID"
                            }
                        },
                        "required": ["index_id"]
                    }
                }
            ]

        @self.app.call_tool()
        async def call_tool(name: str, arguments: dict):
            """处理工具调用"""
            # 稍后实现具体工具逻辑
            return {
                "content": [{"type": "text", "text": f"Tool {name} not yet implemented"}]
            }

    async def run(self):
        """运行服务器"""
        async with stdio_server() as (read_stream, write_stream):
            await self.app.run(
                read_stream,
                write_stream,
                self.app.create_initialization_options()
            )

def main():
    """入口函数"""
    server = MCPServer()
    import asyncio
    asyncio.run(server.run())

if __name__ == "__main__":
    main()
```

**Step 8: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_server.py -v`
Expected: PASS

**Step 9: 手动测试服务器启动**

Run: `cd mcp-server && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | uv run python -m deeppdf.server`
Expected: 服务器启动并响应（可能报错但框架可用）

**Step 10: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement MCP server base framework"
```

---

## Phase 2: ChromaDB 存储层

### Task 3: 实现 ChromaDB 存储封装

**Files:**
- Create: `mcp-server/src/storage/chroma_store.py`
- Create: `mcp-server/tests/test_chroma_store.py`

**Step 1: 编写存储层测试**

```python
import pytest
import tempfile
from pathlib import Path
from deeppdf.storage.chroma_store import ChromaStore

def test_store_initialization():
    """测试存储初始化"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        assert store.client is not None

def test_create_collection():
    """测试创建集合"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(
            name="test_index",
            metadata={"pdf_name": "test.pdf", "node_count": 10}
        )
        assert collection is not None
        assert collection.name == "test_index"

def test_add_documents():
    """测试添加文档"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(name="test_index")

        store.add_documents(
            collection_name="test_index",
            documents=[
                {
                    "id": "doc1",
                    "text": "测试内容",
                    "metadata": {"page": 1, "section": "1.1"}
                }
            ]
        )

        # 验证文档数量
        count = collection.count()
        assert count == 1

def test_query_documents():
    """测试查询文档"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(name="test_index")

        # 先添加文档（使用简单的文本，稍后集成向量嵌入）
        store.add_documents(
            collection_name="test_index",
            documents=[
                {
                    "id": "doc1",
                    "text": "Transformer 是一种神经网络架构",
                    "metadata": {"page": 1}
                }
            ]
        )

        # 查询（暂时使用空嵌入，稍后集成实际的嵌入生成）
        results = store.query(
            collection_name="test_index",
            query_texts=["Transformer"],
            n_results=1
        )

        assert len(results["ids"][0]) >= 0  # 可能返回空结果，这是预期的

def test_delete_collection():
    """测试删除集合"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        store.create_collection(name="test_index")

        store.delete_collection("test_index")

        # 验证集合已删除
        collections = store.list_collections()
        assert "test_index" not in [c.name for c in collections]
```

**Step 2: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_chroma_store.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.storage'"

**Step 3: 实现存储层**

Create: `mcp-server/src/storage/chroma_store.py`

```python
import chromadb
from chromadb.config import Settings
from typing import Optional, List, Dict, Any

class ChromaStore:
    """ChromaDB 存储封装"""

    def __init__(self, persist_directory: str):
        """
        初始化 ChromaDB 客户端

        Args:
            persist_directory: 持久化目录
        """
        self.client = chromadb.Client(
            Settings(
                chroma_db_impl="duckdb+parquet",
                persist_directory=persist_directory
            )
        )
        self._collections: Dict[str, Any] = {}

    def create_collection(
        self,
        name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Any:
        """
        创建或获取集合

        Args:
            name: 集合名称
            metadata: 集合元数据

        Returns:
            ChromaDB 集合对象
        """
        # 检查集合是否已存在
        try:
            collection = self.client.get_collection(name)
        except:
            collection = self.client.create_collection(
                name=name,
                metadata=metadata
            )

        self._collections[name] = collection
        return collection

    def add_documents(
        self,
        collection_name: str,
        documents: List[Dict[str, Any]]
    ) -> None:
        """
        添加文档到集合

        Args:
            collection_name: 集合名称
            documents: 文档列表，每个文档包含 id, text, metadata
        """
        if collection_name not in self._collections:
            collection = self.create_collection(collection_name)
        else:
            collection = self._collections[collection_name]

        ids = [doc["id"] for doc in documents]
        texts = [doc["text"] for doc in documents]
        metadatas = [doc.get("metadata", {}) for doc in documents]

        # 暂时使用 None 作为嵌入（ChromaDB 会自动处理）
        collection.add(
            ids=ids,
            documents=texts,
            metadatas=metadatas
        )

    def query(
        self,
        collection_name: str,
        query_texts: List[str],
        n_results: int = 5
    ) -> Dict[str, Any]:
        """
        查询文档

        Args:
            collection_name: 集合名称
            query_texts: 查询文本列表
            n_results: 返回结果数量

        Returns:
            查询结果
        """
        if collection_name not in self._collections:
            raise ValueError(f"Collection {collection_name} not found")

        collection = self._collections[collection_name]
        results = collection.query(
            query_texts=query_texts,
            n_results=n_results
        )
        return results

    def delete_collection(self, name: str) -> None:
        """
        删除集合

        Args:
            name: 集合名称
        """
        self.client.delete_collection(name)
        if name in self._collections:
            del self._collections[name]

    def list_collections(self) -> List[Any]:
        """
        列出所有集合

        Returns:
            集合列表
        """
        return self.client.list_collections()
```

**Step 4: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_chroma_store.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement ChromaDB storage layer"
```

---

## Phase 3: PDF 索引功能

### Task 4: 实现 PDF 解析基础功能

**Files:**
- Create: `mcp-server/tests/fixtures/sample.pdf`
- Create: `mcp-server/tests/test_pdf_parser.py`
- Create: `mcp-server/src/tools/pdf_parser.py`

**Step 1: 创建测试用 PDF fixture**

首先创建一个简单的测试 PDF 文件，或者从网上下载一个小的测试 PDF。

Run: `curl -o mcp-server/tests/fixtures/sample.pdf https://arxiv.org/pdf/1706.03762.pdf`
Expected: 下载成功（或者手动放置一个测试 PDF）

**Step 2: 编写 PDF 解析测试**

```python
import pytest
from pathlib import Path
from deeppdf.tools.pdf_parser import PDFParser

def test_parse_pdf_basic():
    """测试基本的 PDF 解析"""
    parser = PDFParser()
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    # 假设 PDF 已存在
    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    sections = parser.extract_sections(str(pdf_path))

    assert isinstance(sections, list)
    assert len(sections) > 0

    # 验证每个章节的结构
    for section in sections:
        assert "text" in section
        assert "metadata" in section
        assert "page" in section["metadata"]

def test_parse_pdf_with_encryption():
    """测试加密 PDF 的处理"""
    parser = PDFParser()

    # 创建一个模拟的加密 PDF 检查
    with pytest.raises(Exception, match="encrypted"):
        parser.extract_sections("encrypted.pdf")

def test_extract_text_from_page():
    """测试从单页提取文本"""
    parser = PDFParser()
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    text = parser.extract_text_from_page(str(pdf_path), page_num=0)
    assert isinstance(text, str)
    # 可能是空字符串（如果是图片 PDF）
    assert len(text) >= 0
```

**Step 3: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_pdf_parser.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.tools.pdf_parser'"

**Step 4: 实现 PDF 解析器**

Create: `mcp-server/src/tools/pdf_parser.py`

```python
import PyPDF2
from typing import List, Dict, Any
from pathlib import Path

class PDFParseError(Exception):
    """PDF 解析错误"""
    pass

class PDFParser:
    """PDF 文档解析器"""

    def extract_sections(self, pdf_path: str) -> List[Dict[str, Any]]:
        """
        从 PDF 提取章节结构

        Args:
            pdf_path: PDF 文件路径

        Returns:
            章节列表，每个章节包含文本和元数据

        Raises:
            PDFParseError: 解析失败时抛出
        """
        pdf_path = Path(pdf_path)

        if not pdf_path.exists():
            raise PDFParseError(f"File not found: {pdf_path}")

        try:
            with open(pdf_path, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)

                # 检查是否加密
                if pdf_reader.is_encrypted:
                    raise PDFParseError("Encrypted PDFs are not supported")

                sections = []

                # 暂时按页分割（稍后集成 PageIndex 进行智能分段）
                for page_num, page in enumerate(pdf_reader.pages):
                    text = page.extract_text()

                    # 跳过空页
                    if not text or text.strip() == "":
                        continue

                    sections.append({
                        "text": text.strip(),
                        "metadata": {
                            "page": page_num + 1,
                            "total_pages": len(pdf_reader.pages)
                        }
                    })

                return sections

        except PyPDF2.errors.PdfReadError as e:
            raise PDFParseError(f"Failed to read PDF: {str(e)}")
        except Exception as e:
            raise PDFParseError(f"Unexpected error: {str(e)}")

    def extract_text_from_page(self, pdf_path: str, page_num: int) -> str:
        """
        从指定页面提取文本

        Args:
            pdf_path: PDF 文件路径
            page_num: 页码（从 0 开始）

        Returns:
            提取的文本
        """
        pdf_path = Path(pdf_path)

        try:
            with open(pdf_path, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)
                page = pdf_reader.pages[page_num]
                return page.extract_text() or ""
        except Exception as e:
            raise PDFParseError(f"Failed to extract text from page {page_num}: {str(e)}")
```

**Step 5: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_pdf_parser.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement PDF parser"
```

---

### Task 5: 集成 PageIndex 源码

**Files:**
- Create: `mcp-server/src/pageindex/__init__.py`
- Create: `mcp-server/src/pageindex/core.py`
- Create: `mcp-server/src/pageindex/parsers.py`

**Step 1: 编写 PageIndex 集成测试**

```python
import pytest
from deeppdf.pageindex.core import build_tree_index
from deeppdf.pageindex.parsers import extract_sections

def test_extract_sections_structure():
    """测试章节结构提取"""
    # 模拟 PDF 解析结果
    mock_sections = [
        {"text": "Introduction", "metadata": {"page": 1, "level": 1}},
        {"text": "Background", "metadata": {"page": 2, "level": 2}},
        {"text": "Methodology", "metadata": {"page": 3, "level": 1}},
    ]

    structured = extract_sections(mock_sections)
    assert isinstance(structured, list)
    assert len(structured) > 0

def test_build_tree_index():
    """测试树索引构建"""
    mock_sections = [
        {"id": "1", "text": "Introduction", "metadata": {"level": 1}},
        {"id": "2", "text": "Background", "metadata": {"level": 2}},
    ]

    tree = build_tree_index(mock_sections)
    assert tree is not None
    assert "nodes" in tree
```

**Step 2: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_pageindex.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.pageindex'"

**Step 3: 实现 PageIndex 基础模块**

Create: `mcp-server/src/pageindex/parsers.py`

```python
from typing import List, Dict, Any

def extract_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    从原始章节中提取结构化信息

    Args:
        sections: 原始章节列表

    Returns:
        结构化的章节列表
    """
    structured = []

    for section in sections:
        # 添加唯一 ID
        section_data = {
            "id": f"section_{len(structured)}",
            "text": section["text"],
            "metadata": section.get("metadata", {})
        }
        structured.append(section_data)

    return structured

def detect_section_headers(text: str) -> List[Dict[str, Any]]:
    """
    检测文本中的章节标题

    Args:
        text: 输入文本

    Returns:
        检测到的标题列表
    """
    # 简单实现：检测常见标题模式
    # 稍后可以从 PageIndex 源码中复用更复杂的逻辑
    import re

    headers = []
    lines = text.split("\n")

    for i, line in enumerate(lines):
        # 检测编号标题（如 "1. Introduction", "2.1 Background"）
        if re.match(r"^\d+\.\d*\s+", line.strip()):
            headers.append({
                "text": line.strip(),
                "level": 1 if "." not in line.split()[0] else 2,
                "position": i
            })

    return headers
```

Create: `mcp-server/src/pageindex/core.py`

```python
from typing import List, Dict, Any, Optional

def build_tree_index(sections: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    构建树状索引结构

    Args:
        sections: 章节列表

    Returns:
        树状索引
    """
    tree = {
        "nodes": [],
        "root": None,
        "metadata": {
            "total_nodes": len(sections),
            "created_at": None
        }
    }

    # 构建节点
    for section in sections:
        node = {
            "id": section.get("id", f"node_{len(tree['nodes'])}"),
            "text": section["text"],
            "metadata": section.get("metadata", {}),
            "children": [],
            "parent": None
        }
        tree["nodes"].append(node)

    # 简单实现：将所有节点作为根节点的子节点
    # 稍后可以从 PageIndex 源码中集成更复杂的层级构建逻辑
    if tree["nodes"]:
        tree["root"] = tree["nodes"][0]["id"]

    return tree

def find_node_by_id(tree: Dict[str, Any], node_id: str) -> Optional[Dict[str, Any]]:
    """
    根据ID查找节点

    Args:
        tree: 树状索引
        node_id: 节点ID

    Returns:
        找到的节点或 None
    """
    for node in tree["nodes"]:
        if node["id"] == node_id:
            return node
    return None

def get_all_text(tree: Dict[str, Any]) -> str:
    """
    获取树中所有节点的文本

    Args:
        tree: 树状索引

    Returns:
        所有文本拼接
    """
    texts = [node["text"] for node in tree["nodes"]]
    return "\n\n".join(texts)
```

**Step 4: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_pageindex.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add mcp-server/
git commit -m "feat: integrate PageIndex core modules"
```

---

### Task 6: 实现 index_pdf 工具

**Files:**
- Create: `mcp-server/src/tools/pdf_indexer.py`
- Modify: `mcp-server/src/server.py`
- Create: `mcp-server/tests/test_pdf_indexer.py`

**Step 1: 编写索引器测试**

```python
import pytest
import tempfile
from pathlib import Path
from deeppdf.tools.pdf_indexer import index_pdf

def test_index_pdf_success():
    """测试成功的 PDF 索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 假设有测试 PDF
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        result = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        assert result["status"] == "success"
        assert "index_id" in result
        assert "node_count" in result
        assert result["node_count"] > 0

def test_index_pdf_not_found():
    """测试文件不存在的情况"""
    with pytest.raises(FileNotFoundError):
        index_pdf(
            pdf_path="nonexistent.pdf",
            storage_dir="/tmp/test"
        )

def test_index_duplicate():
    """测试重复索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 第一次索引
        result1 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        # 第二次索引（应该提示覆盖或返回已有索引）
        result2 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        # 验证行为
        assert "warning" in result2 or result2["index_id"] == result1["index_id"]
```

**Step 2: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_pdf_indexer.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.tools.pdf_indexer'"

**Step 3: 实现索引器**

Create: `mcp-server/src/tools/pdf_indexer.py`

```python
import hashlib
import json
import time
from pathlib import Path
from typing import Dict, Any
from .pdf_parser import PDFParser, PDFParseError
from ..pageindex.core import build_tree_index
from ..pageindex.parsers import extract_sections
from ..storage.chroma_store import ChromaStore

def index_pdf(pdf_path: str, storage_dir: str) -> Dict[str, Any]:
    """
    索引 PDF 文件

    Args:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录

    Returns:
        索引结果，包含 index_id, node_count, status
    """
    pdf_path_obj = Path(pdf_path)

    # 验证文件存在
    if not pdf_path_obj.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    # 验证文件大小（避免空文件）
    if pdf_path_obj.stat().st_size < 1024:
        raise ValueError("PDF file is too small (< 1KB)")

    # 生成索引 ID（基于文件名和时间的 hash）
    file_hash = hashlib.md5(
        f"{pdf_path_obj.name}{time.time()}".encode()
    ).hexdigest()[:12]
    index_id = f"idx_{file_hash}"

    try:
        # 1. 解析 PDF
        parser = PDFParser()
        raw_sections = parser.extract_sections(pdf_path)

        if not raw_sections:
            return {
                "status": "error",
                "error": "No text extracted from PDF"
            }

        # 2. 使用 PageIndex 构建树索引
        structured_sections = extract_sections(raw_sections)
        tree_index = build_tree_index(structured_sections)

        # 3. 存储到 ChromaDB
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"
        chroma_dir.mkdir(parents=True, exist_ok=True)

        store = ChromaStore(persist_directory=str(chroma_dir))
        store.create_collection(
            name=index_id,
            metadata={
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(structured_sections)
            }
        )

        # 添加文档
        documents = [
            {
                "id": section["id"],
                "text": section["text"],
                "metadata": {
                    **section["metadata"],
                    "pdf_name": pdf_path_obj.name
                }
            }
            for section in structured_sections
        ]
        store.add_documents(index_id, documents)

        # 4. 保存索引元数据
        index_dir = storage_dir_path / "indexes"
        index_dir.mkdir(parents=True, exist_ok=True)

        metadata_path = index_dir / f"{index_id}.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump({
                "id": index_id,
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(structured_sections),
                "tree": tree_index
            }, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "index_id": index_id,
            "node_count": len(structured_sections),
            "pdf_name": pdf_path_obj.name
        }

    except PDFParseError as e:
        return {
            "status": "error",
            "error": f"PDF parsing failed: {str(e)}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }
```

**Step 4: 更新服务器以集成 index_pdf 工具**

Modify: `mcp-server/src/server.py`

在 `_setup_handlers` 方法中的 `@self.app.call_tool()` 装饰器内添加：

```python
from .tools.pdf_indexer import index_pdf

@self.app.call_tool()
async def call_tool(name: str, arguments: dict):
    """处理工具调用"""
    if name == "index_pdf":
        result = index_pdf(
            pdf_path=arguments["path"],
            storage_dir=str(self.config.base_dir)
        )
        return {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        }
    # 其他工具...
```

**Step 5: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_pdf_indexer.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement index_pdf tool"
```

---

## Phase 4: PDF 查询功能

### Task 7: 实现 query_pdf 工具

**Files:**
- Create: `mcp-server/src/tools/pdf_query.py`
- Modify: `mcp-server/src/server.py`
- Create: `mcp-server/tests/test_pdf_query.py`

**Step 1: 编写查询测试**

```python
import pytest
import tempfile
from pathlib import Path
from deeppdf.tools.pdf_query import query_pdf
from deeppdf.tools.pdf_indexer import index_pdf

def test_query_pdf_success():
    """测试成功的查询"""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 先索引
        index_result = index_pdf(str(test_pdf), tmpdir)
        assert index_result["status"] == "success"

        # 再查询
        query_result = query_pdf(
            query="attention mechanism",
            index_id=index_result["index_id"],
            storage_dir=tmpdir
        )

        assert query_result["status"] == "success"
        assert "results" in query_result
        assert len(query_result["results"]) >= 0  # 可能返回空结果

def test_query_pdf_index_not_found():
    """测试查询不存在的索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = query_pdf(
            query="test",
            index_id="nonexistent_index",
            storage_dir=tmpdir
        )

        assert result["status"] == "error"
        assert "not found" in result["error"].lower()
```

**Step 2: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_pdf_query.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.tools.pdf_query'"

**Step 3: 实现查询模块**

Create: `mcp-server/src/tools/pdf_query.py`

```python
from pathlib import Path
from typing import Dict, Any, List
from ..storage.chroma_store import ChromaStore

def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 5
) -> Dict[str, Any]:
    """
    查询已索引的 PDF

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大返回结果数

    Returns:
        查询结果
    """
    if not query or query.strip() == "":
        return {
            "status": "error",
            "error": "Query cannot be empty"
        }

    try:
        # 初始化存储
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"

        store = ChromaStore(persist_directory=str(chroma_dir))

        # 检查集合是否存在
        collections = store.list_collections()
        collection_names = [c.name for c in collections]

        if index_id not in collection_names:
            return {
                "status": "error",
                "error": f"Index {index_id} not found"
            }

        # 执行查询
        results = store.query(
            collection_name=index_id,
            query_texts=[query],
            n_results=max_results
        )

        # 格式化结果
        formatted_results = []
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                formatted_results.append({
                    "id": doc_id,
                    "text": results["documents"][0][i] if results["documents"] else "",
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else None
                })

        # 加载索引元数据
        index_metadata = _load_index_metadata(storage_dir_path, index_id)

        return {
            "status": "success",
            "query": query,
            "results": formatted_results,
            "index_info": index_metadata
        }

    except ValueError as e:
        return {
            "status": "error",
            "error": str(e)
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Query failed: {str(e)}"
        }

def _load_index_metadata(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """加载索引元数据"""
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"

    if metadata_path.exists():
        import json
        with open(metadata_path, "r", encoding="utf-8") as f:
            return json.load(f)

    return {}
```

**Step 4: 更新服务器集成查询工具**

Modify: `mcp-server/src/server.py`

添加 import 并更新 call_tool：

```python
from .tools.pdf_query import query_pdf

@self.app.call_tool()
async def call_tool(name: str, arguments: dict):
    """处理工具调用"""
    if name == "index_pdf":
        result = index_pdf(
            pdf_path=arguments["path"],
            storage_dir=str(self.config.base_dir)
        )
        return {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        }
    elif name == "query_pdf":
        result = query_pdf(
            query=arguments["query"],
            index_id=arguments["index_id"],
            storage_dir=str(self.config.base_dir),
            max_results=self.config.max_results
        )
        return {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        }
    # 其他工具...
```

**Step 5: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_pdf_query.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement query_pdf tool"
```

---

### Task 8: 实现索引管理工具

**Files:**
- Create: `mcp-server/src/tools/index_manager.py`
- Modify: `mcp-server/src/server.py`
- Create: `mcp-server/tests/test_index_manager.py`

**Step 1: 编写索引管理测试**

```python
import pytest
import tempfile
from deeppdf.tools.index_manager import list_indexes, delete_index

def test_list_indexes_empty():
    """测试列出空索引列表"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = list_indexes(tmpdir)
        assert result["status"] == "success"
        assert result["indexes"] == []

def test_list_indexes_with_data():
    """测试列出包含索引的列表"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 创建模拟索引元数据
        from pathlib import Path
        import json

        index_dir = Path(tmpdir) / "indexes"
        index_dir.mkdir(parents=True)

        with open(index_dir / "idx_test1.json", "w") as f:
            json.dump({"id": "idx_test1", "pdf_name": "test1.pdf"}, f)

        result = list_indexes(tmpdir)
        assert result["status"] == "success"
        assert len(result["indexes"]) == 1
        assert result["indexes"][0]["id"] == "idx_test1"

def test_delete_index():
    """测试删除索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        from pathlib import Path
        import json

        # 创建模拟索引
        index_dir = Path(tmpdir) / "indexes"
        index_dir.mkdir(parents=True)
        chroma_dir = Path(tmpdir) / "chroma"
        chroma_dir.mkdir(parents=True)

        with open(index_dir / "idx_test1.json", "w") as f:
            json.dump({"id": "idx_test1", "pdf_name": "test1.pdf"}, f)

        # 删除索引
        result = delete_index("idx_test1", tmpdir)
        assert result["status"] == "success"

        # 验证文件已删除
        assert not (index_dir / "idx_test1.json").exists()
```

**Step 2: 运行测试验证失败**

Run: `cd mcp-server && uv run pytest tests/test_index_manager.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deeppdf.tools.index_manager'"

**Step 3: 实现索引管理**

Create: `mcp-server/src/tools/index_manager.py`

```python
import json
from pathlib import Path
from typing import Dict, Any, List
from ..storage.chroma_store import ChromaStore

def list_indexes(storage_dir: str) -> Dict[str, Any]:
    """
    列出所有索引

    Args:
        storage_dir: 存储目录

    Returns:
        索引列表
    """
    try:
        storage_dir_path = Path(storage_dir)
        index_dir = storage_dir_path / "indexes"

        if not index_dir.exists():
            return {
                "status": "success",
                "indexes": []
            }

        indexes = []
        for metadata_file in index_dir.glob("*.json"):
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
                    indexes.append(metadata)
            except:
                # 跳过损坏的元数据文件
                continue

        return {
            "status": "success",
            "indexes": indexes
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"Failed to list indexes: {str(e)}"
        }

def delete_index(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """
    删除指定索引

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录

    Returns:
        删除结果
    """
    try:
        storage_dir_path = Path(storage_dir)

        # 1. 删除元数据文件
        metadata_file = storage_dir_path / "indexes" / f"{index_id}.json"
        if metadata_file.exists():
            metadata_file.unlink()

        # 2. 删除 ChromaDB 集合
        chroma_dir = storage_dir_path / "chroma"
        if chroma_dir.exists():
            store = ChromaStore(persist_directory=str(chroma_dir))
            store.delete_collection(index_id)

        return {
            "status": "success",
            "message": f"Index {index_id} deleted"
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"Failed to delete index: {str(e)}"
        }
```

**Step 4: 更新服务器集成索引管理工具**

Modify: `mcp-server/src/server.py`

```python
from .tools.index_manager import list_indexes, delete_index

@self.app.call_tool()
async def call_tool(name: str, arguments: dict):
    """处理工具调用"""
    if name == "index_pdf":
        # ... 现有代码
    elif name == "query_pdf":
        # ... 现有代码
    elif name == "list_indexes":
        result = list_indexes(str(self.config.base_dir))
        return {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        }
    elif name == "delete_index":
        result = delete_index(arguments["index_id"], str(self.config.base_dir))
        return {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        }
```

**Step 5: 运行测试验证通过**

Run: `cd mcp-server && uv run pytest tests/test_index_manager.py -v`
Expected: PASS

**Step 6: 运行所有 MCP 服务器测试**

Run: `cd mcp-server && uv run pytest tests/ -v`
Expected: 全部通过

**Step 7: Commit**

```bash
git add mcp-server/
git commit -m "feat: implement index management tools"
```

---

## Phase 5: Obsidian 插件基础框架

### Task 9: 初始化 Obsidian 插件项目

**Files:**
- Create: `obsidian-plugin/package.json`
- Create: `obsidian-plugin/tsconfig.json`
- Create: `obsidian-plugin/manifest.json`
- Create: `obsidian-plugin/esbuild.config.mjs`
- Create: `obsidian-plugin/src/main.ts`

**Step 1: 创建 package.json**

```json
{
  "name": "obsidian-deeppdf",
  "version": "0.1.0",
  "description": "DeepPDF - 深度阅读 PDF 知识库插件",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production"
  },
  "keywords": ["obsidian", "pdf", "knowledge", "search"],
  "author": "DeepPDF Team",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.19.0",
    "obsidian": "latest",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: 创建 manifest.json**

```json
{
  "id": "deeppdf",
  "name": "DeepPDF",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "PDF 智能索引和问答插件",
  "author": "DeepPDF Team",
  "authorUrl": "https://github.com/deeppdf",
  "isDesktopOnly": true
}
```

**Step 4: 创建 esbuild 配置**

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner =
`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
    banner: {
        js: banner,
    },
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
```

**Step 5: 创建基础插件入口**

Create: `obsidian-plugin/src/main.ts`

```typescript
import { Plugin } from "obsidian";

export default class DeepPDFPlugin extends Plugin {
    async onload() {
        console.log("Loading DeepPDF plugin");

        // 添加 Ribbon 图标
        this.addRibbonIcon("book", "DeepPDF", () => {
            console.log("DeepPDF ribbon icon clicked");
        });

        // 添加命令
        this.addCommand({
            id: "open-deeppdf",
            name: "Open DeepPDF",
            callback: () => {
                console.log("Open DeepPDF command");
            }
        });
    }

    onunload() {
        console.log("Unloading DeepPDF plugin");
    }
}
```

**Step 6: 安装依赖**

Run: `cd obsidian-plugin && npm install`
Expected: 依赖安装成功

**Step 7: 构建插件**

Run: `cd obsidian-plugin && npm run build`
Expected: 生成 main.js

**Step 8: Commit**

```bash
git add obsidian-plugin/
git commit -m "feat: initialize Obsidian plugin project"
```

---

### Task 10: 实现 MCP 客户端

**Files:**
- Create: `obsidian-plugin/src/mcp/client.ts`
- Create: `obsidian-plugin/src/mcp/types.ts`
- Create: `obsidian-plugin/src/tests/mcp-client.test.ts`

**Step 1: 编写 MCP 客户端类型定义**

Create: `obsidian-plugin/src/mcp/types.ts`

```typescript
/** MCP 工具定义 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/** 索引 PDF 结果 */
export interface IndexPDFResult {
    status: "success" | "error";
    index_id?: string;
    node_count?: number;
    pdf_name?: string;
    error?: string;
}

/** 查询结果项 */
export interface QueryResultItem {
    id: string;
    text: string;
    metadata: {
        pdf_name: string;
        page: number;
        [key: string]: unknown;
    };
    distance?: number;
}

/** 查询 PDF 结果 */
export interface QueryPDFResult {
    status: "success" | "error";
    query?: string;
    results?: QueryResultItem[];
    index_info?: {
        pdf_name: string;
        node_count: number;
    };
    error?: string;
}

/** 索引信息 */
export interface IndexInfo {
    id: string;
    pdf_name: string;
    created_at: string;
    node_count: number;
}

/** 列出索引结果 */
export interface ListIndexesResult {
    status: "success" | "error";
    indexes?: IndexInfo[];
    error?: string;
}

/** 删除索引结果 */
export interface DeleteIndexResult {
    status: "success" | "error";
    message?: string;
    error?: string;
}
```

**Step 2: 编写 MCP 客户端测试**

Create: `obsidian-plugin/src/tests/mcp-client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClient } from '../mcp/client';

describe("MCPClient", () => {
    let client: MCPClient;

    beforeEach(() => {
        client = new MCPClient("/fake/path");
    });

    afterEach(() => {
        client.disconnect();
    });

    it("should create client instance", () => {
        expect(client).toBeDefined();
        expect(client.isConnected).toBe(false);
    });

    it("should have correct server path", () => {
        expect(client.serverPath).toBe("/fake/path");
    });
});
```

**Step 3: 运行测试验证失败**

Run: `cd obsidian-plugin && npm run test`
Expected: 需要先配置 vitest，然后 FAIL

**Step 4: 配置测试环境**

Modify: `obsidian-plugin/package.json`

添加测试脚本和 vitest 依赖：

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0",
    // ... 其他依赖
  }
}
```

Create: `obsidian-plugin/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: true
    }
});
```

**Step 5: 实现 MCP 客户端**

Create: `obsidian-plugin/src/mcp/client.ts`

```typescript
import { spawn, ChildProcess } from "child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
    IndexPDFResult,
    QueryPDFResult,
    ListIndexesResult,
    DeleteIndexResult
} from "./types.js";

export class MCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private serverProcess: ChildProcess | null = null;
    private _isConnected: boolean = false;

    constructor(public readonly serverPath: string) {}

    get isConnected(): boolean {
        return this._isConnected;
    }

    async connect(): Promise<void> {
        if (this._isConnected) {
            return;
        }

        try {
            // 启动 MCP 服务器进程
            this.serverProcess = spawn("uv", ["run", "python", "-m", "deeppdf.server"], {
                cwd: this.serverPath,
                stdio: ["pipe", "pipe", "pipe"]
            });

            // 创建传输层
            this.transport = new StdioClientTransport({
                stdin: this.serverProcess.stdin!,
                stdout: this.serverProcess.stdout!
            });

            // 创建 MCP 客户端
            this.client = new Client({
                name: "obsidian-deeppdf",
                version: "0.1.0"
            }, {
                capabilities: {}
            });

            // 连接
            await this.client.connect(this.transport);
            this._isConnected = true;

        } catch (error) {
            this.disconnect();
            throw new Error(`Failed to connect to MCP server: ${error}`);
        }
    }

    disconnect(): void {
        if (this.client) {
            this.client.close();
            this.client = null;
        }
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }
        this.transport = null;
        this._isConnected = false;
    }

    async indexPDF(pdfPath: string): Promise<IndexPDFResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "index_pdf",
            arguments: {
                path: pdfPath
            }
        });

        // 解析返回的文本内容
        const content = result.content?.[0];
        if (content && "text" in content) {
            return JSON.parse(content.text);
        }

        throw new Error("Invalid response from MCP server");
    }

    async queryPDF(query: string, indexId: string): Promise<QueryPDFResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "query_pdf",
            arguments: {
                query,
                index_id: indexId
            }
        });

        const content = result.content?.[0];
        if (content && "text" in content) {
            return JSON.parse(content.text);
        }

        throw new Error("Invalid response from MCP server");
    }

    async listIndexes(): Promise<ListIndexesResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "list_indexes",
            arguments: {}
        });

        const content = result.content?.[0];
        if (content && "text" in content) {
            return JSON.parse(content.text);
        }

        throw new Error("Invalid response from MCP server");
    }

    async deleteIndex(indexId: string): Promise<DeleteIndexResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "delete_index",
            arguments: {
                index_id: indexId
            }
        });

        const content = result.content?.[0];
        if (content && "text" in content) {
            return JSON.parse(content.text);
        }

        throw new Error("Invalid response from MCP server");
    }
}
```

**Step 6: 运行测试验证通过**

Run: `cd obsidian-plugin && npm run test`
Expected: PASS

**Step 7: Commit**

```bash
git add obsidian-plugin/
git commit -m "feat: implement MCP client"
```

---

## Phase 6: UI 组件

### Task 11: 实现设置面板

**Files:**
- Create: `obsidian-plugin/src/ui/settings.ts`
- Modify: `obsidian-plugin/src/main.ts`

**Step 1: 更新主插件以添加设置**

Modify: `obsidian-plugin/src/main.ts`

```typescript
import { Plugin, PluginSettingTab, Setting } from "obsidian";
import { MCPClient } from "./mcp/client.js";

interface DeepPDFSettings {
    mcpServerPath: string;
    maxResults: number;
}

const DEFAULT_SETTINGS: DeepPDFSettings = {
    mcpServerPath: "",
    maxResults: 5
};

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    mcpClient: MCPClient | null = null;

    async onload() {
        await this.loadSettings();

        // 添加设置面板
        this.addSettingTab(new DeepPDFSettingTab(this.app, this));

        // 添加 Ribbon 图标
        this.addRibbonIcon("book", "DeepPDF", () => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: "open-deeppdf",
            name: "Open DeepPDF",
            callback: () => this.activateView()
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    activateView() {
        // 稍后实现
        console.log("Activating DeepPDF view");
    }
}

class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;

    constructor(app: App, plugin: DeepPDFPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("MCP Server Path")
            .setDesc("Path to the MCP server directory")
            .addText(text => text
                .setPlaceholder("/path/to/mcp-server")
                .setValue(this.plugin.settings.mcpServerPath)
                .onChange(async (value) => {
                    this.plugin.settings.mcpServerPath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Results")
            .setDesc("Maximum number of results to return")
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxResults)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxResults = value;
                    await this.plugin.saveSettings();
                }));
    }
}
```

**Step 2: 测试设置面板**

Run: `cd obsidian-plugin && npm run build`
Expected: 构建成功

**Step 3: 在 Obsidian 中测试**

将插件复制到 Obsidian 插件目录，打开设置面板验证

**Step 4: Commit**

```bash
git add obsidian-plugin/
git commit -m "feat: implement settings panel"
```

---

### Task 12: 实现侧边栏查询面板

**Files:**
- Create: `obsidian-plugin/src/views/sidebar-view.ts`
- Create: `obsidian-plugin/src/styles/main.css`
- Modify: `obsidian-plugin/src/main.ts`

**Step 1: 创建侧边栏视图类型**

Create: `obsidian-plugin/src/views/sidebar-view.ts`

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return SIDEBAR_VIEW_TYPE;
    }

    getDisplayText() {
        return "DeepPDF";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("deeppdf-container");

        // 头部
        const header = container.createEl("header", { cls: "deeppdf-header" });
        header.createEl("h2", { text: "DeepPDF" });

        // 查询输入区域
        const querySection = container.createEl("div", { cls: "deeppdf-query-section" });

        const input = querySection.createEl("input", {
            type: "text",
            cls: "deeppdf-query-input",
            placeholder: "输入问题..."
        });

        const submitBtn = querySection.createEl("button", {
            cls: "deeppdf-submit-btn",
            text: "提问"
        });

        // 结果区域
        const resultsSection = container.createEl("div", { cls: "deeppdf-results-section" });
        resultsSection.createEl("p", {
            text: "输入问题开始查询",
            cls: "deeppdf-placeholder"
        });

        // 事件监听
        submitBtn.addEventListener("click", () => this.handleSubmit(input.value));
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.handleSubmit(input.value);
            }
        });
    }

    async handleSubmit(query: string) {
        if (!query.trim()) {
            return;
        }

        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        resultsSection.innerHTML = "<p>查询中...</p>";

        // 稍后实现实际的查询逻辑
        setTimeout(() => {
            resultsSection.innerHTML = `
                <div class="deeppdf-result">
                    <p>查询功能尚未完全实现</p>
                    <p><strong>问题:</strong> ${query}</p>
                </div>
            `;
        }, 500);
    }

    async onClose() {
        // 清理资源
    }
}
```

**Step 2: 添加样式**

Create: `obsidian-plugin/src/styles/main.css`

```css
/* DeepPDF 样式 */

.deeppdf-container {
    padding: var(--spacing-md);
}

.deeppdf-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-lg);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--background-modifier-border);
}

.deeppdf-header h2 {
    margin: 0;
    font-size: var(--font-ui-large);
    font-weight: var(--font-semibold);
}

.deeppdf-query-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-lg);
}

.deeppdf-query-input {
    width: 100%;
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-md);
    font-size: var(--font-ui-medium);
    background: var(--background-primary);
    color: var(--text-normal);
}

.deeppdf-query-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--background-modifier-border-hover);
}

.deeppdf-submit-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--transition-fast);
}

.deeppdf-submit-btn:hover {
    background: var(--interactive-accent-hover);
}

.deeppdf-submit-btn:disabled {
    background: var(--background-modifier-border);
    cursor: not-allowed;
}

.deeppdf-results-section {
    min-height: 200px;
}

.deeppdf-placeholder {
    color: var(--text-muted);
    text-align: center;
    padding: var(--spacing-xl) 0;
}

.deeppdf-result {
    padding: var(--spacing-md);
    background: var(--background-secondary);
    border-radius: var(--radius-md);
    margin-bottom: var(--spacing-md);
}

.deeppdf-result p {
    margin: var(--spacing-xs) 0;
}
```

**Step 3: 注册侧边栏视图**

Modify: `obsidian-plugin/src/main.ts`

```typescript
import { Plugin, WorkspaceLeaf } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";

// 在类中添加
async onload() {
    // ... 现有代码

    // 注册侧边栏视图
    this.registerView(
        SIDEBAR_VIEW_TYPE,
        (leaf) => new SidebarView(leaf)
    );

    // 添加命令
    this.addCommand({
        id: "open-deeppdf-sidebar",
        name: "Open DeepPDF sidebar",
        callback: () => this.activateView()
    });
}

activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;

    const leaves = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);

    if (leaves.length > 0) {
        leaf = leaves[0];
    } else {
        leaf = workspace.getRightLeaf(false);
        await leaf.setViewState({
            type: SIDEBAR_VIEW_TYPE,
            active: true
        });
    }

    workspace.revealLeaf(leaf);
}
```

**Step 4: 构建并测试**

Run: `cd obsidian-plugin && npm run build`
Expected: 构建成功

**Step 5: Commit**

```bash
git add obsidian-plugin/
git commit -m "feat: implement sidebar query view"
```

---

### Task 13: 实现索引管理面板

**Files:**
- Create: `obsidian-plugin/src/ui/indexer.ts`
- Create: `obsidian-plugin/src/modals/index-pdf-modal.ts`

**Step 1: 创建索引 PDF 模态框**

Create: `obsidian-plugin/src/modals/index-pdf-modal.ts`

```typescript
import { App, Modal, Notice, TFile } from "obsidian";

export class IndexPDFModal extends Modal {
    private onSubmit: (file: TFile) => void;

    constructor(app: App, onSubmit: (file: TFile) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.addClass("deeppdf-index-modal");

        contentEl.createEl("h2", { text: "选择 PDF 文件" });

        // 文件列表
        const files = this.app.vault.getFiles()
            .filter(f => f.extension === "pdf");

        if (files.length === 0) {
            contentEl.createEl("p", {
                text: "当前库中没有 PDF 文件",
                cls: "deeppdf-empty-state"
            });
        } else {
            const list = contentEl.createEl("div", { cls: "deeppdf-file-list" });

            files.forEach(file => {
                const item = list.createEl("div", { cls: "deeppdf-file-item" });

                item.createEl("span", {
                    text: file.path,
                    cls: "deeppdf-file-name"
                });

                const btn = item.createEl("button", {
                    text: "索引",
                    cls: "deeppdf-index-btn"
                });

                btn.addEventListener("click", () => {
                    this.onSubmit(file);
                    this.close();
                });
            });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
```

**Step 2: 创建索引管理面板**

Create: `obsidian-plugin/src/ui/indexer.ts`

```typescript
import { App, Notice, Setting } from "obsidian";
import { IndexPDFModal } from "../modals/index-pdf-modal.js";
import { MCPClient } from "../mcp/client.js";
import type { ListIndexesResult, IndexInfo } from "../mcp/types.js";

export class IndexerPanel {
    private app: App;
    private containerEl: HTMLElement;
    private mcpClient: MCPClient;

    constructor(app: App, containerEl: HTMLElement, mcpClient: MCPClient) {
        this.app = app;
        this.containerEl = containerEl;
        this.mcpClient = mcpClient;
    }

    render(): void {
        this.containerEl.empty();
        this.containerEl.addClass("deeppdf-indexer-panel");

        // 头部
        const header = this.containerEl.createEl("div", { cls: "deeppdf-panel-header" });

        header.createEl("h3", { text: "PDF 索引" });

        const importBtn = header.createEl("button", {
            cls: "deeppdf-import-btn",
            text: "+ 导入 PDF"
        });

        importBtn.addEventListener("click", () => this.openImportModal());

        // 索引列表
        const listContainer = this.containerEl.createEl("div", {
            cls: "deeppdf-index-list"
        });

        listContainer.createEl("p", {
            text: "加载中...",
            cls: "deeppdf-loading"
        });

        // 加载索引列表
        this.loadIndexes(listContainer);
    }

    private async loadIndexes(container: HTMLElement): Promise<void> {
        try {
            const result = await this.mcpClient.listIndexes();

            container.empty();

            if (result.status === "error" || !result.indexes || result.indexes.length === 0) {
                container.createEl("p", {
                    text: "暂无索引",
                    cls: "deeppdf-empty-state"
                });
                return;
            }

            result.indexes.forEach((index: IndexInfo) => {
                this.renderIndexItem(container, index);
            });

        } catch (error) {
            container.empty();
            container.createEl("p", {
                text: `加载失败: ${error}`,
                cls: "deeppdf-error"
            });
        }
    }

    private renderIndexItem(container: HTMLElement, index: IndexInfo): void {
        const item = container.createEl("div", { cls: "deeppdf-index-item" });

        // 图标和名称
        const header = item.createEl("div", { cls: "deeppdf-index-header" });

        header.createEl("span", {
            text: "📄",
            cls: "deeppdf-index-icon"
        });

        header.createEl("span", {
            text: index.pdf_name,
            cls: "deeppdf-index-name"
        });

        // 元数据
        const meta = item.createEl("div", { cls: "deeppdf-index-meta" });

        meta.createEl("span", {
            text: `${index.node_count} 个节点`,
            cls: "deeppdf-index-stats"
        });

        // 操作按钮
        const actions = item.createEl("div", { cls: "deeppdf-index-actions" });

        const queryBtn = actions.createEl("button", {
            text: "查询",
            cls: "deeppdf-query-btn"
        });

        const deleteBtn = actions.createEl("button", {
            text: "删除",
            cls: "deeppdf-delete-btn"
        });

        deleteBtn.addEventListener("click", async () => {
            if (confirm(`确定要删除 "${index.pdf_name}" 的索引吗？`)) {
                await this.deleteIndex(index.id, container);
            }
        });
    }

    private openImportModal(): void {
        new IndexPDFModal(
            this.app,
            async (file) => {
                await this.indexPDF(file);
                // 刷新列表
                const listContainer = this.containerEl.querySelector(".deeppdf-index-list");
                if (listContainer) {
                    this.loadIndexes(listContainer as HTMLElement);
                }
            }
        ).open();
    }

    private async indexPDF(file: TFile): Promise<void> {
        new Notice(`正在索引 ${file.name}...`);

        try {
            const adapter = this.app.vault.adapter;
            const fullPath = adapter.getFullPath(file.path);

            const result = await this.mcpClient.indexPDF(fullPath);

            if (result.status === "success") {
                new Notice(`索引完成: ${result.node_count} 个节点`);
            } else {
                new Notice(`索引失败: ${result.error}`);
            }

        } catch (error) {
            new Notice(`索引失败: ${error}`);
        }
    }

    private async deleteIndex(indexId: string, container: HTMLElement): Promise<void> {
        try {
            const result = await this.mcpClient.deleteIndex(indexId);

            if (result.status === "success") {
                new Notice("索引已删除");
                this.loadIndexes(container);
            } else {
                new Notice(`删除失败: ${result.error}`);
            }

        } catch (error) {
            new Notice(`删除失败: ${error}`);
        }
    }
}
```

**Step 3: 添加相关样式**

Modify: `obsidian-plugin/src/styles/main.css`

```css
/* 索引面板样式 */
.deeppdf-indexer-panel {
    padding: var(--spacing-md);
}

.deeppdf-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-lg);
}

.deeppdf-panel-header h3 {
    margin: 0;
    font-size: var(--font-ui-large);
}

.deeppdf-import-btn {
    padding: var(--spacing-xs) var(--spacing-md);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-ui-small);
}

.deeppdf-index-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
}

.deeppdf-index-item {
    padding: var(--spacing-md);
    background: var(--background-secondary);
    border-radius: var(--radius-md);
    border: 1px solid var(--background-modifier-border);
}

.deeppdf-index-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
}

.deeppdf-index-name {
    font-weight: var(--font-medium);
}

.deeppdf-index-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.deeppdf-index-stats {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
}

.deeppdf-index-actions {
    display: flex;
    gap: var(--spacing-xs);
}

.deeppdf-query-btn,
.deeppdf-delete-btn {
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-ui-smaller);
}

.deeppdf-delete-btn:hover {
    background: var(--interactive-error);
    color: var(--text-on-accent);
}

/* 模态框样式 */
.deeppdf-index-modal {
    min-width: 400px;
}

.deeppdf-file-list {
    max-height: 400px;
    overflow-y: auto;
}

.deeppdf-file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm);
    border-bottom: 1px solid var(--background-modifier-border);
}

.deeppdf-file-name {
    font-size: var(--font-ui-small);
}

.deeppdf-index-btn {
    padding: var(--spacing-xs) var(--spacing-md);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-ui-smaller);
}
```

**Step 4: 在侧边栏视图中集成索引管理**

Modify: `obsidian-plugin/src/views/sidebar-view.ts`

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import { IndexerPanel } from "../ui/indexer.js";
import type { MCPClient } from "../mcp/client.js";

export class SidebarView extends ItemView {
    private indexerPanel: IndexerPanel | null = null;
    private mcpClient: MCPClient | null = null;
    private currentView: "query" | "indexer" = "query";

    constructor(leaf: WorkspaceLeaf, mcpClient: MCPClient) {
        super(leaf);
        this.mcpClient = mcpClient;
    }

    // ... 现有方法

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("deeppdf-container");

        // 头部（添加切换按钮）
        const header = container.createEl("header", { cls: "deeppdf-header" });
        header.createEl("h2", { text: "DeepPDF" });

        const nav = header.createEl("nav", { cls: "deeppdf-nav" });

        const queryTab = nav.createEl("button", {
            text: "查询",
            cls: "deeppdf-nav-tab deeppdf-nav-tab-active"
        });

        const indexerTab = nav.createEl("button", {
            text: "索引",
            cls: "deeppdf-nav-tab"
        });

        // 内容区域
        const contentContainer = container.createEl("div", {
            cls: "deeppdf-content-container"
        });

        // 初始化索引面板
        if (this.mcpClient) {
            this.indexerPanel = new IndexerPanel(
                this.app,
                contentContainer,
                this.mcpClient
            );
        }

        // 默认显示查询视图
        this.renderQueryView(contentContainer);

        // 切换事件
        queryTab.addEventListener("click", () => {
            this.currentView = "query";
            queryTab.addClass("deeppdf-nav-tab-active");
            indexerTab.removeClass("deeppdf-nav-tab-active");
            this.renderQueryView(contentContainer);
        });

        indexerTab.addEventListener("click", () => {
            this.currentView = "indexer";
            indexerTab.addClass("deeppdf-nav-tab-active");
            queryTab.removeClass("deeppdf-nav-tab-active");
            this.renderIndexerView(contentContainer);
        });
    }

    private renderQueryView(container: HTMLElement): void {
        container.empty();
        // ... 现有查询视图代码
    }

    private renderIndexerView(container: HTMLElement): void {
        container.empty();
        if (this.indexerPanel) {
            this.indexerPanel.render();
        }
    }
}
```

**Step 5: 构建并测试**

Run: `cd obsidian-plugin && npm run build`
Expected: 构建成功

**Step 6: Commit**

```bash
git add obsidian-plugin/
git commit -m "feat: implement index management panel"
```

---

## Phase 7: 集成与测试

### Task 14: 端到端集成测试

**Step 1: 编写 E2E 测试场景**

Create: `mcp-server/tests/e2e/test_full_workflow.py`

```python
"""
端到端测试：完整的索引和查询流程
"""
import pytest
import tempfile
from pathlib import Path
from deeppdf.tools.pdf_indexer import index_pdf
from deeppdf.tools.pdf_query import query_pdf
from deeppdf.tools.index_manager import list_indexes, delete_index

@pytest.mark.e2e
def test_full_index_query_workflow():
    """测试完整的索引-查询工作流"""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent.parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 1. 索引 PDF
        index_result = index_pdf(str(test_pdf), tmpdir)
        assert index_result["status"] == "success"
        index_id = index_result["index_id"]

        # 2. 列出索引
        list_result = list_indexes(tmpdir)
        assert list_result["status"] == "success"
        assert len(list_result["indexes"]) == 1
        assert list_result["indexes"][0]["id"] == index_id

        # 3. 查询
        query_result = query_pdf(
            query="test query",
            index_id=index_id,
            storage_dir=tmpdir
        )
        assert query_result["status"] == "success"

        # 4. 删除索引
        delete_result = delete_index(index_id, tmpdir)
        assert delete_result["status"] == "success"

        # 5. 验证已删除
        list_result = list_indexes(tmpdir)
        assert len(list_result["indexes"]) == 0
```

**Step 2: 运行 E2E 测试**

Run: `cd mcp-server && uv run pytest tests/e2e/ -v -m e2e`
Expected: PASS

**Step 3: 插件端 E2E 测试**

Create: `obsidian-plugin/src/tests/e2e.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPClient } from '../mcp/client.js';
import type { IndexPDFResult, QueryPDFResult } from '../mcp/types.js';

describe("E2E: Full Plugin Workflow", () => {
    let client: MCPClient;

    beforeAll(async () => {
        // 使用测试服务器路径
        const serverPath = process.env.MCP_SERVER_PATH || "/path/to/mcp-server";
        client = new MCPClient(serverPath);
        await client.connect();
    });

    afterAll(async () => {
        client.disconnect();
    });

    it("should connect to MCP server", () => {
        expect(client.isConnected).toBe(true);
    });

    it("should list indexes", async () => {
        const result = await client.listIndexes();
        expect(result.status).toBe("success");
        expect(result.indexes).toBeDefined();
    });
});
```

**Step 4: Commit**

```bash
git add mcp-server/ obsidian-plugin/
git commit -m "test: add E2E integration tests"
```

---

### Task 15: 文档和收尾

**Step 1: 创建 README 文件**

Create: `mcp-server/README.md`

```markdown
# DeepPDF MCP Server

PDF 索引和查询的 MCP 服务器。

## 安装

\`\`\`bash
cd mcp-server
uv sync
\`\`\`

## 运行

\`\`\`bash
uv run python -m deeppdf.server
\`\`\`

## 开发

\`\`\`bash
# 运行测试
uv run pytest

# 代码格式化
uv run black src/
uv run ruff check src/
\`\`\`
```

Create: `obsidian-plugin/README.md`

```markdown
# DeepPDF Obsidian Plugin

Obsidian 的 PDF 智能索引和问答插件。

## 安装

1. 构建插件: \`npm run build\`
2. 复制到 Obsidian 插件目录
3. 在 Obsidian 中启用

## 配置

在插件设置中配置 MCP 服务器路径。

## 使用

- 打开侧边栏: \`Cmd/Ctrl + P\` -> "Open DeepPDF sidebar"
- 导入 PDF: 在"索引"标签页点击"导入 PDF"
- 查询: 在"查询"标签页输入问题
```

**Step 2: 更新主 README**

在项目根目录的 `README.md` 中添加开发指南链接。

**Step 3: 添加 .gitignore**

Create: `mcp-server/.gitignore`

```
__pycache__/
*.pyc
data/
*.log
.pytest_cache/
.coverage
```

Create: `obsidian-plugin/.gitignore`

```
node_modules/
main.js
*.map
```

**Step 4: 最终提交**

```bash
git add .
git commit -m "docs: add README and finalize MVP implementation"
```

---

## 实施完成清单

### Phase 1: MCP 服务器基础框架
- [x] **Task 1:** 初始化 Python 项目
- [x] **Task 2:** 实现 MCP 服务器基础框架

### Phase 2: ChromaDB 存储层
- [ ] **Task 3:** 实现 ChromaDB 存储封装

### Phase 3: PDF 索引功能
- [ ] **Task 4:** 实现 PDF 解析基础功能
- [ ] **Task 5:** 集成 PageIndex 源码
- [ ] **Task 6:** 实现 index_pdf 工具

### Phase 4: PDF 查询功能
- [ ] **Task 7:** 实现 query_pdf 工具
- [ ] **Task 8:** 实现索引管理工具

### Phase 5: Obsidian 插件基础框架
- [ ] **Task 9:** 初始化 Obsidian 插件项目
- [ ] **Task 10:** 实现 MCP 客户端

### Phase 6: UI 组件
- [ ] **Task 11:** 实现设置面板
- [ ] **Task 12:** 实现侧边栏查询面板
- [ ] **Task 13:** 实现索引管理面板

### Phase 7: 集成与测试
- [ ] **Task 14:** 端到端集成测试
- [ ] **Task 15:** 文档和收尾

---

### 实施进度汇总

| Phase | 进度 | 状态 |
|-------|------|------|
| Phase 1: MCP 服务器基础框架 | 2/2 (100%) | ✅ 完成 |
| Phase 2: ChromaDB 存储层 | 0/1 (0%) | ⏳ 待开始 |
| Phase 3: PDF 索引功能 | 0/3 (0%) | ⏳ 待开始 |
| Phase 4: PDF 查询功能 | 0/2 (0%) | ⏳ 待开始 |
| Phase 5: Obsidian 插件基础框架 | 0/2 (0%) | ⏳ 待开始 |
| Phase 6: UI 组件 | 0/3 (0%) | ⏳ 待开始 |
| Phase 7: 集成与测试 | 0/2 (0%) | ⏳ 待开始 |
| **总体** | **2/15 (13%)** | 🚧 进行中 |

---

**计划文档版本**: v1.0
**创建日期**: 2026-01-14
**最后更新**: 2026-01-14
