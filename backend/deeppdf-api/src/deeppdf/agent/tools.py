# src/deeppdf/agent/tools.py
"""
Agent 工具定义

为 DeepPDFAgent 提供可调用的工具集合
"""
from typing import Protocol, Dict, Any, List, Optional, TypedDict


class Tool(Protocol):
    """工具协议 - 所有工具必须实现此接口"""
    name: str
    description: str

    def __call__(self, **kwargs) -> str:
        """执行工具，返回字符串结果"""
        ...


class ToolResult(TypedDict):
    """工具执行结果"""
    success: bool
    result: str
    error: Optional[str]


class InspectTocTool:
    """目录检查工具 - 返回文档的章节结构"""

    name: str = "inspect_toc"
    description: str = (
        "查看 PDF 文档的目录结构，返回章节标题和页码范围。"
        "适用于需要了解文档整体结构或定位特定章节的场景。"
        "无需任何参数。"
    )

    def __init__(self, tree_structure: Dict[str, Any]):
        """
        初始化工具

        Args:
            tree_structure: PageIndex 生成的树状结构，来自 index_metadata
        """
        self.tree_structure = tree_structure

    def __call__(self, **kwargs) -> str:
        """返回目录结构的可读文本"""
        structure = self.tree_structure.get("structure", [])

        if not structure:
            return "错误: 文档没有目录结构"

        lines = ["# 文档目录结构\n"]

        for node in structure:
            lines.extend(self._format_node(node, level=0))

        return "\n".join(lines)

    def _format_node(self, node: Dict[str, Any], level: int) -> List[str]:
        """递归格式化节点为可读文本"""
        indent = "  " * level
        title = node.get("title", "未命名章节")
        start_page = node.get("start_index", "?")
        end_page = node.get("end_index", "?")
        node_id = node.get("node_id", "")

        lines = [
            f"{indent}- {title} (第 {start_page}-{end_page} 页) [ID: {node_id}]"
        ]

        # 递归处理子节点
        for child in node.get("nodes", []):
            lines.extend(self._format_node(child, level + 1))

        return lines
