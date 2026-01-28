"""
EPUB → PageIndex 树结构转换器模块

本模块提供将 EPUB 解析结果转换为 PageIndex tree_structure 格式的功能。

主要功能:
    - epub_to_tree: 便捷函数，将 EPUB 数据转换为树结构
    - EpubTreeConverter: 树结构转换器类
    - 支持嵌套 TOC 结构解析
    - 支持可选的 node_id 分配
    - 将 EPUB 章节内容映射到树节点

使用示例:
    >>> from pageindex.epub_to_tree import epub_to_tree
    >>>
    >>> # 从 EpubParser 获取数据
    >>> epub_data = {
    ...     "metadata": {"title": "Book", "author": "Author"},
    ...     "toc": [...],
    ...     "chapters": [...]
    ... }
    >>>
    >>> # 转换为树结构
    >>> tree = epub_to_tree(epub_data, assign_node_ids=True)
    >>> print(tree["title"])
    >>> for node in tree["structure"]:
    ...     print(f"{node['node_id']}: {node['title']}")

依赖关系:
    - ebooklib: EPUB TOC 结构处理
    - pageindex.epub_parser: EPUB 解析器

作者: DeepPDF Team
创建时间: 2026-01-28
"""

import logging
from typing import Dict, Any, List, Optional

from ebooklib import epub

logger = logging.getLogger(__name__)


def epub_to_tree(
    epub_data: Dict[str, Any],
    assign_node_ids: bool = True
) -> Dict[str, Any]:
    """
    将 EPUB 数据转换为 PageIndex tree_structure 格式

    这是一个便捷函数，用于快速转换 EPUB 数据。

    参数:
        epub_data: EpubParser 解析结果，包含:
            - metadata: 元数据字典
            - toc: 目录列表
            - chapters: 章节列表
        assign_node_ids: 是否分配 node_id（格式: "0001", "0002"...）

    返回:
        PageIndex tree_structure 格式的字典，包含:
            - title: 书籍标题
            - structure: 树结构列表

    使用示例:
        >>> from pageindex.epub_parser import parse_epub
        >>> from pageindex.epub_to_tree import epub_to_tree
        >>>
        >>> epub_data = parse_epub("book.epub")
        >>> tree = epub_to_tree(epub_data)
        >>> print(f"标题: {tree['title']}")
    """
    converter = EpubTreeConverter()
    return converter.convert(epub_data, assign_node_ids)


class EpubTreeConverter:
    """
    EPUB 树结构转换器类

    将 EPUB 解析数据转换为 PageIndex 的 tree_structure 格式。
    支持嵌套 TOC 结构和可选的 node_id 分配。

    属性:
        _node_counter: 节点 ID 计数器

    使用示例:
        >>> converter = EpubTreeConverter()
        >>> tree = converter.convert(epub_data, assign_node_ids=True)
        >>> print(f"共有 {len(tree['structure'])} 个顶级节点")
    """

    def __init__(self):
        """初始化转换器"""
        self._node_counter = 0

    def convert(
        self,
        epub_data: Dict[str, Any],
        assign_node_ids: bool
    ) -> Dict[str, Any]:
        """
        转换 EPUB 数据为 PageIndex 树结构

        参数:
            epub_data: EPUB 解析数据，包含:
                - metadata: 元数据字典
                - toc: 目录列表（可能是嵌套的）
                - chapters: 章节列表
            assign_node_ids: 是否分配 node_id

        返回:
            PageIndex tree_structure 格式

        转换规则:
            - EPUB Link → 树节点
            - 嵌套 TOC → 节点的 nodes 字段
            - 章节内容 → 节点的 text 字段
            - start_index/end_index → 基于章节顺序估算
        """
        # ============================================================
        # 步骤1: 提取数据
        # ============================================================
        metadata = epub_data.get("metadata", {})
        toc = epub_data.get("toc", [])
        chapters = epub_data.get("chapters", [])

        logger.debug(f"[EPUB转换] 开始转换，TOC 项数: {len(toc)}, 章节数: {len(chapters)}")

        # ============================================================
        # 步骤2: 构建章节映射（file_name → content）
        # ============================================================
        # 使用 file_name 作为键，因为 TOC 中的 href 指向文件名
        chapter_map = {ch["file_name"]: ch for ch in chapters}
        logger.debug(f"[EPUB转换] 章节映射构建完成，共 {len(chapter_map)} 个章节")

        # ============================================================
        # 步骤3: 重置计数器
        # ============================================================
        if assign_node_ids:
            self._node_counter = 0
            logger.debug("[EPUB转换] node_id 计数器已重置")

        # ============================================================
        # 步骤4: 转换 TOC 为树结构
        # ============================================================
        structure = self._toc_to_tree(toc, chapter_map, assign_node_ids)
        logger.debug(f"[EPUB转换] 树结构转换完成，共 {len(structure)} 个顶级节点")

        # ============================================================
        # 步骤5: 返回结果
        # ============================================================
        return {
            "title": metadata.get("title", ""),
            "structure": structure,
        }

    def _toc_to_tree(
        self,
        toc: List[Any],
        chapter_map: Dict[str, Dict[str, str]],
        assign_node_ids: bool
    ) -> List[Dict[str, Any]]:
        """
        将 EPUB TOC 转换为树结构

        参数:
            toc: EPUB TOC 列表（可能是嵌套的）
            chapter_map: 章节文件名到内容的映射
            assign_node_ids: 是否分配 node_id

        返回:
            PageIndex 结构节点列表
        """
        structure = []

        for item in toc:
            node = self._parse_toc_item(item, chapter_map, assign_node_ids)
            if node:
                structure.append(node)

        return structure

    def _parse_toc_item(
        self,
        item: Any,
        chapter_map: Dict[str, Dict[str, str]],
        assign_node_ids: bool
    ) -> Optional[Dict[str, Any]]:
        """
        解析单个 TOC 项

        参数:
            item: TOC 项，可能是:
                - epub.Link（单个章节链接）
                - (epub.Section, [children])（带子章节的章节）
                - (epub.Link, [children])（带子链接的链接）
                - tuple（其他嵌套结构）
            chapter_map: 章节映射
            assign_node_ids: 是否分配 node_id

        返回:
            PageIndex 节点字典，如果无法解析则返回 None
        """
        # ============================================================
        # 步骤1: 提取 Link 和子节点
        # ============================================================
        if isinstance(item, epub.Link):
            # 简单的链接
            link = item
            children = []
        elif isinstance(item, tuple) and len(item) >= 1:
            # 嵌套结构
            if isinstance(item[0], (epub.Link, epub.Section)):
                link = item[0]
                children = item[1:] if len(item) > 1 else []
            else:
                # 不支持的嵌套格式
                logger.warning(f"[EPUB转换] 无法解析的 TOC 项类型: {type(item[0])}")
                return None
        else:
            # 不支持的类型
            logger.warning(f"[EPUB转换] 无法解析的 TOC 项: {type(item)}")
            return None

        # ============================================================
        # 步骤2: 提取标题和 href
        # ============================================================
        title = getattr(link, 'title', None) or getattr(link, 'name', None)
        if not title:
            title = "未命名章节"

        href = getattr(link, 'href', None)

        logger.debug(f"[EPUB转换] 处理章节: {title} (href={href})")

        # ============================================================
        # 步骤3: 查找章节内容
        # ============================================================
        content = ""
        start_index = 0
        end_index = 0

        if href and href in chapter_map:
            chapter = chapter_map[href]
            content = chapter.get("content", "")

            # 估算 start_index 和 end_index
            # EPUB 没有页码概念，使用章节序号
            chapter_keys = list(chapter_map.keys())
            if href in chapter_keys:
                chapter_index = chapter_keys.index(href)
                start_index = chapter_index + 1
                # 估算 end_index（基于内容长度）
                word_count = len(content.split())
                end_index = start_index + max(1, word_count // 1000)

        # ============================================================
        # 步骤4: 构建节点
        # ============================================================
        node: Dict[str, Any] = {
            "title": title,
            "text": content,
            "start_index": start_index,
            "end_index": end_index,
        }

        # 分配 node_id
        if assign_node_ids:
            self._node_counter += 1
            node["node_id"] = str(self._node_counter).zfill(4)
            logger.debug(f"[EPUB转换] 分配 node_id: {node['node_id']}")

        # ============================================================
        # 步骤5: 递归处理子节点
        # ============================================================
        if children:
            node["nodes"] = []

            # 扁平化子节点列表（可能包含嵌套的元组）
            flat_children = self._flatten_children(children)

            for child in flat_children:
                child_node = self._parse_toc_item(
                    child,
                    chapter_map,
                    assign_node_ids
                )
                if child_node:
                    node["nodes"].append(child_node)

            logger.debug(f"[EPUB转换] 节点 '{title}' 有 {len(node['nodes'])} 个子节点")

        return node

    def _flatten_children(self, children: Any) -> List[Any]:
        """
        扁平化子节点列表

        EPUB TOC 的子节点可能是各种嵌套结构，这个函数将其扁平化。

        参数:
            children: 子节点（可能是列表、元组等）

        返回:
            扁平化的子节点列表
        """
        flat_list = []

        if isinstance(children, list):
            for item in children:
                if isinstance(item, (list, tuple)):
                    # 递归扁平化嵌套列表
                    flat_list.extend(self._flatten_children(item))
                else:
                    flat_list.append(item)
        elif isinstance(children, tuple):
            # 元组也扁平化
            flat_list.extend(self._flatten_children(list(children)))
        else:
            # 单个元素
            flat_list.append(children)

        return flat_list
