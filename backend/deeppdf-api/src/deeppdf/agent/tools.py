# src/deeppdf/agent/tools.py
"""
Agent 工具定义

为 DeepPDFAgent 提供可调用的工具集合
"""
from typing import Protocol, Dict, Any, List, Optional, TypedDict
from pathlib import Path


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


class ReadPageTool:
    """按页读取工具 - 从指定页码读取 PDF 内容"""

    name: str = "read_page"
    description: str = (
        "读取 PDF 指定页码的完整内容，返回带段落标记的原始文本。"
        "适用于需要精确引用或深入分析特定页面的场景。"
        "参数: page_num (int, 必需) - 要读取的页码（从1开始）"
    )

    def __init__(self, pageindex_lib_path: str, index_id: str, storage_dir: str):
        """
        初始化工具

        Args:
            pageindex_lib_path: PageIndex 库的路径
            index_id: 索引 ID
            storage_dir: 存储目录
        """
        self.pageindex_lib_path = pageindex_lib_path
        self.index_id = index_id
        self.storage_dir = storage_dir
        self._pi = None  # 延迟加载

    def _load_page_index(self):
        """延迟加载 PageIndex 实例"""
        if self._pi is None:
            import sys
            sys.path.insert(0, self.pageindex_lib_path)

            from pageindex import PageIndex  # type: ignore

            md_path = Path(self.storage_dir) / "indexes" / f"{self.index_id}.md"
            self._pi = PageIndex.from_file(str(md_path))

        return self._pi

    def __call__(self, page_num: int, **kwargs: Any) -> str:
        """
        读取指定页码的内容

        Args:
            page_num: 页码（从 1 开始）
            **kwargs: 其他参数（兼容性保留）

        Returns:
            页面文本内容，带段落标记
        """
        try:
            pi = self._load_page_index()

            # 验证页码范围
            if page_num < 1 or page_num > pi.page_count:
                return f"错误: 页码 {page_num} 超出范围（文档共 {pi.page_count} 页）"

            # 获取页面文本
            text = pi.get_text_with_tags(page_num)

            return f"# 第 {page_num} 页内容\n\n{text}"

        except (FileNotFoundError, ValueError, IOError, OSError) as e:
            return f"错误: 读取页面失败 - {str(e)}"
        except Exception:
            return "错误: 读取页面时发生未知错误"
