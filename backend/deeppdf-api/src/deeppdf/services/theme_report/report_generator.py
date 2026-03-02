"""
报告生成器模块

支持动态报告结构和对比矩阵生成。
"""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from .deep_searcher import SearchResult
from .prompts import (
    COMPARISON_MATRIX_PROMPT,
    INTEGRATE_PERSPECTIVES_PROMPT_V2,
    REPORT_TEMPLATES,
    THEME_CLASSIFICATION_PROMPT,
)

logger = logging.getLogger(__name__)


class ReportType(str, Enum):
    """报告类型"""

    EXPLORATORY = "exploratory"  # 探索性：背景→概念→视角→启示→问题
    COMPARATIVE = "comparative"  # 对比性：定义→对比矩阵→共识分歧→综合评价
    PRACTICAL = "practical"  # 实践性：原则→方法→案例→行动建议


@dataclass
class BookPerspective:
    """书籍观点"""

    book_name: str
    core_claim: str = ""
    key_arguments: List[str] = field(default_factory=list)
    unique_angle: str = ""
    quotes: List[Dict[str, Any]] = field(default_factory=list)
    confidence: str = "medium"
    source_excerpts: List[SearchResult] = field(default_factory=list)


@dataclass
class ComparisonMatrix:
    """对比矩阵"""

    markdown_table: str
    consensus_points: List[str]
    divergence_points: List[str]
    dimensions: List[str]


@dataclass
class GeneratedReport:
    """生成的报告"""

    content: str
    report_type: ReportType
    comparison_matrix: Optional[ComparisonMatrix] = None
    coverage_score: Optional[float] = None
    accuracy_score: Optional[float] = None
    reflection: Optional[Dict[str, Any]] = None


class ThemeClassifier:
    """
    主题分类器

    根据主题关键词判断报告类型。
    """

    PRACTICAL_KEYWORDS = [
        "如何",
        "怎么",
        "方法",
        "步骤",
        "技巧",
        "实践",
        "指南",
        "实现",
        "做到",
    ]

    COMPARATIVE_KEYWORDS = [
        "对比",
        "比较",
        "区别",
        "差异",
        "异同",
        "vs",
        "versus",
        "哪个",
        "更好",
    ]

    @classmethod
    def classify(cls, theme: str) -> ReportType:
        """
        分类主题类型

        Args:
            theme: 主题字符串

        Returns:
            ReportType 枚举值
        """
        theme_lower = theme.lower()

        # 检查实践性关键词
        for keyword in cls.PRACTICAL_KEYWORDS:
            if keyword in theme_lower:
                return ReportType.PRACTICAL

        # 检查对比性关键词
        for keyword in cls.COMPARATIVE_KEYWORDS:
            if keyword in theme_lower:
                return ReportType.COMPARATIVE

        # 默认探索性
        return ReportType.EXPLORATORY


class ReportGenerator:
    """
    报告生成器

    功能：
    1. 动态报告结构选择
    2. 对比矩阵生成
    3. 多书籍观点整合
    4. 引用格式化
    """

    def __init__(
        self,
        client: OpenAI,
        model: str = "deepseek-chat",
    ):
        """
        初始化报告生成器

        Args:
            client: OpenAI 客户端
            model: 模型名称
        """
        self.client = client
        self.model = model
        self.classifier = ThemeClassifier()

    def classify_theme(self, theme: str) -> ReportType:
        """
        分类主题类型

        Args:
            theme: 主题字符串

        Returns:
            ReportType
        """
        return self.classifier.classify(theme)

    def generate_comparison_matrix(
        self,
        theme: str,
        perspectives: List[BookPerspective],
    ) -> Optional[ComparisonMatrix]:
        """
        生成对比矩阵

        Args:
            theme: 主题
            perspectives: 书籍观点列表

        Returns:
            ComparisonMatrix 或 None
        """
        if len(perspectives) < 2:
            logger.info("[ReportGenerator] 书籍数少于 2，跳过对比矩阵")
            return None

        logger.info(f"[ReportGenerator] 生成对比矩阵: {len(perspectives)} 本书")

        # 构建输入
        book_names = []
        book_perspectives_text = ""
        for p in perspectives:
            book_names.append(p.book_name)
            book_perspectives_text += f"\n### 《{p.book_name}》\n"
            book_perspectives_text += f"- 核心观点：{p.core_claim}\n"
            book_perspectives_text += f"- 独特视角：{p.unique_angle}\n"

        prompt = COMPARISON_MATRIX_PROMPT.format(
            theme=theme,
            book_names=" | ".join(book_names),
            book_perspectives=book_perspectives_text,
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位专业的知识整合专家，擅长生成结构化的对比分析。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=2000,
            )

            content = response.choices[0].message.content or ""

            # 解析结果
            return self._parse_comparison_result(content, perspectives)

        except Exception as e:
            logger.error(f"[ReportGenerator] 对比矩阵生成失败: {e}")
            return None

    def _parse_comparison_result(
        self,
        content: str,
        perspectives: List[BookPerspective],
    ) -> ComparisonMatrix:
        """
        解析对比矩阵结果

        Args:
            content: LLM 返回的内容
            perspectives: 书籍观点列表

        Returns:
            ComparisonMatrix
        """
        # 提取 Markdown 表格
        table_match = re.search(r"\|.+\|[\s\S]*?\|.+\|", content)
        markdown_table = table_match.group(0) if table_match else ""

        # 提取共识点
        consensus = []
        consensus_match = re.search(r"共识[点点]?[：:]\s*([\s\S]*?)(?=分歧|$)", content)
        if consensus_match:
            items = re.findall(r"[-\d]+\.\s*(.+?)(?=\n|$)", consensus_match.group(1))
            consensus = [item.strip() for item in items if item.strip()]

        # 提取分歧点
        divergence = []
        divergence_match = re.search(r"分歧[点点]?[：:]\s*([\s\S]*?)(?=###|$)", content)
        if divergence_match:
            items = re.findall(r"[-\d]+\.\s*(.+?)(?=\n|$)", divergence_match.group(1))
            divergence = [item.strip() for item in items if item.strip()]

        # 提取维度
        dimensions = []
        if markdown_table:
            # 从表头提取维度
            header_line = markdown_table.split("\n")[0]
            dimensions = [
                cell.strip() for cell in header_line.split("|") if cell.strip()
            ]

        return ComparisonMatrix(
            markdown_table=markdown_table,
            consensus_points=consensus,
            divergence_points=divergence,
            dimensions=dimensions,
        )

    def generate_report(
        self,
        theme: str,
        perspectives: List[BookPerspective],
        report_type: Optional[ReportType] = None,
        comparison_matrix: Optional[ComparisonMatrix] = None,
        role_analyses: Optional[Dict[str, str]] = None,
    ) -> GeneratedReport:
        """
        生成完整报告

        Args:
            theme: 主题
            perspectives: 书籍观点列表
            report_type: 报告类型（可选，自动分类）
            comparison_matrix: 对比矩阵（可选）
            role_analyses: 角色分析结果（可选）

        Returns:
            GeneratedReport
        """
        # 自动分类主题
        if report_type is None:
            report_type = self.classify_theme(theme)

        logger.info(f"[ReportGenerator] 生成报告: {theme}, 类型: {report_type.value}")

        # 构建书籍观点文本
        book_perspectives_text = self._format_perspectives(perspectives)

        # 构建对比矩阵文本
        comparison_text = ""
        if comparison_matrix:
            comparison_text = f"### 对比矩阵\n\n{comparison_matrix.markdown_table}\n\n"
            if comparison_matrix.consensus_points:
                comparison_text += f"**共识点**：\n" + "\n".join(
                    f"- {p}" for p in comparison_matrix.consensus_points
                )
            if comparison_matrix.divergence_points:
                comparison_text += f"\n\n**分歧点**：\n" + "\n".join(
                    f"- {p}" for p in comparison_matrix.divergence_points
                )

        # 构建角色分析文本
        role_text = ""
        if role_analyses:
            for role, analysis in role_analyses.items():
                role_text += f"\n### {role} 视角\n\n{analysis}\n"

        # 获取输出结构模板
        output_structure = self._get_output_structure(report_type)

        # 生成报告
        prompt = INTEGRATE_PERSPECTIVES_PROMPT_V2.format(
            theme=theme,
            report_type=report_type.value,
            book_perspectives=book_perspectives_text,
            role_analyses=role_text or "无",
            comparison_matrix=comparison_text or "无",
            output_structure=output_structure,
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位专业的知识整合专家，擅长撰写结构化、引用规范的主题报告。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=4000,
            )

            report_content = response.choices[0].message.content or ""

            # 添加报告头部
            full_report = self._add_report_header(
                report_content,
                theme,
                report_type,
                len(perspectives),
            )

            return GeneratedReport(
                content=full_report,
                report_type=report_type,
                comparison_matrix=comparison_matrix,
            )

        except Exception as e:
            logger.error(f"[ReportGenerator] 报告生成失败: {e}")
            raise

    def _format_perspectives(self, perspectives: List[BookPerspective]) -> str:
        """
        格式化书籍观点为文本

        Args:
            perspectives: 书籍观点列表

        Returns:
            格式化后的文本
        """
        parts = []
        for p in perspectives:
            part = f"## 《{p.book_name}》\n\n"
            part += f"**核心观点**：{p.core_claim}\n\n"

            if p.key_arguments:
                part += "**关键论据**：\n"
                for arg in p.key_arguments:
                    part += f"- {arg}\n"
                part += "\n"

            if p.unique_angle:
                part += f"**独特视角**：{p.unique_angle}\n\n"

            if p.quotes:
                part += "**原文引用**：\n"
                for quote in p.quotes:
                    page = quote.get("page", "?")
                    text = quote.get("text", "")
                    part += f'> "{text}"（第 {page} 页）\n'
                part += "\n"

            parts.append(part)

        return "\n---\n".join(parts)

    def _get_output_structure(self, report_type: ReportType) -> str:
        """
        获取输出结构模板

        Args:
            report_type: 报告类型

        Returns:
            结构描述文本
        """
        structures = {
            ReportType.EXPLORATORY: """
## 1. 主题概述
（简要介绍主题背景和重要性）

## 2. 核心概念
（定义关键概念）

## 3. 多维视角
（不同书籍的观点分析）

## 4. 关键见解
（最重要的发现和洞察）

## 5. 实践启示
（对实践的指导意义）

## 6. 延伸思考
（值得进一步探讨的问题）
""",
            ReportType.COMPARATIVE: """
## 1. 概念界定
（各书对核心概念的定义）

## 2. 观点对比矩阵
（Markdown 表格对比）

## 3. 共识与分歧
（所有书都同意的观点 vs 存在不同看法的地方）

## 4. 综合评价
（整合各书观点后的综合看法）

## 5. 实践建议
（基于对比分析的实践建议）
""",
            ReportType.PRACTICAL: """
## 1. 核心原则
（必须理解的基本原则）

## 2. 方法步骤
（具体的操作方法和步骤）

## 3. 案例分析
（实际应用案例）

## 4. 常见问题
（FAQ 和注意事项）

## 5. 行动清单
（可立即执行的行动建议）
""",
        }
        return structures.get(report_type, structures[ReportType.EXPLORATORY])

    def _add_report_header(
        self,
        content: str,
        theme: str,
        report_type: ReportType,
        books_count: int,
    ) -> str:
        """
        添加报告头部信息

        Args:
            content: 报告内容
            theme: 主题
            report_type: 报告类型
            books_count: 书籍数量

        Returns:
            完整报告
        """
        type_names = {
            ReportType.EXPLORATORY: "探索性分析",
            ReportType.COMPARATIVE: "对比分析",
            ReportType.PRACTICAL: "实践指南",
        }

        header = f"""# 主题调查报告：{theme}

> 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}
> 搜索书籍：{books_count} 本
> 报告类型：{type_names.get(report_type, "综合分析")}

---

"""
        return header + content


def generate_references(
    results: List[SearchResult],
    max_refs: int = 20,
) -> str:
    """
    生成参考文献部分

    Args:
        results: 搜索结果列表
        max_refs: 最大引用数

    Returns:
        Markdown 格式的参考文献
    """
    if not results:
        return ""

    refs = []
    seen = set()

    for i, r in enumerate(results[:max_refs], 1):
        # 去重
        key = f"{r.book_name}-{r.section}-{r.page}"
        if key in seen:
            continue
        seen.add(key)

        if r.obsidian_link:
            refs.append(
                f"{i}. [[{r.obsidian_link}|《{r.book_name}》- {r.section}（第 {r.page} 页）]]"
            )
        else:
            refs.append(f"{i}. 《{r.book_name}》- {r.section}（第 {r.page} 页）")

    return "\n\n---\n\n## 参考文献\n\n" + "\n".join(refs)
