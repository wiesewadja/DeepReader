"""
主题报告流水线

协调各模块，生成高质量的主题调查报告。
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

from .citation_validator import CitationValidator, ReflectionEngine
from .deep_searcher import DeepSearchResult, DeepSearcher, SearchResult
from .perspective_analyzer import BookPerspective, PerspectiveAnalyzer
from .query_expander import QueryExpander
from .report_generator import (
    ComparisonMatrix,
    GeneratedReport,
    ReportGenerator,
    ReportType,
    generate_references,
)

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """流水线配置"""

    # LLM 配置
    llm_client: OpenAI
    llm_model: str = "deepseek-chat"

    # 存储配置
    storage_dir: str = ""

    # 搜索配置
    max_sub_queries: int = 5
    top_k_per_query: int = 5
    top_k_per_book: int = 3

    # 功能开关
    enable_query_expansion: bool = True
    enable_comparison_matrix: bool = True
    enable_role_play: bool = False
    enable_reflection: bool = False

    # 报告配置
    report_type: Optional[ReportType] = None  # None 表示自动分类


@dataclass
class ReportOptions:
    """报告生成选项（API 层使用）"""

    enable_query_expansion: bool = True
    enable_role_play: bool = False
    enable_reflection: bool = False
    include_comparison: bool = True
    max_sub_queries: int = 5
    report_type: Optional[str] = None


@dataclass
class PipelineState:
    """流水线状态"""

    theme: str
    expanded_queries: List[str] = field(default_factory=list)
    search_result: Optional[DeepSearchResult] = None
    book_excerpts: Dict[str, List[SearchResult]] = field(default_factory=dict)
    perspectives: Dict[str, BookPerspective] = field(default_factory=dict)
    role_analyses: Dict[str, Any] = field(default_factory=dict)
    comparison_matrix: Optional[ComparisonMatrix] = None
    draft_report: Optional[GeneratedReport] = None
    final_report: Optional[str] = None
    references: str = ""
    report_type: ReportType = ReportType.EXPLORATORY
    coverage_score: Optional[float] = None
    accuracy_score: Optional[float] = None


@dataclass
class ThemeReportResponse:
    """主题报告响应"""

    status: str
    theme: str

    # 核心内容
    unified_summary: str
    book_perspectives: List[Dict[str, Any]]
    comparison_matrix: Optional[str] = None

    # 元信息
    expanded_queries: List[str] = field(default_factory=list)
    report_type: str = ""
    books_searched: int = 0
    total_sources: int = 0

    # 质量指标
    coverage_score: Optional[float] = None
    accuracy_score: Optional[float] = None

    # 输出
    markdown_content: str = ""
    suggested_filename: str = ""

    # 错误处理
    error: Optional[str] = None


class ThemeReportPipeline:
    """
    主题报告流水线

    流程：
    1. 查询扩展（可选）
    2. 深度搜索
    3. 观点提取
    4. 对比矩阵生成（可选）
    5. 角色分析（可选）
    6. 报告生成
    7. 自我反思（可选）
    """

    def __init__(self, config: PipelineConfig):
        """
        初始化流水线

        Args:
            config: 流水线配置
        """
        self.config = config

        # 初始化各模块
        self.expander = QueryExpander(
            client=config.llm_client,
            model=config.llm_model,
            max_sub_queries=config.max_sub_queries,
        )

        self.searcher = DeepSearcher(
            storage_dir=config.storage_dir,
            top_k_per_query=config.top_k_per_query,
        )

        self.perspective_analyzer = PerspectiveAnalyzer(
            client=config.llm_client,
            model=config.llm_model,
        )

        self.report_generator = ReportGenerator(
            client=config.llm_client,
            model=config.llm_model,
        )

        self.citation_validator = CitationValidator(
            client=config.llm_client,
            model=config.llm_model,
        )

        self.reflection_engine = ReflectionEngine(
            client=config.llm_client,
            model=config.llm_model,
        )

    async def run(
        self,
        theme: str,
        index_ids: Optional[List[str]] = None,
        options: Optional[ReportOptions] = None,
    ) -> ThemeReportResponse:
        """
        执行流水线

        Args:
            theme: 主题/问题
            index_ids: 可选，指定索引 ID 列表
            options: 报告选项

        Returns:
            ThemeReportResponse
        """
        if options is None:
            options = ReportOptions()

        state = PipelineState(theme=theme)

        try:
            # Stage 1: 查询扩展
            if options.enable_query_expansion:
                state.expanded_queries = await self._expand_queries(theme)
            else:
                state.expanded_queries = [theme]

            # Stage 2: 深度搜索
            state.search_result = await self._search(
                state.expanded_queries, index_ids, options.max_sub_queries
            )

            if not state.search_result or not state.search_result.results:
                return self._build_error_response(theme, "未找到相关内容")

            # 按书籍分组
            state.book_excerpts = self._group_by_book(state.search_result.results)

            # Stage 3: 观点提取
            state.perspectives = (
                await self.perspective_analyzer.extract_all_perspectives(
                    theme=theme,
                    books_excerpts=state.book_excerpts,
                )
            )

            # Stage 4: 对比矩阵
            if options.include_comparison and len(state.perspectives) >= 2:
                perspective_list = list(state.perspectives.values())
                state.comparison_matrix = (
                    self.report_generator.generate_comparison_matrix(
                        theme=theme,
                        perspectives=perspective_list,
                    )
                )

            # Stage 5: 角色分析
            if options.enable_role_play:
                state.role_analyses = self.perspective_analyzer.analyze_with_roles(
                    theme=theme,
                    content=self._format_perspectives_for_role_play(state.perspectives),
                )

            # 确定报告类型
            if options.report_type:
                state.report_type = ReportType(options.report_type)
            else:
                state.report_type = self.report_generator.classify_theme(theme)

            # Stage 6: 报告生成
            state.draft_report = self.report_generator.generate_report(
                theme=theme,
                perspectives=list(state.perspectives.values()),
                report_type=state.report_type,
                comparison_matrix=state.comparison_matrix,
                role_analyses=state.role_analyses,
            )

            # Stage 7: 自我反思
            if options.enable_reflection:
                reflection = self.reflection_engine.reflect(
                    state.draft_report.content,
                    self._format_sources_for_reflection(state.book_excerpts),
                )
                state.coverage_score = reflection.coverage_score
                state.accuracy_score = reflection.accuracy_score

                # 如果分数太低，尝试修订
                if reflection.coverage_score < 6.0 or reflection.accuracy_score < 6.0:
                    state.final_report = self.reflection_engine.revise_report(
                        state.draft_report.content,
                        reflection,
                    )
                else:
                    state.final_report = state.draft_report.content
            else:
                state.final_report = state.draft_report.content

            # 添加参考文献
            state.references = generate_references(state.search_result.results)
            final_content = state.final_report + state.references

            # 生成文件名
            safe_theme = self._safe_filename(theme)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{safe_theme}_{timestamp}.md"

            return self._build_success_response(state, final_content, filename)

        except Exception as e:
            logger.error(f"[ThemeReportPipeline] 流水线执行失败: {e}", exc_info=True)
            return self._build_error_response(theme, str(e))

    async def _expand_queries(self, theme: str) -> List[str]:
        """查询扩展"""
        logger.info(f"[Pipeline] Stage 1: 查询扩展 - {theme}")

        loop = asyncio.get_event_loop()
        queries = await loop.run_in_executor(
            None,
            lambda: self.expander.expand(theme),
        )

        logger.info(f"[Pipeline] 扩展为 {len(queries)} 个查询")
        return queries

    async def _search(
        self,
        queries: List[str],
        index_ids: Optional[List[str]],
        top_k_per_book: int,
    ) -> DeepSearchResult:
        """深度搜索"""
        logger.info(f"[Pipeline] Stage 2: 深度搜索 - {len(queries)} 个查询")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: self.searcher.search(queries, index_ids, top_k_per_book),
        )

        logger.info(
            f"[Pipeline] 搜索完成: {result.total_results} -> {result.deduped_results} 结果"
        )
        return result

    def _group_by_book(
        self, results: List[SearchResult]
    ) -> Dict[str, List[SearchResult]]:
        """按书籍分组"""
        grouped: Dict[str, List[SearchResult]] = {}
        for r in results:
            if r.book_name not in grouped:
                grouped[r.book_name] = []
            grouped[r.book_name].append(r)
        return grouped

    def _format_perspectives_for_role_play(
        self, perspectives: Dict[str, BookPerspective]
    ) -> str:
        """格式化观点供角色分析使用"""
        parts = []
        for name, p in perspectives.items():
            part = f"《{name}》：{p.core_claim}"
            if p.key_arguments:
                part += "\n  - " + "\n  - ".join(p.key_arguments[:3])
            parts.append(part)
        return "\n\n".join(parts)

    def _format_sources_for_reflection(
        self, book_excerpts: Dict[str, List[SearchResult]]
    ) -> str:
        """格式化来源供反思使用"""
        parts = []
        for book_name, excerpts in book_excerpts.items():
            part = f"《{book_name}》："
            texts = [e.text[:200] for e in excerpts[:3]]
            part += " | ".join(texts)
            parts.append(part)
        return "\n\n".join(parts)

    def _safe_filename(self, name: str) -> str:
        """生成安全文件名"""
        import re

        safe_name = re.sub(r'[<>:"/\\|?*]', "-", name)
        safe_name = re.sub(r"[\s\-]+", "-", safe_name)
        return safe_name.strip("- ")[:50] or "report"

    def _build_success_response(
        self,
        state: PipelineState,
        content: str,
        filename: str,
    ) -> ThemeReportResponse:
        """构建成功响应"""
        # 提取摘要
        summary = ""
        if state.draft_report:
            # 尝试提取第一个非标题段落
            lines = state.draft_report.content.split("\n")
            for line in lines:
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith(">"):
                    summary = line[:300]
                    break

        # 格式化书籍观点
        book_perspectives = []
        for name, p in state.perspectives.items():
            book_perspectives.append(
                {
                    "book_name": name,
                    "book_link": name,
                    "key_points": p.key_arguments[:3] if p.key_arguments else [],
                    "core_claim": p.core_claim,
                    "unique_angle": p.unique_angle,
                    "related_chapter": (
                        state.book_excerpts[name][0].section
                        if name in state.book_excerpts and state.book_excerpts[name]
                        else ""
                    ),
                    "related_chapter_link": (
                        state.book_excerpts[name][0].obsidian_link
                        if name in state.book_excerpts and state.book_excerpts[name]
                        else ""
                    ),
                }
            )

        return ThemeReportResponse(
            status="success",
            theme=state.theme,
            unified_summary=summary,
            book_perspectives=book_perspectives,
            comparison_matrix=(
                state.comparison_matrix.markdown_table
                if state.comparison_matrix
                else None
            ),
            expanded_queries=(
                state.expanded_queries[1:] if len(state.expanded_queries) > 1 else []
            ),
            report_type=state.report_type.value,
            books_searched=len(state.perspectives),
            total_sources=(
                len(state.search_result.results) if state.search_result else 0
            ),
            coverage_score=state.coverage_score,
            accuracy_score=state.accuracy_score,
            markdown_content=content,
            suggested_filename=filename,
        )

    def _build_error_response(self, theme: str, error: str) -> ThemeReportResponse:
        """构建错误响应"""
        return ThemeReportResponse(
            status="error",
            theme=theme,
            unified_summary="",
            book_perspectives=[],
            error=error,
        )
