"""
PageIndex EPUB 解析器模块

本模块提供 EPUB 文件解析和内容提取功能。

主要功能:
    - EPUB 文件加载和解析
    - 元数据提取（title, author, language）
    - 目录结构（TOC）提取
    - 章节内容提取和转换为纯文本
    - HTML 转纯文本（保留链接、图片、强调）
    - 图片提取和路径映射

使用示例:
    >>> from pageindex.epub_parser import EpubParser
    >>>
    >>> # 解析 EPUB（不含图片）
    >>> parser = EpubParser("book.epub")
    >>> parser.load()
    >>>
    >>> # 解析 EPUB（含图片提取）
    >>> parser = EpubParser("book.epub", extract_images=True,
    ...                     image_output_dir=Path("data/epub_images"),
    ...                     index_id="idx_123")
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
import re
from typing import Dict, Any, List, Optional
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import html2text

from .epub_images import EpubImageExtractor, resolve_epub_path

logger = logging.getLogger(__name__)


class EpubParser:
    """
    EPUB 解析器类

    提供 EPUB 文件解析的统一接口，支持元数据提取、目录提取和章节内容
    提取。支持可选的图片提取功能。

    属性:
        epub_path: EPUB 文件路径
        book: 加载的 EPUB 书籍对象
        extract_images: 是否提取图片
        image_output_dir: 图片输出目录
        index_id: 索引 ID
        image_map: 图片路径映射表

    使用示例:
        >>> parser = EpubParser("book.epub")
        >>> parser.load()
        >>> metadata = parser.get_metadata()
        >>> print(f"共 {len(parser.get_toc())} 章")
    """

    def __init__(
        self,
        epub_path: str,
        extract_images: bool = False,
        image_output_dir: Optional[Path] = None,
        index_id: Optional[str] = None,
    ):
        """
        初始化 EPUB 解析器

        参数:
            epub_path: EPUB 文件路径
            extract_images: 是否提取图片 (默认 False)
            image_output_dir: 图片输出目录 (提取图片时必需)
            index_id: 索引 ID (提取图片时必需)

        异常:
            ValueError: 如果 epub_path 为空，或提取图片时缺少必要参数
        """
        if not epub_path:
            raise ValueError("EPUB 文件路径不能为空")

        if extract_images:
            if not image_output_dir:
                raise ValueError("提取图片时必须指定 image_output_dir")
            if not index_id:
                raise ValueError("提取图片时必须指定 index_id")

        self.epub_path = epub_path
        self.book: Optional[epub.EpubBook] = None
        self.extract_images = extract_images
        self.image_output_dir = image_output_dir
        self.index_id = index_id
        self.image_map: Dict[str, str] = {}  # 原始路径 -> 新文件名
        self._image_extractor: Optional[EpubImageExtractor] = None

        logger.debug(f"EpubParser 初始化: {epub_path}, 提取图片: {extract_images}")

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
        如果启用了图片提取，会在处理章节前先提取所有图片。

        返回:
            章节列表，每个元素是包含以下键的字典:
                - title: 章节标题
                - file_name: 文件名
                - content: 章节内容（纯文本，可能包含图片占位符）

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
        # 步骤2: 如果启用图片提取，先提取所有图片
        # ============================================================
        if self.extract_images and self.image_output_dir and self.index_id:
            self._image_extractor = EpubImageExtractor(self.image_output_dir, self.index_id)
            self.image_map = self._image_extractor.extract_images(self.book)
            logger.info(f"图片提取完成: {len(self.image_map)} 张")

        # ============================================================
        # 步骤3: 遍历所有项目
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

                # 转换为纯文本（包含图片占位符）
                text_content = self._html_to_text(content, file_name)

                # 提取标题（优先级：<title> 标签 > <h1>/<h2> 标签 > 文件名）
                title = self._extract_title(content, file_name)

                chapters.append({
                    "title": title,
                    "file_name": file_name,
                    "content": text_content
                })

                logger.debug(f"提取章节: {title} ({file_name}), {len(text_content)} 字符")

        logger.info(f"章节提取完成: {len(chapters)} 章")

        return chapters

    def _html_to_text(self, html: str, file_name: str = "") -> str:
        """
        将 HTML 内容转换为 Markdown 格式文本

        使用 html2text 库进行转换，保留链接和强调标记以提供更丰富的语义信息。
        如果启用了图片提取，会替换图片路径为 API URL。

        参数:
            html: HTML 内容字符串
            file_name: 当前 HTML 文件路径（用于解析图片相对路径）

        返回:
            Markdown 格式文本内容

        使用示例:
            >>> parser = EpubParser("dummy.epub")
            >>> html = "<h1>Title</h1><p>Paragraph with <a href='link'>link</a></p>"
            >>> text = parser._html_to_text(html)
            >>> print(text)  # Markdown 格式，保留链接
        """
        # ============================================================
        # 步骤1: 如果启用图片提取，先替换图片路径
        # ============================================================
        if self.extract_images and self.image_map:
            html = self._replace_image_src(html, file_name)

        # ============================================================
        # 步骤2: 配置 html2text - 保留语义信息
        # ============================================================
        h = html2text.HTML2Text()
        h.ignore_links = False  # 保留链接
        h.ignore_images = not self.extract_images  # 根据配置决定是否忽略图片
        h.ignore_emphasis = False  # 保留强调
        h.body_width = 0  # 不自动换行
        h.unicode_snob = True  # 使用 Unicode
        h.skip_internal_links = True  # 跳过内部链接
        h.inline_links = True  # 内联链接
        h.protect_links = True  # 保护链接不被拆分

        # ============================================================
        # 步骤3: 转换 HTML 为 Markdown
        # ============================================================
        text = h.handle(html)

        # ============================================================
        # 步骤4: 后处理 Markdown
        # ============================================================
        text = self._post_process_markdown(text)

        return text

    def _replace_image_src(self, html: str, file_name: str) -> str:
        """
        替换 HTML 中的图片 src 为 API URL

        解析 EPUB 内的相对路径，查找映射的新文件名，
        替换为 API 访问 URL。

        参数:
            html: HTML 内容字符串
            file_name: 当前 HTML 文件路径

        返回:
            替换后的 HTML 内容

        使用示例:
            >>> html = '<img src="../images/fig1.jpg" alt="图1">'
            >>> result = parser._replace_image_src(html, "OEBPS/chapters/ch1.xhtml")
            >>> # result: '<img src="/api/epub-images/idx_xxx/abc123.jpg" alt="图1">'
        """
        soup = BeautifulSoup(html, 'html.parser')

        for img in soup.find_all('img'):
            src = img.get('src', '')
            if not src:
                continue

            # 解析相对路径 → EPUB 内绝对路径
            actual_path = resolve_epub_path(src, file_name)

            # 查找映射的新文件名
            new_name = self.image_map.get(actual_path)
            if new_name:
                # 替换为 API URL
                api_url = f"/api/epub-images/{self.index_id}/{new_name}"
                img['src'] = api_url
                logger.debug(f"[图片路径] {src} ({actual_path}) -> {api_url}")
            else:
                logger.warning(f"[图片路径] 未找到映射: {src} (解析为: {actual_path})")

        return str(soup)

    def _post_process_markdown(self, text: str) -> str:
        """
        对 Markdown 文本进行后处理优化

        处理内容包括：
        - 清理多余空行（3个以上 -> 2个）
        - 修复链接格式
        - 优化列表格式
        - 优化引用块格式

        参数:
            text: 原始 Markdown 文本

        返回:
            优化后的 Markdown 文本
        """
        # 1. 清理多余空行（3个或更多连续空行 -> 2个）
        text = re.sub(r'\n{3,}', '\n\n', text)

        # 2. 修复链接格式 - 移除链接文本前后多余空格
        # 例如：[ text ](url) -> [text](url)
        text = re.sub(r'\[\s+', '[', text)
        text = re.sub(r'\s+\]', ']', text)

        # 3. 优化列表格式 - 确保列表项前后有适当的空行
        # 无序列表项前如果没有空行，添加一个
        text = re.sub(r'([^\n])\n([-*+])', r'\1\n\n\2', text)
        # 有序列表项前如果没有空行，添加一个
        text = re.sub(r'([^\n])\n(\d+\.)', r'\1\n\n\2', text)

        # 4. 优化引用块格式 - 确保引用块前后有适当的空行
        text = re.sub(r'([^\n])\n(>)', r'\1\n\n\2', text)

        # 5. 清理行尾空白
        text = re.sub(r'[ \t]+$', '', text, flags=re.MULTILINE)

        # 6. 确保文件结尾只有一个换行符
        text = text.strip() + '\n'

        return text

    def _extract_title(self, html: str, file_name: str) -> str:
        """
        从 HTML 内容中提取标题

        按优先级尝试：
        1. HTML <title> 标签
        2. 第一个 <h1> 或 <h2> 标签（包括 title 属性）
        3. 文件名（去除扩展名）
        4. 内容摘要

        参数:
            html: HTML 内容字符串
            file_name: 文件名（作为后备）

        返回:
            提取的标题字符串
        """
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # 1. 尝试从 <title> 标签提取
        title_tag = soup.find("title")
        if title_tag and title_tag.string and title_tag.string.strip():
            return title_tag.string.strip()

        # 2. 尝试从第一个 <h1> 标签提取
        h1_tag = soup.find("h1")
        if h1_tag:
            # 先检查 title 属性（有些隐藏的 h1 会有 title）
            if h1_tag.get("title"):
                return h1_tag.get("title").strip()
            # 再检查文本内容
            if h1_tag.get_text(strip=True):
                return h1_tag.get_text(strip=True)

        # 3. 尝试从第一个 <h2> 标签提取
        h2_tag = soup.find("h2")
        if h2_tag:
            if h2_tag.get("title"):
                return h2_tag.get("title").strip()
            if h2_tag.get_text(strip=True):
                return h2_tag.get_text(strip=True)

        # 4. 尝试从第一个 <h3> 标签提取
        h3_tag = soup.find("h3")
        if h3_tag:
            if h3_tag.get("title"):
                return h3_tag.get("title").strip()
            if h3_tag.get_text(strip=True):
                return h3_tag.get_text(strip=True)

        # 5. 使用文件名作为后备（去除扩展名）
        title = file_name.replace(".xhtml", "").replace(".html", "")

        # 尝试美化文件名（如 "01_04" -> "章节 01_04"）
        if title.replace("_", "").replace("-", "").replace("/", "").isalnum():
            # 这是一个不太有意义的文件名，尝试从内容中提取前几个字作为摘要
            text_content = self._html_to_text(html, file_name)
            if text_content:
                # 取前50个字符作为摘要标题
                preview = text_content[:50].strip()
                if len(preview) > 10:
                    return f"{preview}..."

        return title


# ============================================================
# 便捷函数 (保持向后兼容)
# ============================================================

def parse_epub(
    epub_path: str,
    extract_images: bool = False,
    image_output_dir: Optional[str] = None,
    index_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    解析 EPUB 文件并返回所有信息

    这是一个便捷函数，用于快速解析 EPUB 文件。

    参数:
        epub_path: EPUB 文件路径
        extract_images: 是否提取图片 (默认 False)
        image_output_dir: 图片输出目录 (提取图片时必需)
        index_id: 索引 ID (提取图片时必需)

    返回:
        包含以下键的字典:
            - metadata: 元数据字典
            - toc: 目录列表
            - chapters: 章节列表
            - image_map: 图片映射表 (仅当 extract_images=True)

    异常:
        Exception: 如果解析失败

    使用示例:
        >>> from pageindex.epub_parser import parse_epub
        >>> result = parse_epub("book.epub")
        >>> print(f"书名: {result['metadata']['title']}")
        >>> print(f"章节数: {len(result['chapters'])}")
    """
    parser = EpubParser(
        epub_path,
        extract_images=extract_images,
        image_output_dir=Path(image_output_dir) if image_output_dir else None,
        index_id=index_id,
    )
    parser.load()

    result = {
        "metadata": parser.get_metadata(),
        "toc": parser.get_toc(),
        "chapters": parser.get_chapters(),
    }

    # 添加图片映射（如果启用了图片提取）
    if extract_images and parser.image_map:
        result["image_map"] = parser.image_map

    return result
