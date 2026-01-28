# src/deeppdf/agent/prompt_builder.py
"""
PromptBuilder - LLM Tree Search Prompt 构建器

根据候选子树的字段（summary、title、prefix_summary）动态构建 LLM Prompt
"""
import logging
from typing import Any, Dict


logger = logging.getLogger(__name__)


class PromptBuilder:
    """
    Prompt 构建器 - 用于树搜索的 LLM Prompt 构建

    功能:
    - 检测树结构是否包含 summary 字段
    - 统计树节点数量
    - 构建树结构的文本表示
    - 根据是否有 summary 动态生成 Prompt
    """

    def __init__(self) -> None:
        """初始化构建器"""
        self._has_summary: bool | None = None

    def _check_has_summary(self, tree: Dict[str, Any]) -> bool:
        """
        递归检查树结构中是否有 summary 或 prefix_summary 字段

        Args:
            tree: 树结构字典

        Returns:
            是否包含摘要字段
        """

        def check_node(node: Dict[str, Any]) -> bool:
            """递归检查单个节点"""
            # 检查当前节点是否有 summary 或 prefix_summary
            if "summary" in node or "prefix_summary" in node:
                return True

            # 递归检查子节点
            for child in node.get("nodes", []):
                if check_node(child):
                    return True

            return False

        # 检查所有顶级节点
        for node in tree.get("structure", []):
            if check_node(node):
                return True

        return False

    def _count_nodes(self, tree: Dict[str, Any]) -> int:
        """
        统计树节点数量

        Args:
            tree: 树结构字典

        Returns:
            节点总数
        """

        def count_node(node: Dict[str, Any]) -> int:
            """递归统计单个节点的子树"""
            count = 1  # 当前节点
            for child in node.get("nodes", []):
                count += count_node(child)
            return count

        total = 0
        for node in tree.get("structure", []):
            total += count_node(node)

        return total

    def _build_tree_text(self, tree: Dict[str, Any], include_summary: bool) -> str:
        """
        构建树结构的文本表示

        Args:
            tree: 树结构字典
            include_summary: 是否包含摘要内容

        Returns:
            树结构的文本表示
        """

        def format_node(node: Dict[str, Any], level: int = 0) -> list[str]:
            """递归格式化节点"""
            indent = "  " * level
            title = node.get("title", "未命名章节")
            node_id = node.get("node_id", "")

            lines = [f"{indent}- [{node_id}] {title}"]

            # 如果需要包含摘要
            if include_summary:
                # 优先使用 summary，其次 prefix_summary
                summary = node.get("summary") or node.get("prefix_summary")
                if summary:
                    lines.append(f"{indent}  摘要: {summary}")

            # 递归处理子节点
            for child in node.get("nodes", []):
                lines.extend(format_node(child, level + 1))

            return lines

        all_lines: list[str] = []
        for node in tree.get("structure", []):
            all_lines.extend(format_node(node))

        return "\n".join(all_lines)

    def build(self, query: str, tree: Dict[str, Any]) -> str:
        """
        构建 Prompt

        Args:
            query: 用户查询
            tree: 候选子树结构

        Returns:
            完整的 Prompt 字符串
        """
        # 检查是否有 summary（如果未检查过）
        if self._has_summary is None:
            self._has_summary = self._check_has_summary(tree)

        # 统计节点数量
        node_count = self._count_nodes(tree)

        # 构建树结构文本
        tree_text = self._build_tree_text(tree, include_summary=self._has_summary)

        # 根据是否有 summary 选择不同的 Prompt 模板
        if self._has_summary:
            prompt = f"""问题：{query}

文档候选章节（共 {node_count} 个）：
{tree_text}

请分析上述章节，找出最可能包含答案的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
直接返回最终的 JSON 结构，不要输出其他内容。"""
        else:
            prompt = f"""问题：{query}

文档候选章节标题（共 {node_count} 个）：
{tree_text}

请根据章节标题判断相关性，找出可能相关的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
直接返回最终的 JSON 结构，不要输出其他内容。"""

        # 记录日志
        logger.info(
            "[LLM_TREE_SEARCH][PROMPT] 构建完成 - 节点数: %d, 包含摘要: %s",
            node_count,
            self._has_summary,
        )

        return prompt
