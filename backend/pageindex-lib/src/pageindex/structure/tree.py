"""
PageIndex 树状结构操作模块

本模块提供扁平结构与树状结构之间的转换功能。

主要功能:
    - list_to_tree: 将扁平的目录列表转换为树状结构

算法说明:
    目录列表使用 "structure" 字段表示层级关系，例如:
    - "1" 表示第一级 (根节点)
    - "1.1" 表示第二级 (第一个子节点)
    - "1.1.1" 表示第三级 (孙节点)

    转换算法:
        1. 为每个节点找到其父节点
        2. 将节点添加到父节点的 nodes 列表中
        3. 没有父节点的节点作为根节点

使用示例:
    >>> from pageindex.structure.tree import list_to_tree
    >>>
    >>> flat_list = [
    ...     {"structure": "1", "title": "第一章"},
    ...     {"structure": "1.1", "title": "第一节"},
    ...     {"structure": "1.2", "title": "第二节"},
    ...     {"structure": "2", "title": "第二章"},
    ... ]
    >>> tree = list_to_tree(flat_list)
    >>>
    >>> # 结果:
    >>> # [
    >>> #     {
    >>> #         "structure": "1",
    >>> #         "title": "第一章",
    >>> #         "nodes": [
    >>> #             {"structure": "1.1", "title": "第一节"},
    >>> #             {"structure": "1.2", "title": "第二节"}
    >>> #         ]
    >>> #     },
    >>> #     {"structure": "2", "title": "第二章"}
    >>> # ]

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


def list_to_tree(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    将扁平的目录列表转换为树状结构

    算法流程:
        1. 为每个节点创建对象，初始化空 nodes 列表
        2. 根据结构编号 (如 "1.1") 找到父节点 (如 "1")
        3. 将节点添加到父节点的 nodes 列表中
        4. 没有父节点的节点作为根节点返回

    结构编号规则:
        - 使用点号分隔的层级编号
        - 例如: "1", "1.1", "1.1.1", "2", "2.1" 等
        - 父节点是移除最后一层编号的结果
        - 例如: "1.1.2" 的父节点是 "1.1"

    参数:
        data: 扁平的目录列表，每个项必须包含:
            - structure: 结构编号 (如 "1.1")
            - title: 标题
            - start_index: 起始页码
            - end_index: 结束页码

    返回:
        树状结构列表，每个节点包含:
            - 原有的所有字段
            - nodes: 子节点列表 (如果有)

    异常:
        无显式异常，如果数据格式不正确可能导致结构不完整

    使用示例:
        >>> flat = [
        ...     {"structure": "1", "title": "第一章", "start_index": 1, "end_index": 5},
        ...     {"structure": "1.1", "title": "第一节", "start_index": 1, "end_index": 3},
        ...     {"structure": "2", "title": "第二章", "start_index": 6, "end_index": 10},
        ... ]
        >>> tree = list_to_tree(flat)
        >>> print(tree[0]["title"])  # "第一章"
        >>> print(tree[0]["nodes"][0]["title"])  # "第一节"
    """
    # ============================================================
    # 辅助函数: 获取父节点的结构编号
    # ============================================================
    def get_parent_structure(structure: str) -> Optional[str]:
        """
        获取父节点的结构编号

        例如:
            "1.1" → "1"
            "1.1.2" → "1.1"
            "1" → None (根节点)
        """
        if not structure:
            return None
        parts = str(structure).split(".")
        return ".".join(parts[:-1]) if len(parts) > 1 else None

    # ============================================================
    # 步骤1: 创建所有节点并初始化 nodes 列表
    # ============================================================
    nodes = {}
    root_nodes = []

    for item in data:
        # 提取结构编号
        structure = item.get("structure")

        node = {
            "title": item.get("title"),
            "start_index": item.get("start_index"),
            "end_index": item.get("end_index"),
            "nodes": [],
        }

        # 如果有其他字段，也添加到节点中
        for key, value in item.items():
            if key not in node:
                node[key] = value

        nodes[structure] = node

        # ============================================================
        # 步骤2: 找到父节点并添加为子节点
        # ============================================================
        parent_structure = get_parent_structure(structure)

        if parent_structure:
            # 有父节点，添加到父节点的 nodes 列表
            if parent_structure in nodes:
                nodes[parent_structure]["nodes"].append(node)
            else:
                # 父节点尚未创建，暂时作为根节点
                # (这种情况在数据有序时不会发生)
                root_nodes.append(node)
        else:
            # 没有父节点，作为根节点
            root_nodes.append(node)

    # ============================================================
    # 步骤3: 清理空的 nodes 列表
    # ============================================================
    def clean_node(node: Dict[str, Any]) -> Dict[str, Any]:
        """递归清理空的 nodes 列表"""
        if not node["nodes"]:
            # 删除空的 nodes 列表
            node.pop("nodes", None)
        else:
            # 递归清理子节点
            for child in node.get("nodes", []):
                clean_node(child)
        return node

    # 清理并返回
    return [clean_node(node) for node in root_nodes]


def tree_to_list(tree: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    将树状结构转换为扁平列表

    这是 list_to_tree 的逆向操作，使用深度优先遍历。

    参数:
        tree: 树状结构列表

    返回:
        扁平的目录列表

    使用示例:
        >>> flat = tree_to_list(tree)
        >>> for item in flat:
        ...     print(f"{item['structure']} {item['title']}")
    """
    result = []

    def traverse(node, path=""):
        """递归遍历树"""
        # 复制节点 (移除 nodes 字段)
        item = {k: v for k, v in node.items() if k != "nodes"}
        result.append(item)

        # 递归处理子节点
        for child in node.get("nodes", []):
            traverse(child, path + item.get("structure", "") + ".")

    for root in tree:
        traverse(root)

    return result


def get_tree_depth(tree: List[Dict[str, Any]]) -> int:
    """
    获取树的深度

    参数:
        tree: 树状结构列表

    返回:
        树的最大深度 (根节点为 1)

    使用示例:
        >>> depth = get_tree_depth(tree)
        >>> print(f"树深度: {depth}")
    """
    def get_node_depth(node: Dict[str, Any], current_depth: int = 1) -> int:
        """递归获取节点深度"""
        max_child_depth = current_depth
        for child in node.get("nodes", []):
            child_depth = get_node_depth(child, current_depth + 1)
            max_child_depth = max(max_child_depth, child_depth)
        return max_child_depth

    if not tree:
        return 0

    max_depth = 0
    for root in tree:
        root_depth = get_node_depth(root)
        max_depth = max(max_depth, root_depth)

    return max_depth


def get_node_count(tree: List[Dict[str, Any]]) -> int:
    """
    获取树中节点的总数

    参数:
        tree: 树状结构列表

    返回:
        节点总数

    使用示例:
        >>> count = get_node_count(tree)
        >>> print(f"节点数: {count}")
    """
    def count_nodes(node: Dict[str, Any]) -> int:
        """递归计数节点"""
        count = 1  # 当前节点
        for child in node.get("nodes", []):
            count += count_nodes(child)
        return count

    total = 0
    for root in tree:
        total += count_nodes(root)

    return total


def find_node_by_title(
    tree: List[Dict[str, Any]],
    title: str,
    fuzzy_match: bool = False
) -> Optional[Dict[str, Any]]:
    """
    根据标题查找节点

    参数:
        tree: 树状结构列表
        title: 要查找的标题
        fuzzy_match: 是否使用模糊匹配 (包含即可)

    返回:
        找到的节点，如果未找到返回 None

    使用示例:
        >>> node = find_node_by_title(tree, "第一章")
        >>> if node:
        ...     print(f"找到: {node['title']}")
    """
    def search_node(node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """递归搜索节点"""
        # 检查当前节点
        node_title = node.get("title", "")
        if fuzzy_match:
            if title.lower() in node_title.lower():
                return node
        else:
            if title == node_title:
                return node

        # 递归搜索子节点
        for child in node.get("nodes", []):
            result = search_node(child)
            if result:
                return result

        return None

    for root in tree:
        result = search_node(root)
        if result:
            return result

    return None
