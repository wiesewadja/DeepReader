# src/deeppdf/skills/intent_router.py
"""
智能意图路由器

使用 LLM 理解用户意图，从候选 Skills 中选择最合适的 Skill 并提取参数。
采用混合路由策略：关键词预筛选 + LLM 精选
"""

import json
import logging
from typing import Optional, List, Dict, Any, Tuple, TYPE_CHECKING

from .models import Skill, RoutingResult
from .registry import SkillRegistry

if TYPE_CHECKING:
    from openai import OpenAI

logger = logging.getLogger(__name__)


class IntentRouter:
    """
    智能意图路由器

    混合路由策略：
    1. 关键词快速预筛选，获取候选 Skills (top 3)
    2. LLM 分析意图，从候选中选择 + 提取参数

    优点：
    - 减少传递给 LLM 的信息量
    - 降低 LLM 选择难度
    - 保留语义理解能力
    - 支持参数提取
    """

    def __init__(
        self,
        registry: SkillRegistry,
        llm_client: Optional["OpenAI"] = None,
        llm_model: Optional[str] = None,
    ):
        """
        初始化意图路由器

        Args:
            registry: Skill 注册表
            llm_client: OpenAI 兼容的 LLM 客户端（可选）
            llm_model: LLM 模型名称（可选）
        """
        self.registry = registry
        self.llm_client = llm_client
        self.llm_model = llm_model or "deepseek-chat"

    def route(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        use_llm: bool = True,
        current_skill: Optional[Skill] = None,
        switch_threshold: float = 0.3,
    ) -> RoutingResult:
        """
        智能路由到最合适的 Skill

        Args:
            query: 用户查询内容
            context: 额外上下文（如书籍类型、历史对话等）
            use_llm: 是否使用 LLM 进行智能选择（默认 True）
            current_skill: 当前会话正在使用的 Skill（用于粘性策略）
            switch_threshold: 切换 Skill 的置信度阈值差值（默认 0.3）

        Returns:
            RoutingResult 包含匹配的 Skill 和路由信息
        """
        # Step 0: 粘性 Skill 策略 - 如果有当前 Skill，优先保持
        if current_skill:
            # 检查用户是否显式要求切换 Skill
            explicit_switch = self._check_explicit_switch(query, current_skill, context)
            if explicit_switch:
                logger.info(f"[IntentRouter] 用户显式要求切换 Skill")
                # 用户明确要求切换，继续正常路由流程
            else:
                # 快速关键词匹配检查当前 Skill 是否仍然相关
                current_relevance = self._calculate_skill_relevance(query, current_skill)

                # 如果当前 Skill 仍然相关（匹配度 > 0.1），保持不变
                if current_relevance > 0.1:
                    logger.info(
                        f"[IntentRouter] 粘性 Skill: 保持 {current_skill.name} "
                        f"(相关性: {current_relevance:.2f})"
                    )
                    return RoutingResult(
                        skill=current_skill,
                        match_type="sticky",
                        confidence=current_relevance,
                        reason="会话粘性保持",
                    )

        # Step 1: 关键词预筛选，获取候选 Skills
        candidates = self._preselect_by_keywords(query, top_k=3)

        if not candidates:
            # 没有候选，使用默认 Skill
            default_skill = self.registry.get_default()
            if default_skill:
                logger.info("[IntentRouter] 无候选 Skill，使用默认")
                return RoutingResult(
                    skill=default_skill,
                    match_type="default",
                    confidence=0.0,
                )
            # 没有默认 Skill，返回 None，使用主 Agent 默认行为
            logger.info("[IntentRouter] 无默认 Skill，使用主 Agent 默认行为")
            return RoutingResult(
                skill=None,
                match_type="none",
                confidence=0.0,
            )

        if len(candidates) == 1:
            # 只有一个候选，直接返回
            skill, matched_keywords, score = candidates[0]

            # 粘性检查：如果候选 Skill 的置信度不够高，且当前有 Skill，保持当前
            if current_skill and skill.name != current_skill.name:
                if score < switch_threshold:
                    logger.info(
                        f"[IntentRouter] 粘性保持 {current_skill.name}，"
                        f"候选 {skill.name} 置信度不足 ({score:.2f} < {switch_threshold})"
                    )
                    return RoutingResult(
                        skill=current_skill,
                        match_type="sticky",
                        confidence=score,
                        reason=f"候选置信度不足({score:.2f}<{switch_threshold})",
                    )

            logger.info(f"[IntentRouter] 唯一候选: {skill.name}")
            return RoutingResult(
                skill=skill,
                match_type="keyword",
                confidence=score,
                matched_keywords=matched_keywords,
            )

        # Step 2: 多个候选时，尝试 LLM 精选
        if use_llm and self.llm_client:
            result = self._llm_select(query, candidates, context, current_skill, switch_threshold)
            if result:
                return result

        # Step 3: LLM 不可用或失败，回退到最佳关键词匹配
        skill, matched_keywords, score = candidates[0]

        # 粘性检查：回退场景
        if current_skill and skill.name != current_skill.name:
            if score < switch_threshold:
                logger.info(
                    f"[IntentRouter] 粘性保持 {current_skill.name}（回退场景）"
                )
                return RoutingResult(
                    skill=current_skill,
                    match_type="sticky",
                    confidence=score,
                    reason="LLM不可用且候选置信度不足",
                )

        logger.info(f"[IntentRouter] 回退到关键词匹配: {skill.name}")
        return RoutingResult(
            skill=skill,
            match_type="keyword",
            confidence=score,
            matched_keywords=matched_keywords,
        )

    def _calculate_skill_relevance(self, query: str, skill: Skill) -> float:
        """
        计算查询与特定 Skill 的相关性分数

        Args:
            query: 用户查询
            skill: 要检查的 Skill

        Returns:
            相关性分数 (0-1)
        """
        if not skill.keywords:
            return 0.0

        query_lower = query.lower()
        score = 0.0

        for keyword in skill.keywords:
            keyword_lower = keyword.lower()
            if keyword_lower in query_lower:
                keyword_words = keyword.split()
                if len(keyword_words) > 1:
                    score += 2.0
                else:
                    score += 1.0
                score += len(keyword) * 0.01

        # 归一化
        max_possible = len(skill.keywords) * 2.0
        return score / max_possible if max_possible > 0 else 0.0

    def _check_explicit_switch(
        self,
        query: str,
        current_skill: Skill,
        context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        检查用户是否显式要求切换 Skill

        Args:
            query: 用户查询
            current_skill: 当前 Skill
            context: 上下文

        Returns:
            是否显式要求切换
        """
        query_lower = query.lower()

        # 显式切换关键词模式
        switch_patterns = [
            "切换到",
            "换成",
            "改用",
            "使用其他",
            "不要用",
            "换个方式",
            "换个方法",
            "用另一种",
        ]

        for pattern in switch_patterns:
            if pattern in query_lower:
                # 检查是否指向其他 Skill
                for skill in self.registry.list_all():
                    if skill.name != current_skill.name and skill.keywords:
                        for keyword in skill.keywords:
                            if keyword.lower() in query_lower:
                                return True
                return True  # 有切换意图，即使没指定具体 Skill

        # 检查是否明确提及其他 Skill 名称
        for skill in self.registry.list_all():
            if skill.name != current_skill.name:
                if skill.name.lower().replace("-", " ") in query_lower:
                    return True
                # 检查 Skill 的关键词是否作为"使用 XX 方法"的形式出现
                if skill.keywords:
                    for keyword in skill.keywords:
                        # 检查 "使用[关键词]" 或 "用[关键词]" 模式
                        if f"使用{keyword}" in query_lower or f"用{keyword}" in query_lower:
                            return True

        return False

    def _preselect_by_keywords(
        self, query: str, top_k: int = 3
    ) -> List[Tuple[Skill, List[str], float]]:
        """
        关键词预筛选

        使用加权评分筛选出 top_k 个候选 Skills。

        Args:
            query: 用户查询
            top_k: 返回的候选数量

        Returns:
            [(Skill, matched_keywords, score), ...] 按分数降序排列
        """
        query_lower = query.lower()
        candidates = []

        for skill in self.registry.list_all():
            if not skill.keywords:
                continue

            matched = []
            skill_score = 0.0

            for keyword in skill.keywords:
                keyword_lower = keyword.lower()
                if keyword_lower in query_lower:
                    matched.append(keyword)
                    # 加权评分
                    keyword_words = keyword.split()
                    if len(keyword_words) > 1:
                        # 短语匹配，权重 2.0
                        skill_score += 2.0
                    else:
                        # 单词匹配，权重 1.0
                        skill_score += 1.0
                    # 额外奖励：关键词长度
                    skill_score += len(keyword) * 0.01

            if matched:
                # 归一化评分
                max_possible = len(skill.keywords) * 2.0
                normalized_score = skill_score / max_possible if max_possible > 0 else 0.0
                candidates.append((skill, matched, normalized_score))

        # 按分数降序排序，取 top_k
        candidates.sort(key=lambda x: x[2], reverse=True)
        return candidates[:top_k]

    def _llm_select(
        self,
        query: str,
        candidates: List[Tuple[Skill, List[str], float]],
        context: Optional[Dict[str, Any]] = None,
        current_skill: Optional[Skill] = None,
        switch_threshold: float = 0.3,
    ) -> Optional[RoutingResult]:
        """
        使用 LLM 从候选中选择最佳 Skill 并提取参数

        Args:
            query: 用户查询
            candidates: 候选 Skills 列表
            context: 额外上下文
            current_skill: 当前 Skill（用于粘性策略）
            switch_threshold: 切换阈值

        Returns:
            RoutingResult 或 None（如果失败）
        """
        try:
            prompt = self._build_selection_prompt(
                query, candidates, context, current_skill
            )
            response = self._call_llm(prompt)

            if not response:
                return None

            # 解析 LLM 响应
            result = self._parse_llm_response(response, candidates, current_skill, switch_threshold)
            return result

        except Exception as e:
            logger.error(f"[IntentRouter] LLM 选择失败: {e}")
            return None

    def _build_selection_prompt(
        self,
        query: str,
        candidates: List[Tuple[Skill, List[str], float]],
        context: Optional[Dict[str, Any]] = None,
        current_skill: Optional[Skill] = None,
    ) -> str:
        """
        构建 LLM 选择 Prompt

        Args:
            query: 用户查询
            candidates: 候选 Skills
            context: 额外上下文
            current_skill: 当前正在使用的 Skill

        Returns:
            Prompt 字符串
        """
        # 格式化候选 Skills
        candidates_info = []
        for skill, matched_keywords, score in candidates:
            info = f"- **{skill.name}**: {skill.description}"
            if matched_keywords:
                info += f"\n  匹配关键词: {', '.join(matched_keywords)}"
            candidates_info.append(info)

        candidates_text = "\n".join(candidates_info)

        # 构建上下文信息
        context_text = ""
        if context:
            if context.get("book_title"):
                context_text += f"\n当前书籍: {context['book_title']}"
            if context.get("book_type"):
                context_text += f"\n书籍类型: {context['book_type']}"

        # 当前模式信息（用于粘性策略）
        current_text = ""
        if current_skill:
            current_text = f"""
## 当前模式

会话正在使用: **{current_skill.name}** ({current_skill.description})

**重要**: 除非用户明确要求切换，或者新问题与当前模式完全不相关，否则应保持当前模式。
"""

        prompt = f"""你是一个阅读助手路由器。分析用户问题，选择最合适的阅读模式。
{current_text}
## 候选模式

{candidates_text}
{context_text}

## 用户问题

{query}

## 任务

1. 分析用户问题的核心意图
2. 从候选模式中选择最合适的一个（如果当前有模式，优先保持不变）
3. 如果问题中包含特定参数（如阅读层次、关注点等），请提取出来

## 决策原则

- **保持一致性**: 如果当前有正在使用的模式，且用户问题与之相关，应保持当前模式
- **显式切换**: 只有用户明确要求切换（如"用其他方法"、"换成XX"）时才切换
- **上下文连贯**: 避免频繁切换，保持对话上下文连贯

## 输出格式

请返回 JSON（不要包含其他内容）：
{{
    "selected_skill": "skill_name",
    "reason": "选择原因（一句话）",
    "confidence": 0.95,
    "should_switch": true,
    "extracted_params": {{
        // 从问题中提取的参数，根据不同 skill 有不同参数
        // 例如 adler-reading 可能提取: "reading_level": "inspectional"
        // 例如 academic 可能提取: "focus": "methodology"
    }}
}}"""

        return prompt

    def _call_llm(self, prompt: str) -> Optional[str]:
        """
        调用 LLM

        Args:
            prompt: Prompt 字符串

        Returns:
            LLM 响应字符串或 None
        """
        if not self.llm_client:
            return None

        try:
            # OpenAI 兼容接口
            response = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,  # 低温度以获得更确定的选择
                max_tokens=500,
            )
            return response.choices[0].message.content

        except Exception as e:
            logger.error(f"[IntentRouter] LLM 调用失败: {e}")
            return None

    def _parse_llm_response(
        self,
        response: str,
        candidates: List[Tuple[Skill, List[str], float]],
        current_skill: Optional[Skill] = None,
        switch_threshold: float = 0.3,
    ) -> Optional[RoutingResult]:
        """
        解析 LLM 响应

        Args:
            response: LLM 响应字符串
            candidates: 候选 Skills 列表
            current_skill: 当前 Skill（用于粘性策略）
            switch_threshold: 切换阈值

        Returns:
            RoutingResult 或 None
        """
        try:
            # 尝试提取 JSON
            json_str = response.strip()

            # 如果响应包含 markdown 代码块，提取其中的 JSON
            if "```json" in json_str:
                start = json_str.find("```json") + 7
                end = json_str.find("```", start)
                json_str = json_str[start:end].strip()
            elif "```" in json_str:
                start = json_str.find("```") + 3
                end = json_str.find("```", start)
                json_str = json_str[start:end].strip()

            data = json.loads(json_str)

            selected_name = data.get("selected_skill")
            if not selected_name:
                return None

            # 粘性检查：LLM 建议保持当前 Skill
            should_switch = data.get("should_switch", True)
            if current_skill and selected_name == current_skill.name:
                logger.info(
                    f"[IntentRouter] LLM 建议保持: {current_skill.name}, "
                    f"原因: {data.get('reason', 'N/A')}"
                )
                return RoutingResult(
                    skill=current_skill,
                    match_type="llm_sticky",
                    confidence=data.get("confidence", 0.9),
                    reason=data.get("reason"),
                )

            # 粘性检查：LLM 建议切换，但需要验证
            if current_skill and selected_name != current_skill.name:
                # 如果 LLM 明确说不切换，保持当前
                if not should_switch:
                    logger.info(
                        f"[IntentRouter] LLM 建议不切换，保持: {current_skill.name}"
                    )
                    return RoutingResult(
                        skill=current_skill,
                        match_type="llm_sticky",
                        confidence=data.get("confidence", 0.9),
                        reason="LLM建议保持当前模式",
                    )

                # 如果置信度不够高，保持当前
                confidence = data.get("confidence", 0.8)
                if confidence < (1.0 - switch_threshold):
                    logger.info(
                        f"[IntentRouter] LLM 置信度不足({confidence:.2f})，"
                        f"保持当前: {current_skill.name}"
                    )
                    return RoutingResult(
                        skill=current_skill,
                        match_type="llm_sticky",
                        confidence=confidence,
                        reason=f"LLM置信度不足({confidence:.2f})",
                    )

            # 查找选中的 Skill
            for skill, matched_keywords, _ in candidates:
                if skill.name == selected_name:
                    logger.info(
                        f"[IntentRouter] LLM 选择: {skill.name}, "
                        f"原因: {data.get('reason', 'N/A')}"
                    )
                    return RoutingResult(
                        skill=skill,
                        match_type="llm_intent",
                        confidence=data.get("confidence", 0.8),
                        matched_keywords=matched_keywords,
                        extracted_params=data.get("extracted_params"),
                        reason=data.get("reason"),
                    )

            logger.warning(f"[IntentRouter] LLM 选择的 Skill 不在候选中: {selected_name}")
            return None

        except json.JSONDecodeError as e:
            logger.error(f"[IntentRouter] JSON 解析失败: {e}\n响应: {response}")
            return None
        except Exception as e:
            logger.error(f"[IntentRouter] 解析 LLM 响应失败: {e}")
            return None

    def list_skills_for_display(self) -> List[Dict[str, Any]]:
        """
        获取所有 Skills 的显示信息（用于 UI 展示）

        Returns:
            Skills 信息列表
        """
        skills_info = []
        for skill in self.registry.list_all():
            skills_info.append({
                "name": skill.name,
                "description": skill.description,
                "keywords": skill.keywords[:5] if skill.keywords else [],
                "is_builtin": skill.is_builtin,
            })
        return skills_info
