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
"""

from .query_expander import QueryExpander
from .deep_searcher import DeepSearcher
from .perspective_analyzer import PerspectiveAnalyzer
from .report_generator import ReportGenerator, ReportType
from .citation_validator import CitationValidator
from .pipeline import ThemeReportPipeline, PipelineConfig, ReportOptions

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
]
