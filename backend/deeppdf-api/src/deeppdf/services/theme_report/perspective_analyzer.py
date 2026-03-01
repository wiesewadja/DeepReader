"""
观点分析器模块

支持角色扮演分析和多角度审视。
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from openai import OpenAI

from .prompts import ROLE_PLAY_PROMPTS
from .report_generator import BookPerspective

logger = logging.getLogger(__name__)


@dataclass
class RoleAnalysis:
    """角色分析结果"""

    role: str
    insights: List[str] = field(default_factory=list)
    concerns: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)


class PerspectiveAnalyzer:
    """
    观点分析器

    支持从多个角色视角分析内容：
    - **批判者 (skeptic)**：找逻辑漏洞、反例、需要证据的论断
    - **整合者 (synthesizer)**：找共识、互补视角、可融合的见解
    - **实践者 (practitioner)**：评估实用价值、前提条件、潜在挑战
    """

    def __init__(
        self,
        client: OpenAI,
        model: str = "deepseek-chat",
    ):
        """
        初始化观点分析器

        Args:
            client: OpenAI 客户端
            model: 模型名称
        """
        self.client = client
        self.model = model

    def analyze_with_roles(
        self,
        theme: str,
        content: str,
        roles: Optional[List[str]] = None,
    ) -> Dict[str, RoleAnalysis]:
        """
        从多个角色视角分析内容

        Args:
            theme: 主题
            content: 待分析内容（如整合后的观点）
            roles: 角色列表，默认使用 ["skeptic", "synthesizer", "practitioner"]

        Returns:
            角色名称到分析结果的映射
        """
        if roles is None:
            roles = ["skeptic", "synthesizer", "practitioner"]

        logger.info(f"[PerspectiveAnalyzer] 开始 {len(roles)} 角色分析")

        results: Dict[str, RoleAnalysis] = {}

        for role in roles:
            if role not in ROLE_PLAY_PROMPTS:
                logger.warning(f"[PerspectiveAnalyzer] 未知角色: {role}")
                continue

            analysis = self._analyze_single_role(theme, content, role)
            results[role] = analysis

        logger.info(f"[PerspectiveAnalyzer] 角色分析完成: {len(results)} 个角色")
        return results

    def _analyze_single_role(
        self,
        theme: str,
        content: str,
        role: str,
    ) -> RoleAnalysis:
        """
        单角色分析

        Args:
            theme: 主题
            content: 待分析内容
            role: 角色名称

        Returns:
            RoleAnalysis
        """
        prompt_template = ROLE_PLAY_PROMPTS.get(role, "")
        prompt = prompt_template.format(theme=theme, content=content)

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": f"你是一位{self._get_role_description(role)}。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=1000,
            )

            content = response.choices[0].message.content or ""
            return self._parse_role_analysis(role, content)

        except Exception as e:
            logger.error(f"[PerspectiveAnalyzer] 角色 {role} 分析失败: {e}")
            return RoleAnalysis(role=role)

    def _get_role_description(self, role: str) -> str:
        """获取角色描述"""
        descriptions = {
            "skeptic": "批判性思考专家，擅长发现逻辑漏洞和需要证据支持的论断",
            "synthesizer": "知识整合专家，擅长发现共识、互补视角和创新融合点",
            "practitioner": "实践专家，擅长评估实用价值、前提条件和潜在挑战",
        }
        return descriptions.get(role, "分析专家")

    def _parse_role_analysis(self, role: str, content: str) -> RoleAnalysis:
        """
        解析角色分析结果

        Args:
            role: 角色名称
            content: LLM 返回的内容

        Returns:
            RoleAnalysis
        """
        insights = []
        concerns = []
        suggestions = []

        # 尝试提取列表项
        patterns = {
            "insights": r"(?:见解|发现|共识|互补|融合)[：:]\s*([\s\S]*?)(?=##|$)",
            "concerns": r"(?:漏洞|问题|反例|挑战|风险)[：:]\s*([\s\S]*?)(?=##|$)",
            "suggestions": r"(?:建议|改进|修改)[：:]\s*([\s\S]*?)(?=##|$)",
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                items = re.findall(r"[-\d]+\.\s*(.+?)(?=\n|$)", match.group(1))
                if key == "insights":
                    insights = [item.strip() for item in items if item.strip()]
                elif key == "concerns":
                    concerns = [item.strip() for item in items if item.strip()]
                elif key == "suggestions":
                    suggestions = [item.strip() for item in items if item.strip()]

        # 如果没有匹配到结构化内容，尝试提取所有列表项
        if not insights and not concerns and not suggestions:
            all_items = re.findall(r"[-\d]+\.\s*(.+?)(?=\n|$)", content)
            insights = [item.strip() for item in all_items if item.strip()]

        return RoleAnalysis(
            role=role,
            insights=insights,
            concerns=concerns,
            suggestions=suggestions,
        )

    def extract_book_perspective(
        self,
        theme: str,
        book_name: str,
        excerpts: List[Dict[str, Any]],
    ) -> BookPerspective:
        """
        从单本书籍中提取与主题相关的观点

        Args:
            theme: 主题
            book_name: 书籍名称
            excerpts: 相关片段列表

        Returns:
            BookPerspective
        """
        if not excerpts:
            return BookPerspective(book_name=book_name)

        # 格式化片段
        formatted_excerpts = []
        for i, excerpt in enumerate(excerpts[:5], 1):  # 最多 5 个片段
            text = excerpt.get("text", "")
            section = excerpt.get("section", "未知章节")
            page = excerpt.get("page", "未知页码")

            # 截断过长的文本
            if len(text) > 600:
                text = text[:600] + "..."
            formatted_excerpts.append(f"### 片段 {i}（{section}，第 {page} 页）\n{text}")

        excerpts_text = "\n\n".join(formatted_excerpts)

        prompt = f"""请从以下书籍片段中提取与主题「{theme}」相关的核心观点。

书籍名称：《{book_name}》

相关片段：
{excerpts_text}

请严格按照以下 JSON 格式输出，不要添加任何其他内容：
{{
    "core_claim": "这本书对主题的核心观点（1-2 句话，50 字以内）",
    "key_arguments": [
        "论据1（具体、可验证）",
        "论据2",
        "论据3"
    ],
    "unique_angle": "独特视角或侧重点（1 句话）",
    "quotes": [
        {{"text": "原文摘录（30 字以内）", "page": 页码}}
    ],
    "confidence": "high/medium/low"
}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位专业的知识分析师，擅长从文本中提取关键观点。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=1000,
            )

            content = response.choices[0].message.content or "{}"
            data = self._parse_json_response(content)

            return BookPerspective(
                book_name=book_name,
                core_claim=data.get("core_claim", ""),
                key_arguments=data.get("key_arguments", []),
                unique_angle=data.get("unique_angle", ""),
                quotes=data.get("quotes", []),
                confidence=data.get("confidence", "medium"),
                source_excerpts=[],
            )

        except Exception as e:
            logger.error(f"[PerspectiveAnalyzer] 观点提取失败: {e}")
            return BookPerspective(book_name=book_name)

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """解析 JSON 响应"""
        # 尝试直接解析
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 对象
        json_match = re.search(r"\{[\s\S]*\}", content)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        return {}

    async def extract_all_perspectives(
        self,
        theme: str,
        books_excerpts: Dict[str, List[Dict[str, Any]]],
        max_concurrent: int = 3,
    ) -> Dict[str, BookPerspective]:
        """
        并行提取多本书籍的观点

        Args:
            theme: 主题
            books_excerpts: 书籍名称到片段列表的映射
            max_concurrent: 最大并发数

        Returns:
            书籍名称到观点的映射
        """
        logger.info(
            f"[PerspectiveAnalyzer] 开始提取 {len(books_excerpts)} 本书"
        )

        results: Dict[str, BookPerspective] = {}

        # 使用信号量控制并发
        semaphore = asyncio.Semaphore(max_concurrent)

        async def extract_one(book_name: str, excerpts: List[Dict[str, Any]]):
            async with semaphore:
                # 在线程池中执行同步方法
                loop = asyncio.get_event_loop()
                perspective = await loop.run_in_executor(
                    None,
                    lambda: self.extract_book_perspective(theme, book_name, excerpts),
                )
                return book_name, perspective

        # 并行执行
        tasks = [
            extract_one(book_name, excerpts)
            for book_name, excerpts in books_excerpts.items()
        ]

        for future in asyncio.as_completed(tasks):
            book_name, perspective = await future
            results[book_name] = perspective

        logger.info(
            f"[PerspectiveAnalyzer] 观点提取完成: {len(results)} 本书"
        )
        return results
