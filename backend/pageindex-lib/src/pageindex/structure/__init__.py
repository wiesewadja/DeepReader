"""
PageIndex 结构处理模块

本模块提供树状结构操作功能，包括扁平结构与树结构的相互转换。

主要组件:
    - tree: 树状结构操作 (list_to_tree, structure_to_list)
    - nodes: 节点操作 (get_nodes, get_leaf_nodes, add_node_text)
    - converter: 结构转换 (扁平 ↔ 树)

使用示例:
    >>> from pageindex.structure import (
    ...     list_to_tree,
    ...     structure_to_list,
    ...     get_leaf_nodes,
    ... )
    >>>
    >>> # 扁平列表转树
    >>> flat = [
    ...     {"structure": "1", "title": "第一章"},
    ...     {"structure": "1.1", "title": "第一节"},
    ... ]
    >>> tree = list_to_tree(flat)
    >>>
    >>> # 树转扁平列表
    >>> flat = structure_to_list(tree)
    >>>
    >>> # 获取叶子节点
    >>> leaves = get_leaf_nodes(tree)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .tree import list_to_tree
from .nodes import (
    get_nodes,
    get_leaf_nodes,
    is_leaf_node,
    get_last_node,
    write_node_id,
    add_node_text,
    add_node_text_with_labels,
)
from .converter import structure_to_list

__all__ = [
    # 树操作
    "list_to_tree",
    # 节点操作
    "get_nodes",
    "get_leaf_nodes",
    "is_leaf_node",
    "get_last_node",
    "write_node_id",
    "add_node_text",
    "add_node_text_with_labels",
    # 结构转换
    "structure_to_list",
]
