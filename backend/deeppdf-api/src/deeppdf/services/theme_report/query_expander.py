"""
查询扩展模块

将用户主题拆解为多个子问题，以便更全面地搜索相关内容。
"""

import logging
import re
from typing import List, Optional

from openai import OpenAI

from deeppdf.utils import parse_json_array
from .prompts import QUERY_EXPANSION_PROMPT

logger = logging.getLogger(__name__)


class QueryExpander:
    """
    查询扩展器

    将用户主题拆解为 3-5 个具体的子问题，
    以便更全面地搜索相关内容。

    使用场景：
    - 用户输入模糊主题时，拆解为具体问题
    - 搜索前预扩展，提高召回率
    """

    def __init__(
        self,
        client: OpenAI,
        model: str = "deepseek-chat",
        max_sub_queries: int = 5,
    ):
        """
        初始化查询扩展器

        Args:
            client: OpenAI 客户端
            model: 模型名称
            max_sub_queries: 最大子问题数
        """
        self.client = client
        self.model = model
        self.max_sub_queries = max_sub_queries

    def expand(self, theme: str) -> List[str]:
        """
        将主题拆解为子问题列表

        Args:
            theme: 用户输入的主题/问题

        Returns:
            子问题列表，包含原始主题作为第一个元素
            [原始主题, 子问题1, 子问题2, ...]
        """
        logger.info(f"[QueryExpander] 开始扩展主题: {theme}")

        # 构建 Prompt
        prompt = QUERY_EXPANSION_PROMPT.format(theme=theme)

        try:
            # 调用 LLM
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位研究专家，擅长将复杂主题拆解为具体的研究问题。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=500,
            )

            content = response.choices[0].message.content or "[]"
            logger.debug(f"[QueryExpander] LLM 原始响应: {content}")

            # 解析 JSON
            sub_queries = self._parse_json_response(content)

            # 限制数量
            sub_queries = sub_queries[: self.max_sub_queries]

            # 去重
            unique_queries = list(dict.fromkeys(sub_queries))

            # 原始主题始终放在第一位
            result = [theme] + [q for q in unique_queries if q != theme]

            logger.info(f"[QueryExpander] 扩展完成: {len(result)} 个查询")
            return result

        except Exception as e:
            logger.error(f"[QueryExpander] 扩展失败: {e}")
            # 失败时返回原始主题
            return [theme]

    def _parse_json_response(self, content: str) -> List[str]:
        """
        解析 LLM 返回的 JSON 响应

        Args:
            content: LLM 返回的内容

        Returns:
            子问题列表
        """
        # 使用统一的 JSON 解析工具
        result = parse_json_array(content, default=[])

        if result:
            return [str(item) for item in result if item]

        # 尝试按行分割（可能没有 JSON 格式）
        lines = content.strip().split("\n")
        queries = []
        for line in lines:
            # 移除编号前缀（如 "1. ", "- "）
            cleaned = re.sub(r"^[\d\-\.\•\*]+\s*", "", line).strip()
            # 移除引号
            cleaned = cleaned.strip('"\'""''')
            if cleaned and len(cleaned) > 5:
                queries.append(cleaned)

        return queries

    def expand_with_context(
        self,
        theme: str,
        context: Optional[str] = None,
        previous_queries: Optional[List[str]] = None,
    ) -> List[str]:
        """
        带上下文的查询扩展

        当初步搜索结果不理想时，可以基于上下文进行二次扩展。

        Args:
            theme: 原始主题
            context: 上下文信息（如初步搜索结果摘要）
            previous_queries: 之前已使用的查询

        Returns:
            新的子问题列表
        """
        if not context and not previous_queries:
            return self.expand(theme)

        # 构建增强 Prompt
        prompt = f"""用户想要研究主题：「{theme}」"""

        if previous_queries:
            prompt += f"""

已经搜索过的问题：
{chr(10).join(f'- {q}' for q in previous_queries)}"""

        if context:
            prompt += f"""

初步搜索发现的相关内容摘要：
{context[:1000]}"""

        prompt += """

请基于以上信息，生成 2-3 个新的、更具体的子问题，以便深入挖掘。
这些问题应该：
1. 与之前的问题不同
2. 基于初步发现进行深入
3. 填补知识空白

请直接输出 JSON 数组：["子问题1", "子问题2", ...]"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一位研究专家，擅长基于初步发现进行深入探索。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=300,
            )

            content = response.choices[0].message.content or "[]"
            sub_queries = self._parse_json_response(content)

            # 过滤掉已使用的查询
            if previous_queries:
                sub_queries = [
                    q for q in sub_queries if q not in previous_queries
                ]

            return sub_queries[:3]

        except Exception as e:
            logger.error(f"[QueryExpander] 上下文扩展失败: {e}")
            return []
