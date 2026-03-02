"""
引用验证器模块

验证报告中的引用是否准确反映原始内容，减少幻觉。
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from deeppdf.utils import parse_json_object
from .deep_searcher import SearchResult
from .prompts import CITATION_VALIDATION_PROMPT, REFLECTION_PROMPT

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """验证结果"""

    accurate: bool = True
    issues: List[str] = field(default_factory=list)
    suggestion: str = ""


@dataclass
class ReflectionResult:
    """自我反思结果"""

    coverage_score: float = 0.0
    accuracy_score: float = 0.0
    has_overreach: bool = False
    improvement_areas: List[str] = field(default_factory=list)
    suggested_revision: str = ""


class CitationValidator:
    """
    引用验证器

    功能：
    1. 验证报告论断与原始引用的一致性
    2. 检测过度推断或曲解
    3. 批量验证所有引用
    """

    # 匹配引用格式的正则
    CITATION_PATTERN = re.compile(
        r"【《(.+?)》(.+?)(?:，第(\d+)页)?】"
    )

    def __init__(
        self,
        client: Optional[OpenAI] = None,
        model: str = "deepseek-chat",
    ):
        """
        初始化引用验证器

        Args:
            client: OpenAI 客户端（可选，用于深度验证）
            model: 模型名称
        """
        self.client = client
        self.model = model

    def extract_citations(self, report: str) -> List[Dict[str, Any]]:
        """
        从报告中提取所有引用

        Args:
            report: 报告内容

        Returns:
            引用列表，每个元素包含 book_name, section, page
        """
        citations = []
        for match in self.CITATION_PATTERN.finditer(report):
            citations.append(
                {
                    "book_name": match.group(1),
                    "section": match.group(2),
                    "page": int(match.group(3)) if match.group(3) else None,
                    "full_match": match.group(0),
                }
            )
        return citations

    def validate_claim(
        self,
        claim: str,
        source_text: str,
    ) -> ValidationResult:
        """
        验证单个论断与原始引用的一致性

        Args:
            claim: 报告中的论断
            source_text: 原始引用文本

        Returns:
            ValidationResult
        """
        if not self.client:
            # 无 LLM 时，只做简单检查
            return self._simple_validate(claim, source_text)

        try:
            prompt = CITATION_VALIDATION_PROMPT.format(
                claim=claim,
                source_text=source_text,
            )

            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位严谨的学术审核专家，擅长验证引用准确性。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=500,
            )

            content = response.choices[0].message.content or "{}"

            # 解析 JSON
            result = self._parse_json(content)
            return ValidationResult(
                accurate=result.get("accurate", True),
                issues=result.get("issues", []),
                suggestion=result.get("suggestion", ""),
            )

        except Exception as e:
            logger.error(f"[CitationValidator] 验证失败: {e}")
            return ValidationResult(accurate=True)  # 默认通过

    def _simple_validate(self, claim: str, source_text: str) -> ValidationResult:
        """
        简单验证（无 LLM）

        检查：
        1. 论断中的关键词是否在原文中出现
        2. 论断是否明显超出原文范围
        """
        # 提取关键词（简单分词）
        claim_words = set(claim.replace("，", " ").replace("。", " ").split())
        source_words = set(source_text.replace("，", " ").replace("。", " ").split())

        # 计算重叠率
        overlap = len(claim_words & source_words) / max(len(claim_words), 1)

        if overlap < 0.3:
            return ValidationResult(
                accurate=False,
                issues=["论断与原文关键词重叠率较低"],
                suggestion="请确认论断是否准确反映原文内容",
            )

        return ValidationResult(accurate=True)

    def validate_report(
        self,
        report: str,
        sources: Dict[str, List[SearchResult]],
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """
        验证整个报告的引用

        Args:
            report: 报告内容
            sources: 书籍名 -> 搜索结果映射

        Returns:
            (整体是否准确, 问题列表)
        """
        # 提取所有引用
        citations = self.extract_citations(report)

        issues = []
        for citation in citations:
            book_name = citation["book_name"]
            section = citation["section"]
            page = citation["page"]

            # 查找对应的原始文本
            source_text = self._find_source_text(sources, book_name, section, page)

            if not source_text:
                issues.append(
                    {
                        "citation": citation["full_match"],
                        "issue": "未找到对应的原始引用",
                        "severity": "warning",
                    }
                )
                continue

            # 查找引用附近的论断
            claim = self._extract_claim_near_citation(report, citation["full_match"])

            if claim:
                result = self.validate_claim(claim, source_text)
                if not result.accurate:
                    issues.append(
                        {
                            "citation": citation["full_match"],
                            "claim": claim,
                            "issues": result.issues,
                            "suggestion": result.suggestion,
                            "severity": "error",
                        }
                    )

        all_accurate = len([i for i in issues if i.get("severity") == "error"]) == 0
        return all_accurate, issues

    def _find_source_text(
        self,
        sources: Dict[str, List[SearchResult]],
        book_name: str,
        section: str,
        page: Optional[int],
    ) -> Optional[str]:
        """
        查找原始引用文本

        Args:
            sources: 搜索结果映射
            book_name: 书名
            section: 章节
            page: 页码

        Returns:
            原始文本或 None
        """
        # 尝试匹配书名
        for source_book, results in sources.items():
            if book_name in source_book or source_book in book_name:
                for r in results:
                    # 匹配章节和页码
                    if section in r.section:
                        if page is None or r.page == page:
                            return r.text

        return None

    def _extract_claim_near_citation(
        self, report: str, citation: str
    ) -> Optional[str]:
        """
        提取引用附近的论断文本

        Args:
            report: 报告内容
            citation: 引用标记

        Returns:
            论断文本
        """
        try:
            idx = report.index(citation)
            # 取引用前 200 字符
            start = max(0, idx - 200)
            claim = report[start:idx]

            # 取最后一个完整句子
            sentences = re.split(r"[。！？]", claim)
            if sentences:
                return sentences[-1].strip()

        except ValueError:
            pass

        return None

    def _parse_json(self, content: str) -> Dict[str, Any]:
        """
        解析 JSON 内容

        Args:
            content: 可能包含 JSON 的字符串

        Returns:
            解析后的字典
        """
        return parse_json_object(content, default={})


class ReflectionEngine:
    """
    自我反思引擎

    在报告生成后进行自我评估和修订。
    """

    def __init__(
        self,
        client: OpenAI,
        model: str = "deepseek-chat",
    ):
        """
        初始化反思引擎

        Args:
            client: OpenAI 客户端
            model: 模型名称
        """
        self.client = client
        self.model = model

    def reflect(
        self,
        report: str,
        sources_summary: str,
    ) -> ReflectionResult:
        """
        对报告进行自我反思

        Args:
            report: 生成的报告
            sources_summary: 原始材料摘要

        Returns:
            ReflectionResult
        """
        logger.info("[ReflectionEngine] 开始自我反思")

        prompt = REFLECTION_PROMPT.format(
            report=report[:3000],  # 限制长度
            sources_summary=sources_summary[:2000],
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位严格的学术质量审核专家。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=1000,
            )

            content = response.choices[0].message.content or "{}"

            # 解析结果
            result = self._parse_reflection_result(content)

            logger.info(
                f"[ReflectionEngine] 反思完成: 覆盖 {result.coverage_score}, "
                f"准确性 {result.accuracy_score}"
            )

            return result

        except Exception as e:
            logger.error(f"[ReflectionEngine] 反思失败: {e}")
            return ReflectionResult()

    def _parse_reflection_result(self, content: str) -> ReflectionResult:
        """
        解析反思结果

        Args:
            content: LLM 返回的内容

        Returns:
            ReflectionResult
        """
        # 尝试提取 JSON
        json_match = re.search(r"\{[\s\S]*\}", content)
        if json_match:
            try:
                data = json.loads(json_match.group())
                scores = data.get("scores", {})

                return ReflectionResult(
                    coverage_score=float(scores.get("coverage", 7)),
                    accuracy_score=float(scores.get("accuracy", 7)),
                    has_overreach=data.get("has_overreach", False),
                    improvement_areas=data.get("improvement_areas", []),
                    suggested_revision=data.get("suggested_revision", ""),
                )
            except (json.JSONDecodeError, ValueError):
                pass

        # 默认值
        return ReflectionResult()

    def revise_report(
        self,
        report: str,
        reflection: ReflectionResult,
    ) -> str:
        """
        根据反思结果修订报告

        Args:
            report: 原始报告
            reflection: 反思结果

        Returns:
            修订后的报告
        """
        if not reflection.suggested_revision:
            return report

        # 如果有具体修订建议，应用修订
        prompt = f"""请根据以下反思结果修订报告：

## 原始报告
{report[:2000]}

## 反思发现的问题
{chr(10).join(f'- {area}' for area in reflection.improvement_areas)}

## 修订建议
{reflection.suggested_revision}

请输出修订后的完整报告。只输出报告内容，不要添加解释。"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位专业的报告修订专家。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=4000,
            )

            return response.choices[0].message.content or report

        except Exception as e:
            logger.error(f"[ReflectionEngine] 修订失败: {e}")
            return report
