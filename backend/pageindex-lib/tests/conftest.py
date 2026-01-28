"""
pytest 配置和共享 fixtures

这个模块提供了所有测试文件共享的 pytest fixtures。
"""

import pytest
import tempfile
import os
from ebooklib import epub


@pytest.fixture
def sample_epub():
    """
    创建测试用的 EPUB 文件

    这个 fixture 动态创建一个符合 EPUB 标准的测试文件，包含：
    - 标题、作者、语言等元数据
    - 至少 2 个章节
    - 目录结构（TOC）
    - 正确的 spine 和导航文件

    Returns:
        str: 临时 EPUB 文件的绝对路径

    Yields:
        str: EPUB 文件路径

    Teardown:
        自动删除临时文件
    """
    # 创建 EPUB 书籍对象
    book = epub.EpubBook()

    # 设置元数据
    book.set_identifier("sample-test-book-123")
    book.set_title("Sample Test EPUB")
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
        <p>There's also a link: <a href="https://example.com">Example Link</a></p>
        <ul>
            <li>List item 1</li>
            <li>List item 2</li>
        </ul>
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
        <p>It tests various HTML elements:</p>
        <table>
            <tr><th>Column 1</th><th>Column 2</th></tr>
            <tr><td>Data 1</td><td>Data 2</td></tr>
        </table>
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

    # 创建样式表（可选，让 EPUB 更完整）
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
    p {
        text-indent: 1.5em;
        text-align: justify;
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

    # 返回路径供测试使用
    yield temp_path

    # 清理临时文件
    try:
        os.unlink(temp_path)
    except OSError:
        # 文件可能已被删除，忽略错误
        pass


@pytest.fixture
def sample_epub_with_nested_toc():
    """
    创建带嵌套目录结构的测试 EPUB 文件

    这个 fixture 创建一个包含嵌套章节的 EPUB，用于测试复杂的 TOC 结构。

    Returns:
        str: 临时 EPUB 文件的绝对路径

    Yields:
        str: EPUB 文件路径

    Teardown:
        自动删除临时文件
    """
    # 创建 EPUB 书籍对象
    book = epub.EpubBook()

    # 设置元数据
    book.set_identifier("nested-toc-test-456")
    book.set_title("Nested TOC Test EPUB")
    book.set_language("en")
    book.add_author("Test Author")

    # 创建章节
    chapters_data = [
        ("Part 1, Chapter 1", "part1_chapter1.xhtml", "Content of Part 1, Chapter 1"),
        ("Part 1, Chapter 2", "part1_chapter2.xhtml", "Content of Part 1, Chapter 2"),
        ("Part 2, Chapter 1", "part2_chapter1.xhtml", "Content of Part 2, Chapter 1"),
        ("Part 2, Chapter 2", "part2_chapter2.xhtml", "Content of Part 2, Chapter 2"),
    ]

    epub_chapters = []
    for title, filename, content_text in chapters_data:
        chapter_content = f"""
        <?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>{title}</title></head>
        <body>
            <h1>{title}</h1>
            <p>{content_text}</p>
        </body>
        </html>
        """
        chapter = epub.EpubHtml(
            title=title,
            file_name=filename,
            media_type="application/xhtml+xml",
            content=chapter_content
        )
        book.add_item(chapter)
        epub_chapters.append(chapter)

    # 设置嵌套目录（TOC）
    # 使用 Section 创建分组
    book.toc = (
        (epub.Section("Part 1"), (
            epub.Link("part1_chapter1.xhtml", "Part 1, Chapter 1", "part1_ch1"),
            epub.Link("part1_chapter2.xhtml", "Part 1, Chapter 2", "part1_ch2"),
        )),
        (epub.Section("Part 2"), (
            epub.Link("part2_chapter1.xhtml", "Part 2, Chapter 1", "part2_ch1"),
            epub.Link("part2_chapter2.xhtml", "Part 2, Chapter 2", "part2_ch2"),
        )),
    )

    # 添加导航文件
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # 设置 spine
    book.spine = ["nav"] + epub_chapters

    # 写入临时文件
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".epub", delete=False) as f:
        epub.write_epub(f.name, book, {})
        temp_path = f.name

    yield temp_path

    # 清理
    try:
        os.unlink(temp_path)
    except OSError:
        pass
