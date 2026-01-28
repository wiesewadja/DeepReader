"""
PageIndex EPUB 解析器模块

本模块提供 EPUB 文件解析和内容提取功能。

主要功能:
    - EPUB 文件加载和解析
    - 元数据提取（title, author, language）
    - 目录结构（TOC）提取
    - 章节内容提取和转换为纯文本
    - HTML 转纯文本（忽略链接、图片、强调）

使用示例:
    >>> from pageindex.epub_parser import EpubParser
    >>>
    >>> # 解析 EPUB
    >>> parser = EpubParser("book.epub")
    >>> parser.load()
    >>>
    >>> # 获取元数据
    >>> metadata = parser.get_metadata()
    >>> print(f"书名: {metadata['title']}")
    >>> print(f"作者: {metadata['author']}")
    >>>
    >>> # 获取目录
    >>> toc = parser.get_toc()
    >>>
    >>> # 获取章节内容
    >>> chapters = parser.get_chapters()
    >>> for chapter in chapters:
    ...     print(f"{chapter['title']}: {chapter['content'][:50]}...")

依赖关系:
    - ebooklib: EPUB 文件解析
    - beautifulsoup4: HTML 解析
    - html2text: HTML 转纯文本

作者: DeepPDF Team
创建时间: 2026-01-28
"""

import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import html2text

logger = logging.getLogger(__name__)


class EpubParser:
    """
    EPUB 解析器类

    提供 EPUB 文件解析的统一接口，支持元数据提取、目录提取和章节内容
    提取。

    属性:
        epub_path: EPUB 文件路径
        book: 加载的 EPUB 书籍对象

    使用示例:
        >>> parser = EpubParser("book.epub")
        >>> parser.load()
        >>> metadata = parser.get_metadata()
        >>> print(f"共 {len(parser.get_toc())} 章")
    """

    def __init__(self, epub_path: str):
        """
        初始化 EPUB 解析器

        参数:
            epub_path: EPUB 文件路径

        异常:
            ValueError: 如果 epub_path 为空
        """
        if not epub_path:
            raise ValueError("EPUB 文件路径不能为空")

        self.epub_path = epub_path
        self.book: Optional[epub.EpubBook] = None

        logger.debug(f"EpubParser 初始化: {epub_path}")

    def load(self) -> None:
        """
        加载 EPUB 文件

        读取 EPUB 文件并初始化内部书籍对象。

        异常:
            Exception: 如果文件读取失败或格式无效
            ValidationError: 如果文件不存在

        使用示例:
            >>> parser = EpubParser("book.epub")
            >>> parser.load()
        """
        # ============================================================
        # 步骤1: 检查文件是否存在
        # ============================================================
        epub_file = Path(self.epub_path)
        if not epub_file.exists():
            from ..core.exceptions import ValidationError

            raise ValidationError(
                f"EPUB 文件不存在: {self.epub_path}",
                parameter="epub_path",
                value=self.epub_path,
            )

        logger.debug(f"开始加载 EPUB 文件: {self.epub_path}")

        # ============================================================
        # 步骤2: 读取 EPUB 文件
        # ============================================================
        try:
            self.book = epub.read_epub(str(self.epub_path))
            logger.info(f"EPUB 文件加载成功: {self.book.title}")
        except Exception as e:
            logger.error(f"EPUB 文件加载失败: {e}")
            raise

    def get_metadata(self) -> Dict[str, Any]:
        """
        获取 EPUB 元数据

        提取书籍的基本元数据，包括标题、作者和语言。

        返回:
            包含元数据的字典，包含以下键:
                - title: 书籍标题
                - author: 作者
                - language: 语言代码

        异常:
            ValueError: 如果 EPUB 文件未加载

        使用示例:
            >>> parser = EpubParser("book.epub")
            >>> parser.load()
            >>> metadata = parser.get_metadata()
            >>> print(f"《{metadata['title']}》 - {metadata['author']}")
        """
        # ============================================================
        # 步骤1: 检查是否已加载
        # ============================================================
        if self.book is None:
            raise ValueError("EPUB 文件未加载，请先调用 load() 方法")

        logger.debug("提取元数据")

        # ============================================================
        # 步骤2: 提取元数据
        # ============================================================
        metadata: Dict[str, Any] = {}

        # 标题
        metadata["title"] = self.book.get_metadata("DC", "title")
        if metadata["title"]:
            metadata["title"] = (
                metadata["title"][0][0]
                if isinstance(metadata["title"][0], tuple)
                else str(metadata["title"][0])
            )
        else:
            metadata["title"] = self.book.title or "未知"

        # 作者
        author_list = self.book.get_metadata("DC", "creator")
        if author_list:
            metadata["author"] = (
                author_list[0][0]
                if isinstance(author_list[0], tuple)
                else str(author_list[0])
            )
        else:
            metadata["author"] = "未知"

        # 语言
        language_list = self.book.get_metadata("DC", "language")
        if language_list:
            metadata["language"] = (
                language_list[0][0]
                if isinstance(language_list[0], tuple)
                else str(language_list[0])
            )
        else:
            metadata["language"] = "未知"

        logger.debug(
            f"元数据提取完成: title={metadata['title']}, "
            f"author={metadata['author']}, language={metadata['language']}"
        )

        return metadata

    def get_toc(self) -> List[Any]:
        """
        获取 EPUB 目录结构

        提取书籍的目录（Table of Contents）。

        返回:
            目录列表，每个元素是目录项（格式取决于 EPUB 文件结构）

        异常:
            ValueError: 如果 EPUB 文件未加载

        使用示例:
            >>> parser = EpubParser("book.epub")
            >>> parser.load()
            >>> toc = parser.get_toc()
            >>> for item in toc:
            ...     print(item)
        """
        # ============================================================
        # 步骤1: 检查是否已加载
        # ============================================================
        if self.book is None:
            raise ValueError("EPUB 文件未加载，请先调用 load() 方法")

        logger.debug("提取目录结构")

        # ============================================================
        # 步骤2: 提取目录
        # ============================================================
        # toc 是一个属性，不是方法
        toc = self.book.toc

        logger.debug(f"目录提取完成: {len(toc)} 项")

        return list(toc)

    def get_chapters(self) -> List[Dict[str, str]]:
        """
        获取 EPUB 章节内容

        提取所有章节的内容，并将 HTML 转换为纯文本。

        返回:
            章节列表，每个元素是包含以下键的字典:
                - title: 章节标题
                - content: 章节内容（纯文本）

        异常:
            ValueError: 如果 EPUB 文件未加载

        使用示例:
            >>> parser = EpubParser("book.epub")
            >>> parser.load()
            >>> chapters = parser.get_chapters()
            >>> for chapter in chapters:
            ...     print(f"\\n=== {chapter['title']} ===")
            ...     print(chapter['content'][:200])
        """
        # ============================================================
        # 步骤1: 检查是否已加载
        # ============================================================
        if self.book is None:
            raise ValueError("EPUB 文件未加载，请先调用 load() 方法")

        logger.debug("提取章节内容")

        # ============================================================
        # 步骤2: 遍历所有项目
        # ============================================================
        chapters: List[Dict[str, str]] = []

        for item in self.book.get_items():
            # 只处理文档类型（HTML/XHTML）
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                # 获取文件名
                file_name = item.get_name()

                # 跳过导航文件
                if file_name.endswith("nav.xhtml") or file_name.endswith("nav.html"):
                    logger.debug(f"跳过导航文件: {file_name}")
                    continue

                # 读取内容
                content = item.get_content().decode("utf-8")

                # 转换为纯文本
                text_content = self._html_to_text(content)

                # 提取标题（从文件名或 HTML <title> 标签）
                # 移除 .xhtml 或 .html 扩展名
                title = file_name.replace(".xhtml", "").replace(".html", "")
                # 尝试从 HTML 中提取 <title> 标签
                if "<title>" in content.lower():
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(content, "html.parser")
                    html_title = soup.find("title")
                    if html_title and html_title.string:
                        title = html_title.string.strip()

                chapters.append({
                    "title": title,
                    "file_name": file_name,
                    "content": text_content
                })

                logger.debug(f"提取章节: {title} ({file_name}), {len(text_content)} 字符")

        logger.info(f"章节提取完成: {len(chapters)} 章")

        return chapters

    def _html_to_text(self, html: str) -> str:
        """
        将 HTML 内容转换为纯文本

        使用 html2text 库进行转换，自动忽略链接、图片和强调标记。

        参数:
            html: HTML 内容字符串

        返回:
            纯文本内容

        使用示例:
            >>> parser = EpubParser("dummy.epub")
            >>> html = "<h1>Title</h1><p>Paragraph with <a href='link'>link</a></p>"
            >>> text = parser._html_to_text(html)
            >>> print(text)  # 纯文本，无 HTML 标签
        """
        # ============================================================
        # 步骤1: 配置 html2text
        # ============================================================
        h = html2text.HTML2Text()
        h.ignore_links = True  # 忽略链接
        h.ignore_images = True  # 忽略图片
        h.ignore_emphasis = True  # 忽略强调标记
        h.body_width = 0  # 不换行

        # ============================================================
        # 步骤2: 转换 HTML 为纯文本
        # ============================================================
        text = h.handle(html)

        return text


# ============================================================
# 便捷函数 (保持向后兼容)
# ============================================================

def parse_epub(
    epub_path: str,
) -> Dict[str, Any]:
    """
    解析 EPUB 文件并返回所有信息

    这是一个便捷函数，用于快速解析 EPUB 文件。

    参数:
        epub_path: EPUB 文件路径

    返回:
        包含以下键的字典:
            - metadata: 元数据字典
            - toc: 目录列表
            - chapters: 章节列表

    异常:
        Exception: 如果解析失败

    使用示例:
        >>> from pageindex.epub_parser import parse_epub
        >>> result = parse_epub("book.epub")
        >>> print(f"书名: {result['metadata']['title']}")
        >>> print(f"章节数: {len(result['chapters'])}")
    """
    parser = EpubParser(epub_path)
    parser.load()

    return {
        "metadata": parser.get_metadata(),
        "toc": parser.get_toc(),
        "chapters": parser.get_chapters(),
    }
