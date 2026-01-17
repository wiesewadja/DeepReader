"""
PageIndex - PDF 文档结构分析库

本库提供 PDF 文档的章节级别分割和 LLM 驱动的树结构生成功能。

主要功能:
    - PDF 文本提取和解析
    - 目录 (TOC) 检测和解析
    - 文档结构树生成
    - 章节摘要生成
    - 多种 LLM Provider 支持

使用示例:
    >>> from pageindex import page_index
    >>>
    >>> # 索引 PDF 文档
    >>> result = page_index("document.pdf")
    >>> print(f"文档名称: {result['doc_name']}")
    >>> print(f"结构: {result['structure']}")
    >>>
    >>> # 高级用法
    >>> from pageindex.core import ConfigLoader
    >>> from pageindex.llm import get_provider, UnifiedLLM
    >>>
    >>> # 自定义配置
    >>> config = ConfigLoader().load({"model": "gpt-4o"})
    >>> provider = get_provider(config.llm_provider)
    >>> llm_client = UnifiedLLM(provider=provider, model=config.model)
    >>>
    >>> # 索引文档
    >>> result = page_index("document.pdf", llm_client=llm_client)

模块组织:
    - core: 核心基础设施 (异常、配置)
    - pdf: PDF 处理 (解析、Token 计数)
    - llm: LLM 抽象层 (客户端、Provider)
    - toc: 目录处理 (检测、解析、验证、修复)
    - structure: 结构处理 (树操作、节点操作)
    - json_ops: JSON 操作 (提取、清理)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

# 主入口函数
from .page_index import (
    page_index_main,
    page_index,
    tree_parser,
)

# Markdown 处理
from .page_index_md import md_to_tree

# 新模块 (用于高级用法)
from .core import (
    PageIndexError,
    PDFError,
    TOCError,
    LLMError,
    ValidationError,
    RetryExhaustedError,
    TimeoutError,
    ConfigLoader,
    load_config,
)
from .pdf import (
    PDFParser,
    get_page_tokens,
    get_text_of_pages,
    count_tokens,
)
from .llm import (
    UnifiedLLM,
    get_provider as get_llm_provider,
)
from .llm.providers import LLMProvider, LLMProviderFactory
from .toc import (
    find_toc_pages,
    toc_transformer,
    verify_toc,
)
from .structure import (
    list_to_tree,
    structure_to_list,
    get_leaf_nodes,
)
from .json_ops import (
    extract_json,
)

__all__ = [
    # 主入口
    "page_index_main",
    "page_index",
    "tree_parser",
    "md_to_tree",
    # LLM (向后兼容)
    "LLMProvider",
    "LLMProviderFactory",
    "UnifiedLLM",
    # 核心模块
    "PageIndexError",
    "PDFError",
    "TOCError",
    "LLMError",
    "ValidationError",
    "RetryExhaustedError",
    "TimeoutError",
    "ConfigLoader",
    "load_config",
    # PDF 模块
    "PDFParser",
    "get_page_tokens",
    "get_text_of_pages",
    "count_tokens",
    # LLM 模块
    "get_llm_provider",
    # TOC 模块
    "find_toc_pages",
    "toc_transformer",
    "verify_toc",
    # 结构模块
    "list_to_tree",
    "structure_to_list",
    "get_leaf_nodes",
    # JSON 模块
    "extract_json",
]
