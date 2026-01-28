# PageIndex EPUB 支持实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 PageIndex 库中添加 EPUB 文档解析支持，生成与 PDF 兼容的 tree_structure 格式。

**Architecture:** 使用 ebooklib 解析 EPUB → 提取章节内容和 TOC → 转换为 PageIndex tree_structure 格式 → 支持现有的 LLM 摘要生成流程。

**Tech Stack:** Python 3.10+, ebooklib, beautifulsoup4, html2text, pytest

---

## 项目信息

- **代码库**: `/Users/lizhao/workspace/mygithub/PageIndex`
- **依赖管理**: pip / setup.py
- **测试框架**: pytest

---

## Task 1: 添加 EPUB 依赖

**Files:**
- Modify: `setup.py` 或 `pyproject.toml`

**Step 1: 更新依赖配置**

```python
# setup.py 或 pyproject.toml

install_requires=[
    "PyPDF2>=3.0.0",
    "pymupdf>=1.23.0",
    "tiktoken",
    "openai>=1.0.0",

    # 新增 EPUB 依赖
    "ebooklib>=0.18",
    "beautifulsoup4>=4.12.0",
    "html2text>=2020.1.16",
]
```

**Step 2: 安装依赖验证**

Run: `pip install ebooklib beautifulsoup4 html2text`

Expected: 成功安装，无错误

**Step 3: Commit**

```bash
git add setup.py
git commit -m "deps: 添加 EPUB 解析依赖 (ebooklib, beautifulsoup4, html2text)"
```

---

## Task 2: 创建 epub_parser.py

**Files:**
- Create: `pageindex/epub_parser.py`
- Create: `tests/test_epub_parser.py`

**Step 1: Write the failing test**

```python
# tests/test_epub_parser.py
import pytest
from pageindex.epub_parser import EpubParser

def test_epub_parser_initialization():
    """测试 EpubParser 初始化"""
    parser = EpubParser("tests/fixtures/sample.epub")
    assert parser.epub_path == "tests/fixtures/sample.epub"
    assert parser.book is None

def test_epub_parser_load():
    """测试加载 EPUB 文件"""
    parser = EpubParser("tests/fixtures/sample.epub")
    parser.load()
    assert parser.book is not None

def test_get_metadata():
    """测试获取元数据"""
    parser = EpubParser("tests/fixtures/sample.epub")
    parser.load()
    metadata = parser.get_metadata()

    assert "title" in metadata
    assert "author" in metadata
    assert isinstance(metadata["title"], str)

def test_get_toc():
    """测试获取目录结构"""
    parser = EpubParser("tests/fixtures/sample.epub")
    parser.load()
    toc = parser.get_toc()

    assert isinstance(toc, list)
    assert len(toc) > 0  # 假设有目录

def test_get_chapters():
    """测试获取章节内容"""
    parser = EpubParser("tests/fixtures/sample.epub")
    parser.load()
    chapters = parser.get_chapters()

    assert isinstance(chapters, list)
    if chapters:
        assert "file_name" in chapters[0]
        assert "content" in chapters[0]

def test_html_to_text():
    """测试 HTML 转纯文本"""
    parser = EpubParser("tests/fixtures/sample.epub")

    html = "<html><body><h1>Chapter 1</h1><p>Content</p></body></html>"
    text = parser._html_to_text(html)

    assert "<h1>" not in text
    assert "Chapter 1" in text
    assert "Content" in text
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_epub_parser.py -v`

Expected: `ModuleNotFoundError: No module named 'pageindex.epub_parser'`

**Step 3: Write minimal implementation**

```python
# pageindex/epub_parser.py
"""
EPUB 文档解析器

使用 ebooklib 解析 EPUB 文件，提取元数据、目录和章节内容。
"""
import logging
from typing import Dict, Any, List
from ebooklib import epub
from bs4 import BeautifulSoup
import html2text

logger = logging.getLogger(__name__)


class EpubParser:
    """
    EPUB 文件解析器

    解析 EPUB 文件，提取：
    - 元数据（书名、作者等）
    - 目录结构（TOC）
    - 章节内容（纯文本）
    """

    def __init__(self, epub_path: str):
        """
        初始化 EPUB 解析器

        Args:
            epub_path: EPUB 文件路径
        """
        self.epub_path = epub_path
        self.book = None

    def load(self) -> None:
        """
        加载 EPUB 文件

        Raises:
            FileNotFoundError: 文件不存在
            Exception: 解析失败
        """
        logger.info(f"[EPUB] 正在加载: {self.epub_path}")
        self.book = epub.read_epub(self.epub_path)
        logger.info("[EPUB] 文件加载成功")

    def get_metadata(self) -> Dict[str, Any]:
        """
        获取 EPUB 元数据

        Returns:
            包含 title, author, language 等字段的字典
        """
        if not self.book:
            raise RuntimeError("请先调用 load() 加载 EPUB 文件")

        metadata = {}

        # 获取标题
        titles = self.book.get_metadata("DC", "title")
        if titles:
            metadata["title"] = titles[0]

        # 获取作者
        creators = self.book.get_metadata("DC", "creator")
        if creators:
            metadata["author"] = creators[0]

        # 获取语言
        languages = self.book.get_metadata("DC", "language")
        if languages:
            metadata["language"] = languages[0]

        logger.info(f"[EPUB] 元数据: {metadata.get('title', 'Unknown')}")
        return metadata

    def get_toc(self) -> List[Any]:
        """
        获取 EPUB 目录结构

        Returns:
            TOC 列表，每个元素可能是：
            - epub.Link（单个章节）
            - (epub.Link, epub.Section, [...])（带子章节）
            - (epub.Link, [...])（简化嵌套结构）
        """
        if not self.book:
            raise RuntimeError("请先调用 load() 加载 EPUB 文件")

        toc = self.book.get_toc()
        logger.info(f"[EPUB] TOC 条目数: {len(toc)}")
        return toc

    def get_chapters(self) -> List[Dict[str, str]]:
        """
        获取所有章节内容

        Returns:
            章节列表，每个包含 file_name 和 content（纯文本）
        """
        if not self.book:
            raise RuntimeError("请先调用 load() 加载 EPUB 文件")

        chapters = []

        for item in self.book.get_items():
            if isinstance(item, epub.EpubHtml):
                file_name = item.get_name()
                content_bytes = item.get_content()

                # 转换为纯文本
                content = self._html_to_text(content_bytes.decode("utf-8"))

                chapters.append({
                    "file_name": file_name,
                    "content": content,
                })

        logger.info(f"[EPUB] 提取章节数: {len(chapters)}")
        return chapters

    def _html_to_text(self, html: str) -> str:
        """
        HTML 转纯文本

        Args:
            html: HTML 内容字符串

        Returns:
            纯文本内容
        """
        h = html2text.HTML2Text()
        h.ignore_links = True
        h.ignore_images = True
        h.ignore_emphasis = True
        h.ignore_tables = False  # 保留表格结构

        text = h.handle(html)
        return text.strip()
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_epub_parser.py -v`

Expected: 部分通过（需要 sample.epub fixture，后续测试会处理）

**Step 5: Commit**

```bash
git add pageindex/epub_parser.py tests/test_epub_parser.py
git commit -m "feat(epub): 添加 EPUB 解析器模块"
```

---

## Task 3: 创建 epub_to_tree.py

**Files:**
- Create: `pageindex/epub_to_tree.py`
- Create: `tests/test_epub_to_tree.py`

**Step 1: Write the failing test**

```python
# tests/test_epub_to_tree.py
import pytest
from pageindex.epub_to_tree import epub_to_tree, EpubTreeConverter

def test_epub_to_tree_basic():
    """测试基本的 EPUB → tree 转换"""
    epub_data = {
        "metadata": {"title": "Test Book", "author": "Test Author"},
        "toc": [],
        "chapters": [
            {"file_name": "chapter1.html", "content": "Chapter 1 content"},
        ],
    }

    tree = epub_to_tree(epub_data, assign_node_ids=True)

    assert tree["title"] == "Test Book"
    assert "structure" in tree
    assert isinstance(tree["structure"], list)

def test_converter_with_toc():
    """测试带 TOC 的转换"""
    from ebooklib import epub

    # 模拟 TOC 结构
    link = epub.Link("chapter1.html", "Chapter 1")

    epub_data = {
        "metadata": {"title": "Test"},
        "toc": [link],
        "chapters": {"chapter1.html": {"content": "Content"}},
    }

    converter = EpubTreeConverter()
    tree = converter.convert(epub_data, assign_node_ids=False)

    assert len(tree["structure"]) == 1
    assert tree["structure"][0]["title"] == "Chapter 1"

def test_node_id_assignment():
    """测试 node_id 分配"""
    epub_data = {
        "metadata": {"title": "Test"},
        "toc": ["chapter1", "chapter2", "chapter3"],  # 简化
        "chapters": [],
    }

    tree = epub_to_tree(epub_data, assign_node_ids=True)

    assert tree["structure"][0]["node_id"] == "0001"
    assert tree["structure"][1]["node_id"] == "0002"
    assert tree["structure"][2]["node_id"] == "0003"

def test_nested_toc():
    """测试嵌套 TOC 结构"""
    epub_data = {
        "metadata": {"title": "Test"},
        "toc": [("Part 1", [("Chapter 1", ...), ("Chapter 2", ...)])],
        "chapters": {},
    }

    # 验证嵌套结构正确转换
    converter = EpubTreeConverter()
    tree = converter.convert(epub_data, assign_node_ids=False)

    assert tree["structure"][0]["title"] == "Part 1"
    assert "nodes" in tree["structure"][0]
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_epub_to_tree.py -v`

Expected: `ModuleNotFoundError: No module named 'pageindex.epub_to_tree'`

**Step 3: Write minimal implementation**

```python
# pageindex/epub_to_tree.py
"""
EPUB → PageIndex 树结构转换器

将 EPUB 解析结果转换为 PageIndex 的 tree_structure 格式。
"""
import logging
from typing import Dict, Any, List
from ebooklib import epub

logger = logging.getLogger(__name__)


def epub_to_tree(
    epub_data: Dict[str, Any],
    assign_node_ids: bool = True
) -> Dict[str, Any]:
    """
    将 EPUB 数据转换为 PageIndex tree_structure 格式

    Args:
        epub_data: EpubParser 解析结果，包含 metadata, toc, chapters
        assign_node_ids: 是否分配 node_id（0001, 0002...）

    Returns:
        PageIndex 格式的 tree_structure
    """
    converter = EpubTreeConverter()
    return converter.convert(epub_data, assign_node_ids)


class EpubTreeConverter:
    """EPUB 树结构转换器"""

    def __init__(self):
        self._node_counter = 0

    def convert(
        self,
        epub_data: Dict[str, Any],
        assign_node_ids: bool
    ) -> Dict[str, Any]:
        """
        转换 EPUB 数据为 PageIndex 树结构

        Args:
            epub_data: EPUB 解析数据
            assign_node_ids: 是否分配 node_id

        Returns:
            PageIndex tree_structure
        """
        metadata = epub_data.get("metadata", {})
        toc = epub_data.get("toc", [])
        chapters = epub_data.get("chapters", [])

        # 构建章节映射（file_name → content）
        chapter_map = {c["file_name"]: c for c in chapters}

        # 重置计数器
        if assign_node_ids:
            self._node_counter = 0

        # 转换 TOC 为树结构
        structure = self._toc_to_tree(toc, chapter_map, assign_node_ids)

        return {
            "title": metadata.get("title", ""),
            "structure": structure,
        }

    def _toc_to_tree(
        self,
        toc: List[Any],
        chapter_map: Dict[str, Dict[str, str]],
        assign_node_ids: bool
    ) -> List[Dict[str, Any]]:
        """
        将 EPUB TOC 转换为树结构

        Args:
            toc: EPUB TOC 列表
            chapter_map: 章节文件名到内容的映射
            assign_node_ids: 是否分配 node_id

        Returns:
            PageIndex 结构节点列表
        """
        structure = []

        for item in toc:
            node = self._parse_toc_item(item, chapter_map, assign_node_ids)
            if node:
                structure.append(node)

        return structure

    def _parse_toc_item(
        self,
        item: Any,
        chapter_map: Dict[str, Dict[str, str]],
        assign_node_ids: bool
    ) -> Dict[str, Any]:
        """
        解析单个 TOC 项

        Args:
            item: TOC 项（可能是 Link 或元组）
            chapter_map: 章节映射
            assign_node_ids: 是否分配 node_id

        Returns:
            PageIndex 节点字典
        """
        # 提取 Link 和子节点
        if isinstance(item, epub.Link):
            link = item
            children = []
        elif isinstance(item, tuple) and len(item) >= 1:
            link = item[0]
            children = item[1:] if len(item) > 1 else []
        else:
            logger.warning(f"[EPUB] 无法解析的 TOC 项: {type(item)}")
            return None

        title = link.title or "未命名章节"
        href = link.href

        # 查找章节内容
        content = ""
        start_index = 0
        end_index = 0

        if href and href in chapter_map:
            chapter = chapter_map[href]
            content = chapter.get("content", "")
            # 简化：使用章节序号
            start_index = list(chapter_map.keys()).index(href) + 1
            end_index = start_index + len(content.split()) // 1000  # 估算

        # 构建 node
        node = {
            "title": title,
            "text": content,
            "start_index": start_index,
            "end_index": end_index,
        }

        if assign_node_ids:
            self._node_counter += 1
            node["node_id"] = str(self._node_counter).zfill(4)

        # 递归处理子节点
        if children:
            node["nodes"] = []
            for child in children:
                child_node = self._parse_toc_item(child, chapter_map, assign_node_ids)
                if child_node:
                    node["nodes"].append(child_node)

        return node
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_epub_to_tree.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add pageindex/epub_to_tree.py tests/test_epub_to_tree.py
git commit -m "feat(epub): 添加 EPUB → PageIndex 树转换器"
```

---

## Task 4: 修改 page_index.py 支持 EPUB

**Files:**
- Modify: `pageindex/page_index.py`
- Modify: `tests/test_page_index.py`

**Step 1: Write the failing test**

```python
# tests/test_page_index.py

def test_detect_document_type_pdf():
    """测试 PDF 类型检测"""
    from pageindex.page_index import _detect_document_type

    assert _detect_document_type("test.pdf") == "pdf"
    assert _detect_document_type("test.PDF") == "pdf"

def test_detect_document_type_epub():
    """测试 EPUB 类型检测"""
    from pageindex.page_index import _detect_document_type

    assert _detect_document_type("test.epub") == "epub"
    assert _detect_document_type("test.EPUB") == "epub"

def test_detect_document_type_by_magic():
    """测试通过 magic bytes 检测"""
    # 创建临时测试文件
    import tempfile
    import os

    # 测试 PDF magic bytes
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(b"%PDF-1.4")
        temp_pdf = f.name

    # 测试 EPUB magic bytes
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as f:
        f.write(b"PK\x03\x04")  # ZIP signature
        temp_epub = f.name

    try:
        from pageindex.page_index import _detect_document_type

        assert _detect_document_type(temp_pdf) == "pdf"
        assert _detect_document_type(temp_epub) == "epub"
    finally:
        os.unlink(temp_pdf)
        os.unlink(temp_epub)

def test_page_index_main_epub(monkeypatch_epub):
    """测试 page_index_main 处理 EPUB"""
    # 需要 mock EPUB 解析
    pass
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_page_index.py::test_detect_document_type_epub -v`

Expected: `ImportError: cannot import name '_detect_document_type'`

**Step 3: Write minimal implementation**

```python
# pageindex/page_index.py 中添加

import sys
from pathlib import Path

# ... 现有导入 ...

def _detect_document_type(file_path: str) -> str:
    """
    检测文档类型

    Args:
        file_path: 文件路径

    Returns:
        "pdf" 或 "epub"

    Raises:
        ValueError: 不支持的文件类型
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    # 优先检查扩展名
    if ext == ".pdf":
        return "pdf"
    elif ext == ".epub":
        return "epub"

    # magic bytes 检测（防止错误扩展名）
    try:
        with open(file_path, "rb") as f:
            header = f.read(4)

            if header[:4] == b"%PDF":
                return "pdf"
            elif header[:2] == b"PK":  # EPUB 是 ZIP 格式
                return "epub"
    except Exception as e:
        logger.warning(f"[类型检测] 无法读取文件: {e}")

    raise ValueError(f"无法识别的文档类型: {file_path}")

def _process_epub(
    file_path: str,
    config: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    处理 EPUB 文件

    Args:
        file_path: EPUB 文件路径
        config: 配置字典

    Returns:
        PageIndex tree_structure
    """
    from .epub_parser import EpubParser
    from .epub_to_tree import epub_to_tree

    logger.info(f"[索引] 开始处理 EPUB: {file_path}")

    # 1. 解析 EPUB
    parser = EpubParser(file_path)
    parser.load()

    epub_data = {
        "metadata": parser.get_metadata(),
        "toc": parser.get_toc(),
        "chapters": parser.get_chapters(),
    }

    # 2. 转换为树结构
    tree = epub_to_tree(epub_data, assign_node_ids=True)

    # 3. 可选：生成摘要
    if config and config.get("use_llm"):
        tree = _generate_summaries(tree, config)

    logger.info(f"[索引] EPUB 处理完成，节点数: {_count_nodes(tree)}")
    return tree

# 修改现有的 page_index_main 函数
def page_index_main(
    file_path: str,
    config: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    主入口：生成文档索引

    支持：PDF, EPUB

    Args:
        file_path: 文档文件路径
        config: 配置字典

    Returns:
        PageIndex tree_structure
    """
    doc_type = _detect_document_type(file_path)
    logger.info(f"[索引] 检测到文档类型: {doc_type.upper()}")

    if doc_type == "pdf":
        return _process_pdf(file_path, config)
    elif doc_type == "epub":
        return _process_epub(file_path, config)
    else:
        raise ValueError(f"不支持的文档类型: {doc_type}")
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_page_index.py::test_detect_document_type_epub -v`

Expected: PASS

**Step 5: Commit**

```bash
git add pageindex/page_index.py tests/test_page_index.py
git commit -m "feat(epub): page_index_main 支持 EPUB 文档类型检测和处理"
```

---

## Task 5: 添加 EPUB 测试 fixture

**Files:**
- Create: `tests/fixtures/sample.epub` (或使用现有测试文件)
- Modify: `tests/conftest.py` (添加 pytest fixture)

**Step 1: 创建测试 fixture**

```python
# tests/conftest.py

import pytest
import tempfile
import os
from ebooklib import epub

@pytest.fixture
def sample_epub():
    """创建测试用的 EPUB 文件"""
    # 创建临时 EPUB 文件
    book = epub.EpubBook()
    book.set_identifier("test123")
    book.set_title("Test EPUB")
    book.set_language("en")
    book.add_author("Test Author")

    # 添加章节
    chapter1 = epub.EpubHtml(
        file_name="chapter1.xhtml",
        media_type="application/xhtml+xml",
        content="<html><body><h1>Chapter 1</h1><p>This is chapter 1 content.</p></body></html>"
    )
    book.add_item(chapter1)

    # 添加 TOC
    book.toc = (
        (epub.Section("Introduction"), [
            epub.Link("chapter1.xhtml", "Chapter 1"),
        ])
    )

    # 添加 spine
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # 写入临时文件
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as f:
        epub.write_epub(f.name, book, {})
        temp_path = f.name

    yield temp_path

    # 清理
    os.unlink(temp_path)
```

**Step 2: 更新测试使用 fixture**

```python
# tests/test_epub_parser.py

def test_epub_parser_with_fixture(sample_epub):
    """使用 fixture 测试完整的解析流程"""
    parser = EpubParser(sample_epub)
    parser.load()

    metadata = parser.get_metadata()
    assert metadata["title"] == "Test EPUB"

    toc = parser.get_toc()
    assert len(toc) > 0

    chapters = parser.get_chapters()
    assert len(chapters) > 0
```

**Step 3: 运行测试验证**

Run: `pytest tests/test_epub_parser.py::test_epub_parser_with_fixture -v`

Expected: PASS

**Step 4: Commit**

```bash
git add tests/conftest.py tests/test_epub_parser.py
git commit -m "test(epub): 添加 EPUB 测试 fixture"
```

---

## 总结

此实现计划包含 5 个主要任务：

| 任务 | 内容 | 预计时间 |
|------|------|----------|
| 1 | 添加 EPUB 依赖 | 10 分钟 |
| 2 | 创建 epub_parser.py | 1-2 小时 |
| 3 | 创建 epub_to_tree.py | 1-2 小时 |
| 4 | 修改 page_index.py | 1 小时 |
| 5 | 添加测试 fixture | 30 分钟 |

**总计**: 约 4-5 小时

**关键依赖**: ebooklib, beautifulsoup4, html2text

**TDD 原则**: 每个任务遵循：写测试 → 运行失败 → 实现代码 → 测试通过 → 提交

---

## 下一步

PageIndex EPUB 支持完成后，继续 DeepPDF 项目的 EPUB 适配（Task 6-10）。

实现计划将保存到：`docs/plans/2025-01-28-epub-support-implementation.md`
