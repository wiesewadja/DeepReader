"""
PageIndex 节点操作模块

本模块提供树状结构中节点的各种操作功能。

主要功能:
    - 节点遍历: get_nodes (获取所有节点)
    - 叶子节点: get_leaf_nodes (获取叶子节点)
    - 节点判断: is_leaf_node (判断是否为叶子节点)
    - 节点获取: get_last_node (获取最后一个节点)
    - 节点 ID: write_node_id (为节点添加 ID)
    - 文本添加: add_node_text, add_node_text_with_labels

使用示例:
    >>> from pageindex.structure.nodes import (
    ...     get_nodes,
    ...     get_leaf_nodes,
    ...     write_node_id,
    ... )
    >>>
    >>> # 获取所有节点
    >>> all_nodes = get_nodes(tree)
    >>>
    >>> # 获取叶子节点
    >>> leaves = get_leaf_nodes(tree)
    >>>
    >>> # 添加节点 ID
    >>> write_node_id(tree)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import copy
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 节点遍历
# ============================================================

def get_nodes(structure: Any) -> List[Dict[str, Any]]:
    """
    获取树状结构中的所有节点

    使用深度优先遍历，返回所有节点的扁平列表。
    每个节点会移除 nodes 字段。

    参数:
        structure: 树状结构 (dict 或 list)

    返回:
        节点列表

    使用示例:
        >>> nodes = get_nodes(tree)
        >>> for node in nodes:
        ...     print(f"{node.get('structure')} {node.get('title')}")
    """
    if isinstance(structure, dict):
        # 复制节点并移除 nodes 字段
        structure_node = copy.deepcopy(structure)
        structure_node.pop("nodes", None)
        nodes = [structure_node]

        # 递归处理子节点
        for key in list(structure.keys()):
            if "nodes" in key:
                nodes.extend(get_nodes(structure[key]))
        return nodes

    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(get_nodes(item))
        return nodes

    return []


# ============================================================
# 叶子节点
# ============================================================

def get_leaf_nodes(structure: Any) -> List[Dict[str, Any]]:
    """
    获取树状结构中的所有叶子节点

    叶子节点是指没有子节点的节点。

    参数:
        structure: 树状结构 (dict 或 list)

    返回:
        叶子节点列表

    使用示例:
        >>> leaves = get_leaf_nodes(tree)
        >>> print(f"共有 {len(leaves)} 个叶子节点")
        >>> for leaf in leaves:
        ...     print(f"叶子: {leaf.get('title')}")
    """
    if isinstance(structure, dict):
        # 如果没有子节点，是叶子节点
        if not structure.get("nodes"):
            structure_node = copy.deepcopy(structure)
            structure_node.pop("nodes", None)
            return [structure_node]
        else:
            # 有子节点，递归查找叶子节点
            leaf_nodes = []
            for key in list(structure.keys()):
                if "nodes" in key:
                    leaf_nodes.extend(get_leaf_nodes(structure[key]))
            return leaf_nodes

    elif isinstance(structure, list):
        leaf_nodes = []
        for item in structure:
            leaf_nodes.extend(get_leaf_nodes(item))
        return leaf_nodes

    return []


def is_leaf_node(data: Any, node_id: str) -> bool:
    """
    判断指定 node_id 的节点是否为叶子节点

    参数:
        data: 树状结构
        node_id: 节点 ID

    返回:
        如果节点是叶子节点返回 True，否则返回 False

    使用示例:
        >>> if is_leaf_node(tree, "0005"):
        ...     print("节点 0005 是叶子节点")
    """
    def find_node(data: Any, node_id: str) -> Optional[Dict[str, Any]]:
        """递归查找指定节点"""
        if isinstance(data, dict):
            if data.get("node_id") == node_id:
                return data
            for key in data.keys():
                if "nodes" in key:
                    result = find_node(data[key], node_id)
                    if result:
                        return result
        elif isinstance(data, list):
            for item in data:
                result = find_node(item, node_id)
                if result:
                    return result
        return None

    # 查找节点
    node = find_node(data, node_id)

    # 检查是否为叶子节点
    if node and not node.get("nodes"):
        return True
    return False


def get_last_node(structure: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    获取树状结构中的最后一个节点

    按照深度优先遍历的顺序，返回最后访问的节点。

    参数:
        structure: 树状结构列表

    返回:
        最后一个节点

    使用示例:
        >>> last = get_last_node(tree)
        >>> print(f"最后一个节点: {last.get('title')}")
    """
    return structure[-1]


# ============================================================
# 节点 ID
# ============================================================

def write_node_id(data: Any, node_id: int = 0) -> int:
    """
    为树状结构中的所有节点添加 node_id

    node_id 格式为 4 位零填充字符串，例如 "0001", "0002" 等。

    参数:
        data: 树状结构 (dict 或 list)
        node_id: 起始 ID (默认 0)

    返回:
        最后使用的 ID + 1

    使用示例:
        >>> # 从 0 开始编号
        >>> next_id = write_node_id(tree)
        >>>
        >>> # 从指定 ID 开始编号
        >>> next_id = write_node_id(tree, node_id=10)
    """
    if isinstance(data, dict):
        data["node_id"] = str(node_id).zfill(4)
        node_id += 1
        for key in list(data.keys()):
            if "nodes" in key:
                node_id = write_node_id(data[key], node_id)
    elif isinstance(data, list):
        for index in range(len(data)):
            node_id = write_node_id(data[index], node_id)
    return node_id


# ============================================================
# 文本添加
# ============================================================

def add_node_text(node: Any, pdf_pages: List[tuple]) -> None:
    """
    为树状结构中的节点添加 text 字段

    text 字段包含从 start_index 到 end_index 的页面文本。

    容器型节点处理：
    - 如果节点被标记为容器（is_container=True），不提取 text
    - 容器型节点的 summary 应该汇总子章节

    参数:
        node: 树状结构 (dict 或 list)
        pdf_pages: 页面列表，格式为 [(page_text, token_count), ...]

    使用示例:
        >>> add_node_text(tree, pages)
        >>> # 现在每个节点都有 text 字段
        >>> print(tree[0]["text"])
    """
    from ..pdf.parser import get_text_of_pdf_pages

    if isinstance(node, dict):
        start_page = node.get("start_index")
        end_page = node.get("end_index")

        # 容器型节点不提取 text
        if node.get("is_container"):
            node["text"] = ""
        else:
            node["text"] = get_text_of_pdf_pages(pdf_pages, start_page, end_page)

        if "nodes" in node:
            add_node_text(node["nodes"], pdf_pages)

    elif isinstance(node, list):
        for index in range(len(node)):
            add_node_text(node[index], pdf_pages)


def add_node_text_with_labels(node: Any, pdf_pages: List[tuple]) -> None:
    """
    为树状结构中的节点添加带标记的 text 字段

    与 add_node_text 的区别是，这个函数添加物理索引标记。
    例如: "<physical_index_1>\n页面内容\n<physical_index_1>"

    容器型节点处理：
    - 如果节点被标记为容器（is_container=True），不提取 text
    - 容器型节点的 summary 应该汇总子章节

    参数:
        node: 树状结构 (dict 或 list)
        pdf_pages: 页面列表

    使用示例:
        >>> add_node_text_with_labels(tree, pages)
        >>> print(tree[0]["text"])
        >>> # 输出: <physical_index_1>\n页面内容\n<physical_index_1>\n...
    """
    from ..pdf.parser import get_text_of_pdf_pages_with_labels

    if isinstance(node, dict):
        start_page = node.get("start_index")
        end_page = node.get("end_index")

        # 容器型节点不提取 text
        if node.get("is_container"):
            node["text"] = ""
        else:
            node["text"] = get_text_of_pdf_pages_with_labels(
                pdf_pages, start_page, end_page
            )

        if "nodes" in node:
            add_node_text_with_labels(node["nodes"], pdf_pages)

    elif isinstance(node, list):
        for index in range(len(node)):
            add_node_text_with_labels(node[index], pdf_pages)


# ============================================================
# 节点查找
# ============================================================

def find_node_by_id(
    structure: Any,
    node_id: str
) -> Optional[Dict[str, Any]]:
    """
    根据 node_id 查找节点

    参数:
        structure: 树状结构
        node_id: 节点 ID (如 "0001")

    返回:
        找到的节点，如果未找到返回 None

    使用示例:
        >>> node = find_node_by_id(tree, "0005")
        >>> if node:
        ...     print(f"找到: {node.get('title')}")
    """
    if isinstance(structure, dict):
        if structure.get("node_id") == node_id:
            return structure
        for key in structure.keys():
            if "nodes" in key:
                result = find_node_by_id(structure[key], node_id)
                if result:
                    return result
    elif isinstance(structure, list):
        for item in structure:
            result = find_node_by_id(item, node_id)
            if result:
                return result
    return None


def find_node_by_structure(
    structure: Any,
    structure_id: str
) -> Optional[Dict[str, Any]]:
    """
    根据 structure 编号查找节点

    参数:
        structure: 树状结构
        structure_id: 结构编号 (如 "1.1.2")

    返回:
        找到的节点，如果未找到返回 None

    使用示例:
        >>> node = find_node_by_structure(tree, "1.1")
        >>> if node:
        ...     print(f"找到: {node.get('title')}")
    """
    if isinstance(structure, dict):
        if structure.get("structure") == structure_id:
            return structure
        for key in structure.keys():
            if "nodes" in key:
                result = find_node_by_structure(structure[key], structure_id)
                if result:
                    return result
    elif isinstance(structure, list):
        for item in structure:
            result = find_node_by_structure(item, structure_id)
            if result:
                return result
    return None
