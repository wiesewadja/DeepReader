"""
PageIndex 结构转换模块

本模块提供树状结构和扁平列表之间的相互转换功能。

主要功能:
    - structure_to_list: 将树状结构转换为扁平列表

与 tree.py 的区别:
    - tree.py: 主要处理扁平列表 → 树的转换
    - converter.py: 主要处理树 → 扁平列表的转换

使用示例:
    >>> from pageindex.structure.converter import structure_to_list
    >>>
    >>> # 树转扁平列表
    >>> flat = structure_to_list(tree)
    >>> for item in flat:
    ...     print(f"{item.get('structure')} {item.get('title')}")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def structure_to_list(structure: Any) -> List[Dict[str, Any]]:
    """
    将树状结构转换为扁平列表

    使用深度优先遍历，将嵌套的树结构展平为列表。
    保留所有原始字段，只移除 nodes 字段。

    参数:
        structure: 树状结构 (dict 或 list)

    返回:
        扁平的节点列表

    遍历顺序:
        深度优先，先访问父节点，再访问子节点

    使用示例:
        >>> tree = [
        ...     {
        ...         "structure": "1",
        ...         "title": "第一章",
        ...         "nodes": [
        ...             {"structure": "1.1", "title": "第一节"}
        ...         ]
        ...     }
        ... ]
        >>> flat = structure_to_list(tree)
        >>> print(flat[0]["title"])  # "第一章"
        >>> print(flat[1]["title"])  # "第一节"
    """
    if isinstance(structure, dict):
        # 复制当前节点
        nodes = [structure]
        # 如果有子节点，递归添加
        if "nodes" in structure:
            nodes.extend(structure_to_list(structure["nodes"]))
        return nodes

    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(structure_to_list(item))
        return nodes

    return []


def list_to_tree_with_depth(
    data: List[Dict[str, Any]],
    depth_key: str = "depth"
) -> List[Dict[str, Any]]:
    """
    使用深度字段将扁平列表转换为树状结构

    与 list_to_tree 的区别是，这个函数使用 depth 字段
    而不是 structure 字段来确定层级关系。

    参数:
        data: 扁平的节点列表，每个节点必须包含 depth 字段
        depth_key: 深度字段名称 (默认 "depth")

    返回:
        树状结构列表

    使用示例:
        >>> flat = [
        ...     {"title": "第一章", "depth": 1},
        ...     {"title": "第一节", "depth": 2},
        ...     {"title": "第二节", "depth": 2},
        ... ]
        >>> tree = list_to_tree_with_depth(flat)
    """
    if not data:
        return []

    def build_tree(items: List[Dict[str, Any]], current_depth: int = 0) -> List[Dict[str, Any]]:
        """递归构建树"""
        result = []
        i = 0
        while i < len(items):
            item = items[i]
            item_depth = item.get(depth_key, 0)

            if item_depth == current_depth:
                # 当前深度的节点
                node = item.copy()
                # 查找子节点
                j = i + 1
                while j < len(items) and items[j].get(depth_key, 0) > current_depth:
                    j += 1
                if j > i + 1:
                    node["nodes"] = build_tree(items[i + 1:j], current_depth + 1)
                    i = j - 1
                result.append(node)
            elif item_depth > current_depth:
                # 子节点，继续处理
                pass
            i += 1
        return result

    return build_tree(data, 1)


def flatten_tree_to_paths(
    structure: Any,
    parent_path: str = ""
) -> List[Dict[str, Any]]:
    """
    将树状结构展平为路径列表

    每个节点会包含一个 path 字段，表示从根到该节点的完整路径。

    参数:
        structure: 树状结构
        parent_path: 父路径 (用于递归)

    返回:
        包含 path 字段的节点列表

    使用示例:
        >>> paths = flatten_tree_to_paths(tree)
        >>> for item in paths:
        ...     print(f"{item['path']}: {item['title']}")
        >>> # 输出: "1: 第一章"
        >>> #       "1.1: 第一章 > 第一节"
    """
    if isinstance(structure, dict):
        # 构建当前路径
        current_structure = structure.get("structure", "")
        if parent_path:
            path = f"{parent_path} > {structure.get('title', '')}"
        else:
            path = structure.get("title", "")

        # 复制节点并添加路径
        node = structure.copy()
        node["path"] = path
        nodes = [node]

        # 递归处理子节点
        if "nodes" in structure:
            for child in structure["nodes"]:
                nodes.extend(flatten_tree_to_paths(child, path))

        return nodes

    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(flatten_tree_to_paths(item, parent_path))
        return nodes

    return []


def count_tree_levels(structure: Any) -> int:
    """
    计算树的层数

    参数:
        structure: 树状结构

    返回:
        树的层数 (根节点为第 1 层)

    使用示例:
        >>> levels = count_tree_levels(tree)
        >>> print(f"树有 {levels} 层")
    """
    if isinstance(structure, dict):
        if not structure.get("nodes"):
            return 1
        max_child_level = 0
        for child in structure["nodes"]:
            child_level = count_tree_levels(child)
            max_child_level = max(max_child_level, child_level)
        return max_child_level + 1

    elif isinstance(structure, list):
        max_level = 0
        for item in structure:
            item_level = count_tree_levels(item)
            max_level = max(max_level, item_level)
        return max_level

    return 0


def get_tree_statistics(structure: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    获取树的统计信息

    参数:
        structure: 树状结构列表

    返回:
        包含以下键的字典:
            - total_nodes: 总节点数
            - max_depth: 最大深度
            - leaf_nodes: 叶子节点数
            - branch_nodes: 分支节点数 (有子节点的节点)

    使用示例:
        >>> stats = get_tree_statistics(tree)
        >>> print(f"总节点数: {stats['total_nodes']}")
        >>> print(f"最大深度: {stats['max_depth']}")
    """
    def count_nodes(node: Dict[str, Any]) -> tuple[int, int, int]:
        """
        递归统计节点

        返回: (总数, 叶子数, 分支数)
        """
        has_children = bool(node.get("nodes"))
        total = 1
        leaf_count = 0 if has_children else 1
        branch_count = 1 if has_children else 0

        if has_children:
            for child in node["nodes"]:
                child_total, child_leaf, child_branch = count_nodes(child)
                total += child_total
                leaf_count += child_leaf
                branch_count += child_branch

        return total, leaf_count, branch_count

    total_nodes = 0
    leaf_nodes = 0
    branch_nodes = 0
    max_depth = 0

    for root in structure:
        root_total, root_leaf, root_branch = count_nodes(root)
        total_nodes += root_total
        leaf_nodes += root_leaf
        branch_nodes += root_branch
        root_depth = count_tree_levels(root)
        max_depth = max(max_depth, root_depth)

    return {
        "total_nodes": total_nodes,
        "max_depth": max_depth,
        "leaf_nodes": leaf_nodes,
        "branch_nodes": branch_nodes,
    }
