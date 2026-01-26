"""
导出功能辅助函数
"""

import pypdf
from typing import Dict, Optional


def get_pdf_page_count(pdf_path: str) -> int:
    """
    获取 PDF 总页数

    Args:
        pdf_path: PDF 文件路径

    Returns:
        PDF 总页数，如果文件不存在返回 0
    """
    try:
        reader = pypdf.PdfReader(pdf_path)
        return len(reader.pages)
    except (FileNotFoundError, Exception):
        return 0


def build_parent_mapping(tree_structure: list) -> Dict[str, Optional[str]]:
    """
    从树状结构构建 node_id → parent_id 的映射

    Args:
        tree_structure: tree_structure 中的 structure 列表

    Returns:
        {node_id: parent_id} 的字典，根节点的 parent_id 为 None

    Example:
        >>> tree = [{"node_id": "root", "nodes": [...]}]
        >>> mapping = build_parent_mapping(tree)
        >>> print(mapping)
        {"root": None, "child1": "root"}
    """
    parent_mapping: Dict[str, Optional[str]] = {}

    def traverse(nodes: list, parent_id: Optional[str] = None) -> None:
        """递归遍历树结构，记录父子关系"""
        for node in nodes:
            node_id = node.get("node_id")
            if node_id:
                parent_mapping[node_id] = parent_id

            # 递归处理子节点
            children = node.get("nodes", [])
            if children:
                traverse(children, node_id)

    traverse(tree_structure)
    return parent_mapping


def find_parent_id(node_id: str, tree_structure: list) -> Optional[str]:
    """
    查找节点的父节点 ID

    Args:
        node_id: 当前节点 ID
        tree_structure: tree_structure 中的 structure 列表

    Returns:
        父节点 ID，如果不存在（根节点）返回 None
    """
    parent_mapping = build_parent_mapping(tree_structure)
    return parent_mapping.get(node_id)


def format_created_at(created_at: str) -> str:
    """
    将 created_at 格式化为 ISO 8601 格式

    Args:
        created_at: 原始格式 "YYYY-MM-DD HH:MM:SS"

    Returns:
        ISO 8601 格式 "YYYY-MM-DDTHH:MM:SS"
    """
    # 简单处理：将空格替换为 T
    return created_at.replace(" ", "T") + "Z"
