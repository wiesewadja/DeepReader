# src/deeppdf/agent/tools.py
"""
Agent 工具定义

为 DeepPDFAgent 提供可调用的工具集合
"""
import asyncio
from typing import Protocol, Dict, Any, List, Optional, TypedDict
from pathlib import Path

from deeppdf.services.querier import query_pdf


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


class HybridSearchTool:
    """混合检索工具 - 结合标题匹配、BM25 和向量检索"""

    name: str = "hybrid_search"
    description: str = (
        "快速检索与查询相关的文档片段。"
        "适用于简单事实查询（如'某事发生在哪年'）。"
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 返回结果数，默认5"
    )

    def __init__(self, index_id: str, storage_dir: str):
        """
        初始化工具

        Args:
            index_id: 索引 ID
            storage_dir: 存储目录
        """
        self.index_id = index_id
        self.storage_dir = storage_dir

    def __call__(self, query: str, top_k: int = 5) -> str:
        """
        执行混合检索

        Args:
            query: 搜索查询
            top_k: 返回结果数量

        Returns:
            检索结果的可读文本
        """
        # 验证查询参数
        if not query or not isinstance(query, str):
            return "错误: 查询参数必须是非空字符串"

        # 验证 top_k 参数
        if top_k < 1 or top_k > 50:
            return "错误: top_k 必须在 1-50 之间"

        try:
            # 异步调用 query_pdf - 安全地处理事件循环
            # 由于项目已在 main.py 中应用 nest_asyncio，可以安全运行嵌套循环
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # 已有运行中的循环，nest_asyncio 允许嵌套 run_until_complete
                    result = loop.run_until_complete(query_pdf(
                        query=query,
                        index_id=self.index_id,
                        storage_dir=self.storage_dir,
                        max_results=top_k
                    ))
                else:
                    # 循环存在但未运行，使用 run_until_complete
                    result = loop.run_until_complete(query_pdf(
                        query=query,
                        index_id=self.index_id,
                        storage_dir=self.storage_dir,
                        max_results=top_k
                    ))
            except RuntimeError:
                # 没有循环，使用 asyncio.run 创建新循环
                result = asyncio.run(query_pdf(
                    query=query,
                    index_id=self.index_id,
                    storage_dir=self.storage_dir,
                    max_results=top_k
                ))

            if result.get("status") == "error":
                return f"错误: {result.get('error', '检索失败')}"

            results = result.get("results", [])

            if not results:
                return f"未找到与 '{query}' 相关的内容"

            # 格式化结果
            lines = [f"# 检索结果 (共 {len(results)} 条)\n"]

            for i, item in enumerate(results, 1):
                original_text = item.get("text", "")
                text = original_text[:500]
                if len(original_text) > 500:
                    text += " [...]"

                metadata = item.get("metadata", {})
                section = metadata.get("section", "未知章节")
                score = metadata.get("score", 0)

                lines.append(f"## 结果 {i}: {section}")
                lines.append(f"相关性: {score:.2f}")
                lines.append(f"{text}")
                lines.append("")

            return "\n".join(lines)

        except (ValueError, IOError, OSError, RuntimeError) as e:
            return f"错误: 检索失败 - {str(e)}"
        except Exception:
            return "错误: 检索时发生未知错误"
