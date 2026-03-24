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
        # 步骤 4.5: 处理 Calibre split 文件（关键修复）
        # ============================================================
        # Calibre 会将大文件分割成 part0005_split_000, part0005_split_001, part0005_split_002 等
        # 但 TOC 可能只引用部分文件（如 _000 和 _002），跳过了中间的文件（如 _001）
        # 这个步骤将未引用的 split 文件内容合并到同组已使用的节点中
        self._merge_unused_split_files(structure, chapter_map)

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
        # 清理书名：移除括号内的营销文案（如"（全新版本...）"）
        raw_title = metadata.get("title", "")
        clean_title = self._clean_book_title(raw_title)

        result = {
            "doc_name": clean_title,
            "structure": structure,
        }

        # 添加可选的元数据字段
        if metadata.get("author"):
            result["author"] = metadata["author"]
        if metadata.get("language"):
            result["language"] = metadata["language"]

        return result

    def _merge_unused_split_files(
        self,
        structure: List[Dict[str, Any]],
        chapter_map: Dict[str, Dict[str, str]]
    ) -> None:
        """
        合并未引用的 Calibre split 文件到同组已使用的节点中

        Calibre 会将大文件分割成 part0005_split_000, part0005_split_001, part0005_split_002 等
        但 TOC 可能只引用部分文件（如 _000 和 _002），跳过了中间的文件（如 _001）
        这个方法将未引用的 split 文件内容合并到同组第一个已使用的节点中

        参数:
            structure: 树结构（会被修改）
            chapter_map: 章节文件名到内容的映射
        """
        # 找出所有未使用的 split 文件
        unused_split_files = [
            f for f in chapter_map.keys()
            if f not in self._used_files and '_split_' in f
        ]

        if not unused_split_files:
            return

        # 按 split 组分组
        split_groups: Dict[str, List[str]] = {}
        for f in unused_split_files:
            # 提取基础文件名：text/part0005_split_001 -> text/part0005
            base_name = f.split('_split_')[0]
            if base_name not in split_groups:
                split_groups[base_name] = []
            split_groups[base_name].append(f)

        if not split_groups:
            return

        logger.info(f"[EPUB转换] 发现 {len(unused_split_files)} 个未引用的 split 文件，将合并到同组节点")

        # 为每个 split 组找到对应的已使用节点，并合并内容
        for base_name, unused_files in split_groups.items():
            # 找到同组中已使用的 split 文件
            used_split_files = sorted([
                f for f in self._used_files
                if f.startswith(base_name + '_split_')
            ])

            if not used_split_files:
                # 如果整个 split 组都没有被使用，跳过（会在 _add_unused_chapters 中处理）
                logger.debug(f"[EPUB转换] split 组 '{base_name}' 没有已使用的文件，跳过合并")
                continue

            # 找到引用第一个已使用 split 文件的节点
            first_used_file = used_split_files[0]
            target_node = self._find_node_by_file(structure, first_used_file)

            if not target_node:
                logger.warning(f"[EPUB转换] 未找到引用文件 '{first_used_file}' 的节点")
                continue

            # 将未使用的 split 文件内容按顺序插入到正确位置
            # 目标节点已包含 first_used_file 的内容，我们需要把未使用的文件内容
            # 按正确的顺序插入

            # 首先收集同组所有 split 文件（已使用 + 未使用）
            all_split_files = sorted(set(used_split_files) | set(unused_files))

            # 只合并未使用的文件内容
            merged_content = []
            for split_file in unused_files:
                if split_file in chapter_map:
                    content = chapter_map[split_file].get("content", "")
                    if content.strip():
                        merged_content.append(content)
                    self._used_files.add(split_file)

            if merged_content:
                # 更新目标节点的内容
                # 根据 split 文件的顺序决定插入位置
                first_used_idx = all_split_files.index(first_used_file)

                # 收集在 first_used_file 之前和之后的未使用文件
                before_content = []
                after_content = []
                for split_file in unused_files:
                    if split_file in chapter_map:
                        content = chapter_map[split_file].get("content", "")
                        if content.strip():
                            idx = all_split_files.index(split_file)
                            if idx < first_used_idx:
                                before_content.append(content)
                            else:
                                after_content.append(content)

                original_content = target_node.get("text", "")
                new_parts = []

                # 按顺序组装：之前的内容 + 原内容 + 之后的内容
                if before_content:
                    new_parts.extend(before_content)
                if original_content.strip():
                    new_parts.append(original_content)
                if after_content:
                    new_parts.extend(after_content)

                if new_parts:
                    target_node["text"] = "\n\n".join(new_parts)

                logger.info(f"[EPUB转换] 将 {len(unused_files)} 个未引用的 split 文件合并到节点 '{target_node.get('title', '未知')}'")

    def _find_node_by_file(
        self,
        nodes: List[Dict[str, Any]],
        file_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        在树结构中查找引用指定文件的节点

        参数:
            nodes: 节点列表
            file_name: 要查找的文件名

        返回:
            找到的节点，如果没找到返回 None
        """
        for node in nodes:
            # 检查当前节点的 _source_file 字段
            node_source = node.get("_source_file")
            if node_source:
                # 提取文件名部分（去掉片段标识符）
                node_file = node_source.split('#')[0]
                if node_file == file_name:
                    return node

            # 递归检查子节点
            if node.get("nodes"):
                result = self._find_node_by_file(node["nodes"], file_name)
                if result:
                    return result

        return None

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
        # 步骤3: 检测一级章节是否为容器
        # ============================================================
        # 父节点是容器的情况：
        # 1. 子节点的 href 文件名与父节点相同（如 part0002.html 和 part0002.html#section）
        # 2. 父节点内容很短（< 100 字符）且有子节点（Calibre split 文件的情况）
        # 注意：比较文件名部分（忽略锚点），因为：
        #   - 父节点: text00002.html
        #   - 子节点: text00002.html#chapter6
        #   这两个应该被视为同一文件，父节点是容器
        is_container = False
        flat_children = []
        if children:
            flat_children = self._flatten_children(children)

        if flat_children:
            # 检查所有子节点，只要有一个子节点的文件名与父节点相同，就标记为容器
            parent_file = href.split('#')[0] if href else None
            for child in flat_children:
                child_href = self._extract_href(child)
                if child_href and parent_file:
                    child_file = child_href.split('#')[0]
                    if child_file == parent_file:
                        is_container = True
                        logger.debug(f"[EPUB转换] 一级章节 '{title}' 是容器（文件名 '{parent_file}' 与子节点相同）")
                        break

            # 额外检查：如果父节点内容很短（< 100 字符）且有子节点，也标记为容器
            # 这处理 Calibre split 文件的情况：父节点是 part0004.html（只有标题），实际内容在 part0005_split_*.html
            if not is_container and parent_file and parent_file in chapter_map:
                parent_content = chapter_map[parent_file].get("content", "")
                if len(parent_content.strip()) < 100:
                    is_container = True
                    logger.debug(f"[EPUB转换] 一级章节 '{title}' 是容器（父文件内容很短: {len(parent_content)} 字符）")

        # ============================================================
        # 步骤4: 查找章节内容
        # ============================================================
        content = ""
        start_index = 0
        end_index = 0

        # 如果是容器，不提取内容（内容由子节点提供）
        if href and not is_container:
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
        # 步骤5: 构建节点
        # ============================================================
        node: Dict[str, Any] = {
            "title": title,
            "text": content,
            "start_index": start_index,
            "end_index": end_index,
        }

        # 记录源文件（内部使用，用于 split 文件合并）
        if href and not is_container:
            node["_source_file"] = href.split('#')[0]

        # 标记容器型节点（用于 summary 生成）
        if is_container:
            node["is_container"] = True

        # 分配 node_id
        if assign_node_ids:
            self._node_counter += 1
            node["node_id"] = str(self._node_counter).zfill(4)
            logger.debug(f"[EPUB转换] 分配 node_id: {node['node_id']}")

        # ============================================================
        # 步骤6: 递归处理子节点
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

    def _extract_href(self, item: Any) -> Optional[str]:
        """
        从 TOC 项中提取 href

        参数:
            item: TOC 项，可能是 epub.Link、epub.Section 或元组

        返回:
            href 字符串，如果无法提取则返回 None
        """
        if isinstance(item, (epub.Link, epub.Section)):
            return getattr(item, 'href', None)
        elif isinstance(item, tuple) and len(item) >= 1:
            if isinstance(item[0], (epub.Link, epub.Section)):
                return getattr(item[0], 'href', None)
        return None

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

    def _clean_book_title(self, title: str) -> str:
        """
        清理书名，移除营销文案

        处理规则：
        1. 移除中文全角括号内的内容（如"（全新版本，重磅上市！...）"）
        2. 移除英文半角括号内的内容（如 "(New Edition)"）
        3. 如果括号在书名末尾，直接移除
        4. 如果括号在书名中间（如"书名（副标题）其余"，保留"书名 其余"）
        5. 清理多余的空白

        参数:
            title: 原始书名

        返回:
            清理后的简短书名
        """
        import re

        if not title:
            return title

        original_title = title

        # 移除中文全角括号及其内容
        # 匹配：（任意内容）
        title = re.sub(r'（[^）]*）', '', title)

        # 移除英文半角括号及其内容
        # 匹配：(任意内容)
        title = re.sub(r'\([^)]*\)', '', title)

        # 移除中文方括号及其内容
        # 匹配：[任意内容]
        title = re.sub(r'【[^】]*】', '', title)

        # 清理多余空白
        title = ' '.join(title.split())

        # 如果清理后为空，返回原标题
        if not title.strip():
            logger.warning(f"[EPUB转换] 书名清理后为空，使用原标题: {original_title}")
            return original_title

        # 如果清理后标题变化很大（长度减少超过50%），记录日志
        if len(title) < len(original_title) * 0.5:
            logger.info(f"[EPUB转换] 书名清理: '{original_title}' -> '{title}'")

        return title.strip()

