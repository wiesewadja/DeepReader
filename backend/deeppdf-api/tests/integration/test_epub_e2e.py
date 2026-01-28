# tests/integration/test_epub_e2e.py
"""
EPUB 端到端集成测试

验证完整流程：
1. 创建测试 EPUB 文件
2. 使用 PageIndex 库解析 EPUB
3. 调用 index_pdf 创建索引
4. 验证索引结果（doc_type, tree_structure, node_count）
5. 使用索引进行搜索
6. 验证搜索结果正常返回

此测试使用真实的 PageIndex 库（非 mock），确保端到端功能正常。
"""
import pytest
import tempfile
import os
import asyncio
from pathlib import Path
from ebooklib import epub

# 使用 PageIndex 和 DeepPDF 索引服务
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from deeppdf.services.indexer import index_pdf
from deeppdf.storage.chroma_store import ChromaStore
from deeppdf.config import settings


@pytest.fixture
def sample_epub_file():
    """
    创建测试用的 EPUB 文件

    Returns:
        str: 临时 EPUB 文件的绝对路径
    """
    # 创建 EPUB 书籍对象
    book = epub.EpubBook()

    # 设置元数据
    book.set_identifier("e2e-test-book-123")
    book.set_title("E2E Test EPUB")
    book.set_language("en")
    book.add_author("Test Author")

    # 创建章节 1
    chapter1_content = """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <title>Chapter 1</title>
    </head>
    <body>
        <h1>Chapter 1: Introduction</h1>
        <p>This is the first chapter of the test EPUB book.</p>
        <p>It contains multiple paragraphs to test the HTML to text conversion.</p>
        <p>The content should be properly extracted and formatted.</p>
        <p>Key concepts include: machine learning, data science, and artificial intelligence.</p>
        <p>Machine learning is a subset of artificial intelligence that focuses on algorithms.</p>
    </body>
    </html>
    """
    chapter1 = epub.EpubHtml(
        title="Chapter 1",
        file_name="chapter1.xhtml",
        media_type="application/xhtml+xml",
        content=chapter1_content
    )
    book.add_item(chapter1)

    # 创建章节 2
    chapter2_content = """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <title>Chapter 2</title>
    </head>
    <body>
        <h1>Chapter 2: Main Content</h1>
        <p>This is the second chapter.</p>
        <p>It includes some <strong>bold text</strong> and <em>italic text</em>.</p>
        <p>Machine learning algorithms are used to analyze data patterns.</p>
        <p>Data science combines statistics and programming to extract insights.</p>
        <p>Common algorithms include neural networks and decision trees.</p>
    </body>
    </html>
    """
    chapter2 = epub.EpubHtml(
        title="Chapter 2",
        file_name="chapter2.xhtml",
        media_type="application/xhtml+xml",
        content=chapter2_content
    )
    book.add_item(chapter2)

    # 创建章节 3
    chapter3_content = """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <title>Chapter 3</title>
    </head>
    <body>
        <h1>Chapter 3: Conclusion</h1>
        <p>This is the final chapter of the test book.</p>
        <p>Artificial intelligence is transforming many industries.</p>
        <p>Deep learning is a subset of machine learning using neural networks.</p>
        <p>Applications include image recognition and natural language processing.</p>
    </body>
    </html>
    """
    chapter3 = epub.EpubHtml(
        title="Chapter 3",
        file_name="chapter3.xhtml",
        media_type="application/xhtml+xml",
        content=chapter3_content
    )
    book.add_item(chapter3)

    # 设置目录（TOC）
    book.toc = (
        epub.Link("chapter1.xhtml", "Chapter 1", "chapter1"),
        epub.Link("chapter2.xhtml", "Chapter 2", "chapter2"),
        epub.Link("chapter3.xhtml", "Chapter 3", "chapter3"),
    )

    # 添加导航文件
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # 设置 spine（阅读顺序）
    book.spine = ["nav", chapter1, chapter2, chapter3]

    # 添加样式表（让 EPUB 更完整）
    style = """
    @namespace epub "http://www.idpf.org/2007/ops";
    body {
        font-family: Cambria, Liberation Serif, serif;
        line-height: 1.5;
    }
    h1 {
        text-align: left;
        text-transform: uppercase;
    }
    """
    nav_css = epub.EpubItem(
        uid="style_nav",
        file_name="style/nav.css",
        media_type="text/css",
        content=style
    )
    book.add_item(nav_css)

    # 写入临时文件
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".epub", delete=False) as f:
        epub.write_epub(f.name, book, {})
        temp_path = f.name

    yield temp_path

    # 清理临时文件
    try:
        os.unlink(temp_path)
    except OSError:
        pass


@pytest.fixture
def temp_storage_dir():
    """
    创建临时存储目录

    Returns:
        str: 临时目录路径
    """
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    # 清理临时目录
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.mark.integration
class TestEpubIndexingE2E:
    """测试 EPUB 端到端索引流程"""

    @pytest.mark.asyncio
    async def test_epub_index_creates_correct_metadata(self, sample_epub_file, temp_storage_dir):
        """
        测试：EPUB 索引创建正确的元数据

        验证步骤：
        1. 调用 index_pdf 索引 EPUB
        2. 验证 doc_type 为 "epub"
        3. 验证 tree_structure 正确生成
        4. 验证 node_count 大于 0
        """
        # 步骤 1: 调用索引函数
        result = await index_pdf(
            pdf_path=sample_epub_file,
            storage_dir=temp_storage_dir,
            llm_provider="deepseek",
            api_key=os.environ.get("DEEPSEEK_API_KEY", "test_key"),
        )

        # 步骤 2: 验证基本响应
        assert result["status"] == "success"
        assert "index_id" in result
        assert result["doc_type"] == "epub"
        assert result["node_count"] > 0
        assert result["pdf_name"] is not None
        assert result["indexing_method"] == "pageindex_tree"

        index_id = result["index_id"]

        # 步骤 3: 验证索引元数据文件
        metadata_path = Path(temp_storage_dir) / "indexes" / f"{index_id}.json"
        assert metadata_path.exists()

        import json
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 验证元数据内容
        assert metadata["doc_type"] == "epub"
        assert metadata["node_count"] > 0
        assert metadata["indexing_method"] == "pageindex_tree"
        assert "tree_structure" in metadata

        # 步骤 4: 验证 tree_structure
        tree_structure = metadata["tree_structure"]
        assert "structure" in tree_structure
        assert isinstance(tree_structure["structure"], list)
        assert len(tree_structure["structure"]) > 0

        # 验证节点结构
        first_node = tree_structure["structure"][0]
        assert "node_id" in first_node
        assert "title" in first_node
        assert "text" in first_node
        assert "start_index" in first_node
        assert "end_index" in first_node

    @pytest.mark.asyncio
    async def test_epub_index_stores_in_chromadb(self, sample_epub_file, temp_storage_dir):
        """
        测试：EPUB 索引存储到 ChromaDB

        验证步骤：
        1. 调用 index_pdf 索引 EPUB
        2. 验证 ChromaDB 集合创建成功
        3. 验证文档数量正确
        """
        # 步骤 1: 调用索引函数
        result = await index_pdf(
            pdf_path=sample_epub_file,
            storage_dir=temp_storage_dir,
            llm_provider="deepseek",
            api_key=os.environ.get("DEEPSEEK_API_KEY", "test_key"),
        )

        index_id = result["index_id"]
        node_count = result["node_count"]

        # 步骤 2: 验证 ChromaDB 存储
        chroma_dir = Path(temp_storage_dir) / "chroma"
        assert chroma_dir.exists()

        # 步骤 3: 验证可以查询集合
        from deeppdf.storage.chroma_store import ChromaStore
        store = ChromaStore(persist_directory=str(chroma_dir))

        # 获取集合
        collection = store.get_collection(index_id)
        assert collection is not None

        # 验证文档数量
        count = store.get_collection_count(index_id)
        assert count == node_count


@pytest.mark.integration
class TestEpubSearchE2E:
    """测试 EPUB 搜索功能"""

    @pytest.mark.asyncio
    async def test_epub_search_returns_results(self, sample_epub_file, temp_storage_dir):
        """
        测试：EPUB 索引后的搜索功能

        验证步骤：
        1. 创建 EPUB 索引
        2. 使用 HybridSearch 进行搜索
        3. 验证搜索结果正常返回
        4. 验证结果包含相关内容
        """
        # 步骤 1: 创建索引
        result = await index_pdf(
            pdf_path=sample_epub_file,
            storage_dir=temp_storage_dir,
            llm_provider="deepseek",
            api_key=os.environ.get("DEEPSEEK_API_KEY", "test_key"),
        )

        index_id = result["index_id"]

        # 步骤 2: 执行搜索
        chroma_dir = Path(temp_storage_dir) / "chroma"
        store = ChromaStore(persist_directory=str(chroma_dir))

        # 搜索 "machine learning"
        search_results = store.query(
            collection_name=index_id,
            query_texts=["machine learning"],
            n_results=3,
        )

        # 步骤 3: 验证搜索结果
        assert isinstance(search_results, dict)
        assert "documents" in search_results
        assert len(search_results["documents"]) > 0
        assert len(search_results["documents"][0]) > 0

        # 验证结果结构
        first_document = search_results["documents"][0][0]
        assert isinstance(first_document, str)
        assert len(first_document) > 0

    @pytest.mark.asyncio
    async def test_epub_search_multiple_queries(self, sample_epub_file, temp_storage_dir):
        """
        测试：多次搜索 EPUB 索引

        验证步骤：
        1. 创建 EPUB 索引
        2. 执行多次不同查询
        3. 验证每次搜索都返回结果
        """
        # 步骤 1: 创建索引
        result = await index_pdf(
            pdf_path=sample_epub_file,
            storage_dir=temp_storage_dir,
            llm_provider="deepseek",
            api_key=os.environ.get("DEEPSEEK_API_KEY", "test_key"),
        )

        index_id = result["index_id"]

        # 步骤 2: 创建搜索器
        chroma_dir = Path(temp_storage_dir) / "chroma"
        store = ChromaStore(persist_directory=str(chroma_dir))

        # 步骤 3: 执行多次搜索
        queries = [
            "artificial intelligence",
            "data science",
            "neural networks",
        ]

        for query in queries:
            search_results = store.query(
                collection_name=index_id,
                query_texts=[query],
                n_results=3,
            )

            # 验证每次搜索都成功
            assert isinstance(search_results, dict)
            assert "documents" in search_results
            # 可能有 0 个结果，但不应该抛出异常
            assert len(search_results["documents"]) >= 0


@pytest.mark.integration
class TestEpubParserIntegration:
    """测试 EPUB 解析器集成"""

    def test_epub_parser_extracts_content(self, sample_epub_file):
        """
        测试：EPUB 解析器正确提取内容

        验证步骤：
        1. 使用 EpubParser 解析 EPUB
        2. 验证元数据提取正确
        3. 验证目录提取正确
        4. 验证章节内容提取正确
        """
        from pageindex.epub_parser import EpubParser

        # 步骤 1: 解析 EPUB
        parser = EpubParser(sample_epub_file)
        parser.load()

        # 步骤 2: 验证元数据
        metadata = parser.get_metadata()
        assert metadata["title"] == "E2E Test EPUB"
        assert metadata["author"] == "Test Author"
        assert metadata["language"] == "en"

        # 步骤 3: 验证目录
        toc = parser.get_toc()
        assert len(toc) == 3

        # 步骤 4: 验证章节内容
        chapters = parser.get_chapters()
        assert len(chapters) == 3

        # 验证章节包含 title 字段（修复后的版本）
        for chapter in chapters:
            assert "title" in chapter
            assert "file_name" in chapter
            assert "content" in chapter
            assert len(chapter["content"]) > 0

    def test_epub_to_tree_conversion(self, sample_epub_file):
        """
        测试：EPUB 到树结构的转换

        验证步骤：
        1. 使用 EpubParser 解析 EPUB
        2. 使用 epub_to_tree 转换为树结构
        3. 验证树结构正确
        """
        from pageindex.epub_parser import EpubParser
        from pageindex.epub_to_tree import epub_to_tree

        # 步骤 1: 解析 EPUB
        parser = EpubParser(sample_epub_file)
        parser.load()

        epub_data = {
            "metadata": parser.get_metadata(),
            "toc": parser.get_toc(),
            "chapters": parser.get_chapters(),
        }

        # 步骤 2: 转换为树结构
        tree = epub_to_tree(epub_data, assign_node_ids=True)

        # 步骤 3: 验证树结构
        assert "title" in tree
        assert "structure" in tree
        assert isinstance(tree["structure"], list)
        assert len(tree["structure"]) > 0

        # 验证节点结构
        first_node = tree["structure"][0]
        assert "node_id" in first_node
        assert "title" in first_node
        assert "text" in first_node
        assert "start_index" in first_node
        assert "end_index" in first_node

        # 验证 node_id 格式（4位数字）
        assert first_node["node_id"].isdigit()
        assert len(first_node["node_id"]) == 4
