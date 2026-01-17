"""
PageIndex PDF 解析器模块

本模块提供 PDF 文件解析和文本提取功能。

主要功能:
    - PDF 文本提取 (支持 pypdf 和 PyMuPDF)
    - 页面文本获取 (支持带标记和不带标记)
    - 页面 Token 计数
    - 自动回退机制 (pypdf 失败时自动切换到 PyMuPDF)

支持的后端:
    - pypdf (默认): 纯 Python，无外部依赖
    - PyMuPDF (fitz): 更快的 C 扩展，需要单独安装

物理索引标记格式:
    <physical_index_N>页面内容<physical_index_N>

使用示例:
    >>> from pageindex.pdf.parser import PDFParser
    >>>
    >>> # 解析 PDF
    >>> parser = PDFParser()
    >>> pages = parser.parse("document.pdf")
    >>>
    >>> # 获取特定页面的文本 (带标记)
    >>> text = parser.get_text_with_tags("document.pdf", 1, 5)
    >>>
    >>> # 从已解析的页面获取文本
    >>> for page_text, token_count in pages:
    ...     print(f"页面文本 ({token_count} tokens): {page_text[:50]}...")

依赖关系:
    - pypdf: 默认 PDF 解析库
    - pymupdf (fitz): 可选的更快的解析库
    - tiktoken: Token 计数

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
import os
from io import BytesIO
from typing import List, Tuple, Union, Optional

import pypdf
import pymupdf

from .tokens import count_tokens

logger = logging.getLogger(__name__)


class PDFParser:
    """
    PDF 解析器类

    提供 PDF 文件解析的统一接口，支持多种解析后端和自动回退机制。

    属性:
        default_parser: 默认解析器 ("pypdf" 或 "PyMuPDF")
        fallback_enabled: 是否启用自动回退

    解析器对比:
        pypdf:
            - 优点: 纯 Python，无外部依赖
            - 缺点: 解析速度较慢，某些 PDF 格式支持不佳

        PyMuPDF:
            - 优点: 解析速度快，格式支持好
            - 缺点: 需要安装 C 扩展

    使用示例:
        >>> parser = PDFParser(default_parser="pypdf")
        >>> pages = parser.parse("document.pdf")
        >>> print(f"共 {len(pages)} 页")
    """

    def __init__(
        self,
        default_parser: str = "pypdf",
        fallback_enabled: bool = True,
        model: Optional[str] = None,
    ):
        """
        初始化 PDF 解析器

        参数:
            default_parser: 默认解析器，可选 "pypdf" 或 "PyMuPDF"
            fallback_enabled: 是否启用自动回退机制
            model: Token 计数使用的模型名称 (可选)
                    - 如果为 None，从配置文件读取
                    - 如果配置文件也没有，使用默认值 "gpt-4o"

        异常:
            ValueError: 如果解析器名称不支持
        """
        if default_parser not in ("pypdf", "PyPDF2", "PyMuPDF"):
            raise ValueError(
                f"不支持的解析器: {default_parser}，"
                f"请使用 'pypdf' 或 'PyMuPDF'"
            )

        # PyPDF2 是 pypdf 的旧名称，统一为 pypdf
        if default_parser == "PyPDF2":
            default_parser = "pypdf"

        self.default_parser = default_parser
        self.fallback_enabled = fallback_enabled

        # ============================================================
        # 确定 Token 计数模型
        # ============================================================
        # 优先级: 参数 > 配置文件 > 默认值
        if model is None:
            # 尝试从配置文件读取
            try:
                from ..core.config import load_config
                config = load_config()
                model = getattr(config, "token_model", "gpt-4o")
            except Exception:
                # 配置加载失败，使用默认值
                model = "gpt-4o"

        self.model = model

        logger.debug(
            f"PDFParser 初始化: parser={default_parser}, "
            f"fallback={fallback_enabled}, token_model={model}"
        )

    def parse(
        self,
        pdf_path: Union[str, BytesIO],
        parser: Optional[str] = None,
    ) -> List[Tuple[str, int]]:
        """
        解析 PDF 文件，返回页面文本和 Token 计数

        这是 PDF 解析的主要入口点。如果指定 parser 参数，使用指定的解析器；
        否则使用默认解析器。如果启用回退机制且解析失败，自动尝试另一个解析器。

        参数:
            pdf_path: PDF 文件路径或 BytesIO 对象
            parser: 指定解析器 ("pypdf" 或 "PyMuPDF")，None 表示使用默认值

        返回:
            列表，每个元素是 (页面文本, Token 数量) 的元组

        异常:
            PDFError: 如果所有解析器都失败
            ValidationError: 如果文件路径无效

        使用示例:
            >>> parser = PDFParser()
            >>> pages = parser.parse("document.pdf")
            >>> for page_text, token_count in pages:
            ...     print(f"页面 {i+1}: {token_count} tokens")
        """
        # ============================================================
        # 步骤1: 确定要使用的解析器
        # ============================================================
        if parser is None:
            parser = self.default_parser

        logger.debug(f"开始解析 PDF: parser={parser}, file={pdf_path}")

        # ============================================================
        # 步骤2: 使用指定解析器进行解析
        # ============================================================
        try:
            if parser in ("pypdf", "PyPDF2"):
                return self._parse_with_pypdf(pdf_path)
            elif parser == "PyMuPDF":
                return self._parse_with_pymupdf(pdf_path)
            else:
                raise ValueError(f"不支持的解析器: {parser}")

        except Exception as e:
            logger.warning(f"{parser} 解析失败: {e}")

            # ============================================================
            # 步骤3: 尝试回退到另一个解析器
            # ============================================================
            if self.fallback_enabled:
                fallback_parser = "PyMuPDF" if parser == "pypdf" else "pypdf"
                logger.info(f"尝试回退到 {fallback_parser}...")

                try:
                    if fallback_parser == "PyMuPDF":
                        return self._parse_with_pymupdf(pdf_path)
                    else:
                        return self._parse_with_pypdf(pdf_path)
                except Exception as fallback_error:
                    logger.error(f"回退解析器也失败: {fallback_error}")

            # 所有解析器都失败
            from ..core.exceptions import PDFError

            raise PDFError(
                f"PDF 解析失败: {parser}",
                pdf_path=str(pdf_path) if isinstance(pdf_path, str) else None,
                original_error=e,
            )

    def _parse_with_pypdf(
        self, pdf_path: Union[str, BytesIO]
    ) -> List[Tuple[str, int]]:
        """
        使用 pypdf 解析 PDF 文件

        pypdf 是纯 Python 实现的 PDF 解析库，无需额外依赖。
        但解析速度较慢，某些复杂 PDF 格式支持不佳。

        参数:
            pdf_path: PDF 文件路径或 BytesIO 对象

        返回:
            列表，每个元素是 (页面文本, Token 数量) 的元组

        异常:
            Exception: pypdf 解析失败时抛出
        """
        logger.debug("使用 pypdf 解析器")

        # ============================================================
        # 步骤1: 打开 PDF 文件
        # ============================================================
        if isinstance(pdf_path, BytesIO):
            # BytesIO 对象需要重置位置
            pdf_path.seek(0)
            pdf_reader = pypdf.PdfReader(pdf_path)
        elif isinstance(pdf_path, str):
            if not os.path.isfile(pdf_path):
                from ..core.exceptions import ValidationError

                raise ValidationError(
                    f"PDF 文件不存在: {pdf_path}",
                    parameter="pdf_path",
                    value=pdf_path,
                )
            pdf_reader = pypdf.PdfReader(pdf_path)
        else:
            from ..core.exceptions import ValidationError

            raise ValidationError(
                f"不支持的 pdf_path 类型: {type(pdf_path).__name__}",
                parameter="pdf_path",
                value=pdf_path,
            )

        # ============================================================
        # 步骤2: 逐页提取文本并计算 Token 数
        # ============================================================
        page_list = []
        total_pages = len(pdf_reader.pages)

        for page_num in range(total_pages):
            page = pdf_reader.pages[page_num]
            page_text = page.extract_text()
            token_length = count_tokens(page_text, model=self.model)
            page_list.append((page_text, token_length))

            logger.debug(
                f"pypdf 解析: 页面 {page_num + 1}/{total_pages}, "
                f"tokens={token_length}"
            )

        logger.info(f"pypdf 解析完成: {total_pages} 页")
        return page_list

    def _parse_with_pymupdf(
        self, pdf_path: Union[str, BytesIO]
    ) -> List[Tuple[str, int]]:
        """
        使用 PyMuPDF (fitz) 解析 PDF 文件

        PyMuPDF 是基于 MuPDF C 库的 Python 绑定，解析速度快，
        对各种 PDF 格式支持更好。但需要安装额外的 C 扩展。

        参数:
            pdf_path: PDF 文件路径或 BytesIO 对象

        返回:
            列表，每个元素是 (页面文本, Token 数量) 的元组

        异常:
            Exception: PyMuPDF 解析失败时抛出
        """
        logger.debug("使用 PyMuPDF 解析器")

        # ============================================================
        # 步骤1: 打开 PDF 文档
        # ============================================================
        if isinstance(pdf_path, BytesIO):
            # BytesIO 对象需要重置位置
            pdf_path.seek(0)
            doc = pymupdf.open(stream=pdf_path.read(), filetype="pdf")
        elif isinstance(pdf_path, str):
            if not os.path.isfile(pdf_path):
                from ..core.exceptions import ValidationError

                raise ValidationError(
                    f"PDF 文件不存在: {pdf_path}",
                    parameter="pdf_path",
                    value=pdf_path,
                )
            doc = pymupdf.open(pdf_path)
        else:
            from ..core.exceptions import ValidationError

            raise ValidationError(
                f"不支持的 pdf_path 类型: {type(pdf_path).__name__}",
                parameter="pdf_path",
                value=pdf_path,
            )

        # ============================================================
        # 步骤2: 逐页提取文本并计算 Token 数
        # ============================================================
        page_list = []
        total_pages = len(doc)

        for page_num, page in enumerate(doc):
            page_text = page.get_text()
            token_length = count_tokens(page_text, model=self.model)
            page_list.append((page_text, token_length))

            logger.debug(
                f"PyMuPDF 解析: 页面 {page_num + 1}/{total_pages}, "
                f"tokens={token_length}"
            )

        # 关闭文档
        doc.close()

        logger.info(f"PyMuPDF 解析完成: {total_pages} 页")
        return page_list

    def get_text_with_tags(
        self,
        pdf_path: Union[str, BytesIO],
        start_page: int,
        end_page: int,
        parser: Optional[str] = None,
    ) -> str:
        """
        获取指定页码范围的文本，添加物理索引标记

        物理索引标记格式:
            <start_index_N>页面内容<end_index_N>

        其中 N 是从 1 开始的物理页码。

        参数:
            pdf_path: PDF 文件路径或 BytesIO 对象
            start_page: 起始页码 (从 1 开始)
            end_page: 结束页码 (包含)
            parser: 指定解析器，None 表示使用默认值

        返回:
            带有物理索引标记的文本

        异常:
            ValidationError: 如果页码超出范围

        使用示例:
            >>> parser = PDFParser()
            >>> text = parser.get_text_with_tags("doc.pdf", 1, 3)
            >>> print(text)
            <start_index_1>
            第一页内容
            <end_index_1>
            <start_index_2>
            第二页内容
            <end_index_2>
            ...
        """
        from ..core.exceptions import ValidationError

        # ============================================================
        # 步骤1: 验证页码
        # ============================================================
        if start_page < 1:
            raise ValidationError(
                f"起始页码必须 >= 1，当前值: {start_page}",
                parameter="start_page",
                value=start_page,
            )

        if end_page < start_page:
            raise ValidationError(
                f"结束页码必须 >= 起始页码，"
                f"当前值: start_page={start_page}, end_page={end_page}",
                parameter="end_page",
                value=end_page,
            )

        logger.debug(f"提取页面文本: {start_page}-{end_page}")

        # ============================================================
        # 步骤2: 解析 PDF
        # ============================================================
        pages = self.parse(pdf_path, parser=parser)

        # ============================================================
        # 步骤3: 验证页码范围
        # ============================================================
        if end_page > len(pages):
            raise ValidationError(
                f"结束页码超出范围，"
                f"PDF 共 {len(pages)} 页，请求页码: {end_page}",
                parameter="end_page",
                value=end_page,
            )

        # ============================================================
        # 步骤4: 提取并添加标记
        # ============================================================
        text = ""
        for page_num in range(start_page - 1, end_page):
            page_text = pages[page_num][0]
            text += (
                f"<start_index_{page_num + 1}>\n"
                f"{page_text}\n"
                f"<end_index_{page_num + 1}>\n"
            )

        logger.debug(
            f"提取完成: {len(text)} 字符, "
            f"页码 {start_page}-{end_page}"
        )
        return text

    def get_text_without_tags(
        self,
        pdf_path: Union[str, BytesIO],
        start_page: int,
        end_page: int,
        parser: Optional[str] = None,
    ) -> str:
        """
        获取指定页码范围的文本，不添加任何标记

        与 get_text_with_tags 的区别是不添加物理索引标记，
        适用于需要纯文本的场景。

        参数:
            pdf_path: PDF 文件路径或 BytesIO 对象
            start_page: 起始页码 (从 1 开始)
            end_page: 结束页码 (包含)
            parser: 指定解析器，None 表示使用默认值

        返回:
            纯文本内容

        异常:
            ValidationError: 如果页码超出范围

        使用示例:
            >>> parser = PDFParser()
            >>> text = parser.get_text_without_tags("doc.pdf", 1, 3)
            >>> print(text)
            第一页内容
            第二页内容
            第三页内容
        """
        from ..core.exceptions import ValidationError

        # ============================================================
        # 步骤1: 验证页码
        # ============================================================
        if start_page < 1:
            raise ValidationError(
                f"起始页码必须 >= 1，当前值: {start_page}",
                parameter="start_page",
                value=start_page,
            )

        if end_page < start_page:
            raise ValidationError(
                f"结束页码必须 >= 起始页码，"
                f"当前值: start_page={start_page}, end_page={end_page}",
                parameter="end_page",
                value=end_page,
            )

        logger.debug(f"提取页面文本 (无标记): {start_page}-{end_page}")

        # ============================================================
        # 步骤2: 解析 PDF
        # ============================================================
        pages = self.parse(pdf_path, parser=parser)

        # ============================================================
        # 步骤3: 验证页码范围
        # ============================================================
        if end_page > len(pages):
            raise ValidationError(
                f"结束页码超出范围，"
                f"PDF 共 {len(pages)} 页，请求页码: {end_page}",
                parameter="end_page",
                value=end_page,
            )

        # ============================================================
        # 步骤4: 提取纯文本
        # ============================================================
        text = ""
        for page_num in range(start_page - 1, end_page):
            text += pages[page_num][0]

        logger.debug(
            f"提取完成: {len(text)} 字符, "
            f"页码 {start_page}-{end_page}"
        )
        return text


# ============================================================
# 便捷函数 (保持向后兼容)
# ============================================================

def get_page_tokens(
    pdf_path: Union[str, BytesIO],
    model: Optional[str] = None,
    pdf_parser: str = "PyMuPDF",
) -> List[Tuple[str, int]]:
    """
    解析 PDF 文件，返回页面文本和 Token 计数

    这是一个便捷函数，用于快速解析 PDF。对于更复杂的场景，
    建议使用 PDFParser 类。

    参数:
        pdf_path: PDF 文件路径或 BytesIO 对象
        model: Token 计数使用的模型名称 (可选，默认从配置文件读取)
        pdf_parser: 解析器类型 ("pypdf" 或 "PyMuPDF")

    返回:
        列表，每个元素是 (页面文本, Token 数量) 的元组

    异常:
        PDFError: 如果解析失败

    使用示例:
        >>> from pageindex.pdf.parser import get_page_tokens
        >>> pages = get_page_tokens("document.pdf")
        >>> for page_text, token_count in pages:
        ...     print(f"Token: {token_count}")
    """
    parser = PDFParser(default_parser=pdf_parser, model=model)
    return parser.parse(pdf_path)


def get_text_of_pages(
    pdf_path: Union[str, BytesIO],
    start_page: int,
    end_page: int,
    tag: bool = True,
) -> str:
    """
    获取指定页码范围的文本

    这是一个便捷函数，用于快速提取页面文本。对于更复杂的场景，
    建议使用 PDFParser 类。

    参数:
        pdf_path: PDF 文件路径或 BytesIO 对象
        start_page: 起始页码 (从 1 开始)
        end_page: 结束页码 (包含)
        tag: 是否添加物理索引标记

    返回:
        页面文本内容

    异常:
        ValidationError: 如果页码超出范围
        PDFError: 如果解析失败

    使用示例:
        >>> from pageindex.pdf.parser import get_text_of_pages
        >>>
        >>> # 带标记
        >>> text = get_text_of_pages("doc.pdf", 1, 3, tag=True)
        >>>
        >>> # 不带标记
        >>> text = get_text_of_pages("doc.pdf", 1, 3, tag=False)
    """
    parser = PDFParser(default_parser="pypdf")

    if tag:
        return parser.get_text_with_tags(pdf_path, start_page, end_page)
    else:
        return parser.get_text_without_tags(pdf_path, start_page, end_page)


def get_text_of_pdf_pages(
    pdf_pages: List[Tuple[str, int]],
    start_page: int,
    end_page: int,
) -> str:
    """
    从已解析的页面列表中提取指定范围的文本

    这是一个便捷函数，用于从 get_page_tokens() 返回的结果中
    提取纯文本。

    参数:
        pdf_pages: get_page_tokens() 返回的页面列表
        start_page: 起始页码 (从 1 开始)
        end_page: 结束页码 (包含)

    返回:
        纯文本内容 (拼接多个页面)

    使用示例:
        >>> from pageindex.pdf.parser import get_page_tokens, get_text_of_pdf_pages
        >>>
        >>> pages = get_page_tokens("doc.pdf")
        >>> text = get_text_of_pdf_pages(pages, 1, 3)
        >>> print(text)  # 第 1-3 页的纯文本
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        text += pdf_pages[page_num][0]
    return text


def get_text_of_pdf_pages_with_labels(
    pdf_pages: List[Tuple[str, int]],
    start_page: int,
    end_page: int,
) -> str:
    """
    从已解析的页面列表中提取指定范围的文本，添加物理索引标记

    物理索引标记格式:
        <physical_index_N>页面内容<physical_index_N>

    这是一个便捷函数，用于从 get_page_tokens() 返回的结果中
    提取带标记的文本。

    参数:
        pdf_pages: get_page_tokens() 返回的页面列表
        start_page: 起始页码 (从 1 开始)
        end_page: 结束页码 (包含)

    返回:
        带有物理索引标记的文本

    使用示例:
        >>> from pageindex.pdf.parser import get_page_tokens, get_text_of_pdf_pages_with_labels
        >>>
        >>> pages = get_page_tokens("doc.pdf")
        >>> text = get_text_of_pdf_pages_with_labels(pages, 1, 3)
        >>> print(text)
        <physical_index_1>
        第一页内容
        <physical_index_1>
        <physical_index_2>
        第二页内容
        <physical_index_2>
        ...
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        text += (
            f"<physical_index_{page_num + 1}>\n"
            f"{pdf_pages[page_num][0]}\n"
            f"<physical_index_{page_num + 1}>\n"
        )
    return text
