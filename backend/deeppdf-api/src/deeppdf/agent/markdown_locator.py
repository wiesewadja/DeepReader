# src/deeppdf/agent/markdown_locator.py
"""
Markdown 定位器 - 查询 node_id 到 Markdown 文件的映射
"""

from typing import Any, Dict, Optional


class MarkdownLocator:
    """Markdown 定位器 - 查询 node_id 到 Markdown 文件的映射"""

    def __init__(self, index_metadata: Dict[str, Any]):
        """
        初始化定位器

        Args:
            index_metadata: 索引元数据，包含 markdown_files 映射和 pdf_name
        """
        self.markdown_files = index_metadata.get("markdown_files", {})
        pdf_name = index_metadata.get("pdf_name", "Unknown")
        # 如果 pdf_name 为空字符串，使用默认值 "Unknown"
        self.pdf_name = pdf_name if pdf_name else "Unknown"

        # 调试日志
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[MarkdownLocator] 初始化完成，包含 {len(self.markdown_files)} 个文件映射")
        if len(self.markdown_files) > 0:
            # 显示前3个映射作为示例
            sample_items = list(self.markdown_files.items())[:3]
            for node_id, md_path in sample_items:
                logger.info(f"[MarkdownLocator]   {node_id} -> {md_path}")

    def find_file(self, node_id: str) -> Optional[str]:
        """
        查找 node_id 对应的 Markdown 文件路径

        Args:
            node_id: 节点 ID

        Returns:
            Markdown 文件路径，如果未找到则返回 None
        """
        return self.markdown_files.get(node_id)

    def generate_obsidian_link(
        self, node_id: str, page_num: Optional[int] = None
    ) -> str:
        """
        生成 Obsidian wiki link

        Args:
            node_id: 节点 ID
            page_num: 页码（可选）

        Returns:
            Obsidian 链接格式: [[file.md#^page-N]] 或 [[file.md]]
        """
        markdown_file = self.find_file(node_id)
        if not markdown_file:
            return f"[[{self.pdf_name}]]"
        if page_num is not None:
            return f"[[{markdown_file}#^page-{page_num}]]"
        else:
            return f"[[{markdown_file}]]"

    def generate_citation_metadata(
        self, node_id: str, page_num: Optional[int], text: str
    ) -> Dict[str, Any]:
        """
        生成完整的引用元数据

        Args:
            node_id: 节点 ID
            page_num: 页码（可选）
            text: 引用的文本内容

        Returns:
            {
                "node_id": str,
                "obsidian_link": str,
                "page": Optional[int],
                "anchor": str,  # "^page-N" 格式
                "text": str
            }
        """
        anchor = f"^page-{page_num}" if page_num is not None else ""

        return {
            "node_id": node_id,
            "obsidian_link": self.generate_obsidian_link(node_id, page_num),
            "page": page_num,
            "anchor": anchor,
            "text": text,
        }
