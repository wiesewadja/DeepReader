"""
主题报告增强模块

提供多阶段流水线生成高质量主题调查报告。

主要组件：
- QueryExpander: 查询扩展，将主题拆解为子问题
- DeepSearcher: 深度搜索，多策略检索
- PerspectiveAnalyzer: 观点分析器，角色扮演分析
- ReportGenerator: 动态报告生成器
- CitationValidator: 引用验证器
- ThemeReportPipeline: 流水线协调器

向后兼容：
- generate_theme_report: 兼容旧版 API
- generate_theme_report_markdown: 兼容旧版 API
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

from deeppdf.config import settings

from .query_expander import QueryExpander
from .deep_searcher import DeepSearcher
from .perspective_analyzer import PerspectiveAnalyzer
from .report_generator import ReportGenerator, ReportType
from .citation_validator import CitationValidator
from .pipeline import ThemeReportPipeline, PipelineConfig, ReportOptions

logger = logging.getLogger(__name__)

__all__ = [
    "QueryExpander",
    "DeepSearcher",
    "PerspectiveAnalyzer",
    "ReportGenerator",
    "ReportType",
    "CitationValidator",
    "ThemeReportPipeline",
    "PipelineConfig",
    "ReportOptions",
    "_get_llm_client",
    # 向后兼容
    "generate_theme_report",
    "generate_theme_report_markdown",
]


def _get_llm_client() -> OpenAI:
    """
    获取 LLM 客户端

    Returns:
        OpenAI 客户端实例
    """
    # 根据 provider 选择 base_url
    if settings.llm_provider == "deepseek":
        base_url = "https://api.deepseek.com"
    elif settings.llm_provider == "openai":
        base_url = "https://api.openai.com/v1"
    else:
        base_url = settings.llm_base_url or "https://api.deepseek.com"

    # 获取 API Key
    if settings.llm_provider == "deepseek":
        api_key = settings.deepseek_api_key
    elif settings.llm_provider == "openai":
        api_key = settings.openai_api_key
    else:
        api_key = settings.deepseek_api_key

    return OpenAI(
        api_key=api_key,
        base_url=base_url,
    )


# ========== 向后兼容函数 ==========


async def generate_theme_report(
    theme: str,
    storage_dir: str,
    index_ids: Optional[List[str]] = None,
    top_k_per_book: int = 3,
) -> Dict[str, Any]:
    """
    生成主题报告（向后兼容函数）

    使用新的流水线实现，但保持与旧版 API 的兼容性。

    Args:
        theme: 主题/问题
        storage_dir: 存储目录
        index_ids: 可选，指定索引 ID 列表
        top_k_per_book: 每本书取多少条结果

    Returns:
        与旧版格式兼容的结果字典
    """
    logger.info(f"[向后兼容] generate_theme_report: theme='{theme}'")

    try:
        # 创建 LLM 客户端
        client = _get_llm_client()

        # 创建流水线配置
        config = PipelineConfig(
            llm_client=client,
            llm_model=settings.llm_model,
            storage_dir=storage_dir,
            top_k_per_book=top_k_per_book,
        )

        # 创建选项（使用默认的 P0 功能）
        options = ReportOptions(
            enable_query_expansion=True,
            enable_role_play=False,
            enable_reflection=False,
            include_comparison=True,
        )

        # 运行流水线
        pipeline = ThemeReportPipeline(config)
        result = await pipeline.run(
            theme=theme,
            index_ids=index_ids,
            options=options,
        )

        # 转换为旧版格式
        return {
            "status": result.status,
            "theme": result.theme,
            "unified_summary": result.unified_summary,
            "book_perspectives": [
                {
                    "book_name": bp.get("book_name", ""),
                    "book_link": bp.get("book_link", ""),
                    "key_points": bp.get("key_points", []),
                    "related_chapter": bp.get("related_chapter", ""),
                    "related_chapter_link": bp.get("related_chapter_link", ""),
                }
                for bp in result.book_perspectives
            ],
            "books_searched": result.books_searched,
            "markdown_content": result.markdown_content,
            "suggested_filename": result.suggested_filename,
            "error": result.error,
        }

    except Exception as e:
        logger.error(f"[向后兼容] generate_theme_report 失败: {e}")
        return {
            "status": "error",
            "theme": theme,
            "error": str(e),
        }


def generate_theme_report_markdown(
    theme: str,
    book_perspectives: List[Dict[str, Any]],
) -> str:
    """
    生成主题报告 Markdown（向后兼容函数）

    Args:
        theme: 主题
        book_perspectives: 书籍观点列表

    Returns:
        Markdown 格式的报告
    """
    logger.info(f"[向后兼容] generate_theme_report_markdown: theme='{theme}'")

    # 简单实现：生成基础 Markdown
    lines = [
        f"# 主题调查报告：{theme}",
        "",
        "## 书籍观点",
        "",
    ]

    for bp in book_perspectives:
        book_name = bp.get("book_name", "未知书籍")
        lines.append(f"### 《{book_name}》")
        lines.append("")

        key_points = bp.get("key_points", [])
        if key_points:
            for point in key_points:
                lines.append(f"- {point}")
            lines.append("")

    return "\n".join(lines)
