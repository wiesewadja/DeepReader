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
            - doc_name: 书籍标题（与 PDF 格式一致）
            - structure: 树结构列表

    使用示例:
        >>> from pageindex.epub_parser import parse_epub
        >>> from pageindex.epub_to_tree import epub_to_tree
        >>>
        >>> epub_data = parse_epub("book.epub")
        >>> tree = epub_to_tree(epub_data)
        >>> print(f"标题: {tree['doc_name']}")
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
            PageIndex tree_structure 格式，包含:
                - doc_name: 书籍标题（与 PDF 格式一致）
                - structure: 树结构列表

        转换规则:
            - EPUB Link → 树节点
            - 嵌套 TOC → 节点的 nodes 字段
            - 章节内容 → 节点的 text 字段
            - start_index/end_index → 基于章节顺序估算
            - 未在 TOC 中的章节 → 追加到对应父节点或创建新节点
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
        # 步骤4: 转换 TOC 为树结构，并收集已使用的文件
        # ============================================================
        self._used_files: set = set()  # 跟踪已被 TOC 引用的文件
        structure = self._toc_to_tree(toc, chapter_map, assign_node_ids)
        logger.debug(f"[EPUB转换] 树结构转换完成，共 {len(structure)} 个顶级节点")

        # ============================================================
        # 步骤5: 添加未在 TOC 中但实际存在的章节
        # ============================================================
        unused_chapters = [
            ch for ch in chapters
            if ch["file_name"] not in self._used_files
        ]

        if unused_chapters:
            logger.info(f"[EPUB转换] 发现 {len(unused_chapters)} 个未在 TOC 中的章节，将添加到树结构")
            self._add_unused_chapters(structure, unused_chapters, chapter_map, assign_node_ids)

        # ============================================================
        # 步骤6: 重新编号 node_id（确保连续）
        # ============================================================
        if assign_node_ids:
            self._renumber_node_ids(structure)

        # ============================================================
        # 步骤7: 返回结果
        # ============================================================
        # 返回与 PDF 一致的结构格式，同时保留 EPUB 特有的元数据
        # PDF 返回: {"doc_name": "xxx.pdf", "structure": [...]}
        # EPUB 返回: {"doc_name": "书名", "author": "作者", "structure": [...]}
        result = {
            "doc_name": metadata.get("title", ""),
            "structure": structure,
        }

        # 添加可选的元数据字段
        if metadata.get("author"):
            result["author"] = metadata["author"]
        if metadata.get("language"):
            result["language"] = metadata["language"]

        return result

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
        elif isinstance(item, epub.Section):
            # Section 作为单独项（没有子节点的 Section）
            link = item
            children = []
        elif isinstance(item, tuple) and len(item) >= 1:
            # 嵌套结构
            if isinstance(item[0], (epub.Link, epub.Section)):
                link = item[0]
                # 子节点可能是 list 或 tuple
                children = []
                if len(item) > 1:
                    for child in item[1:]:
                        if isinstance(child, list):
                            children.extend(child)
                        else:
                            children.append(child)
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

        # Section 可能没有 href，只有 title
        href = getattr(link, 'href', None)

        # 如果是 Section，尝试从其属性中获取 href
        if href is None and isinstance(link, epub.Section):
            # Section 有时 href 在子节点中
            href = getattr(link, 'href', None)

        logger.debug(f"[EPUB转换] 处理章节: {title} (href={href})")

        # ============================================================
        # 步骤3: 查找章节内容
        # ============================================================
        content = ""
        start_index = 0
        end_index = 0

        if href:
            # 去除锚点部分（如 #内文），只保留文件名
            # href 可能是 "text00002.html#内文" 或 "text00002.html"
            file_name = href.split('#')[0]

            # 记录此文件已被使用
            self._used_files.add(file_name)

            if file_name in chapter_map:
                chapter = chapter_map[file_name]
                content = chapter.get("content", "")

                # 估算 start_index 和 end_index
                # EPUB 没有页码概念，使用章节序号
                chapter_keys = list(chapter_map.keys())
                if file_name in chapter_keys:
                    chapter_index = chapter_keys.index(file_name)
                    start_index = chapter_index + 1
                    # 估算 end_index（基于内容长度）
                    word_count = len(content.split())
                    end_index = start_index + max(1, word_count // 1000)
            else:
                logger.debug(f"[EPUB转换] 未找到章节文件: {file_name}")

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

    def _add_unused_chapters(
        self,
        structure: List[Dict[str, Any]],
        unused_chapters: List[Dict[str, str]],
        chapter_map: Dict[str, Dict[str, str]],
        assign_node_ids: bool
    ) -> None:
        """
        将未在 TOC 中但实际存在的章节添加到树结构

        这些章节通常是 EPUB 的实际内容文件，但由于 TOC 结构简化，
        没有被单独列出。我们将它们添加为顶级节点或附加节点。

        参数:
            structure: 当前树结构（会被修改）
            unused_chapters: 未使用的章节列表
            chapter_map: 章节文件名到内容的映射
            assign_node_ids: 是否分配 node_id
        """
        # 按文件名排序，保持原始顺序
        all_file_names = list(chapter_map.keys())

        # 跟踪已添加的标题，避免重复
        added_titles: set = set()

        added_count = 0
        for chapter in unused_chapters:
            file_name = chapter["file_name"]
            content = chapter.get("content", "")

            # 跳过空内容或太短的内容（可能是封面、空白页等）
            # 提高阈值到 200 字符，避免添加碎片内容
            if len(content.strip()) < 200:
                logger.debug(f"[EPUB转换] 跳过短内容章节: {file_name}")
                continue

            # 跳过导航文件和特殊文件
            if any(skip in file_name.lower() for skip in ['nav', 'toc', 'cover']):
                logger.debug(f"[EPUB转换] 跳过导航/封面文件: {file_name}")
                continue

            # 提取标题
            title = chapter.get("title", file_name)

            # 跳过重复标题或太短的标题
            # 如果标题已经在 TOC 中出现过，或者标题太短（小于 5 个字符），跳过
            if title in added_titles or len(title) < 5:
                logger.debug(f"[EPUB转换] 跳过重复/短标题章节: {title} ({file_name})")
                continue

            # 跳过看起来像文件名的标题（如 "Text/01_13"）
            if title.startswith("Text/") or title.replace("_", "").replace("-", "").replace("/", "").isdigit():
                # 尝试从内容中提取更有意义的标题
                # 取前 30 个字符作为摘要
                preview = content.strip()[:30]
                if len(preview) > 20:
                    title = f"{preview}..."
                else:
                    logger.debug(f"[EPUB转换] 跳过文件名式标题: {title}")
                    continue

            # 记录已添加的标题
            added_titles.add(title)

            # 估算索引
            if file_name in all_file_names:
                chapter_index = all_file_names.index(file_name)
                start_index = chapter_index + 1
            else:
                start_index = len(structure) + 1

            word_count = len(content.split())
            end_index = start_index + max(1, word_count // 1000)

            # 创建节点
            node: Dict[str, Any] = {
                "title": title,
                "text": content,
                "start_index": start_index,
                "end_index": end_index,
            }

            if assign_node_ids:
                self._node_counter += 1
                node["node_id"] = str(self._node_counter).zfill(4)

            # 添加到树结构
            structure.append(node)
            added_count += 1
            logger.debug(f"[EPUB转换] 添加未在 TOC 中的章节: {title} ({file_name})")

        logger.info(f"[EPUB转换] 共添加 {added_count} 个额外章节")

    def _renumber_node_ids(self, structure: List[Dict[str, Any]]) -> None:
        """
        重新编号所有节点的 node_id（确保连续）

        参数:
            structure: 树结构（会被修改）
        """
        counter = 0

        def renumber_node(node: Dict[str, Any]) -> None:
            nonlocal counter
            counter += 1
            node["node_id"] = str(counter).zfill(4)

            # 递归处理子节点
            if "nodes" in node:
                for child in node["nodes"]:
                    renumber_node(child)

        for node in structure:
            renumber_node(node)

        logger.debug(f"[EPUB转换] 重新编号完成，共 {counter} 个节点")
