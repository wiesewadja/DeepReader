# src/deeppdf/agent/tools.py
"""
Agent 工具定义

为 DeepPDFAgent 提供可调用的工具集合
"""

import asyncio
import hashlib
import json
import logging
from typing import Protocol, Dict, Any, List, Optional, TypedDict
from pathlib import Path

from deeppdf.services.querier import query_pdf
from deeppdf.agent.markdown_locator import MarkdownLocator

logger = logging.getLogger(__name__)


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
        self._cache: Optional[str] = None  # 添加缓存

    def __call__(self, **kwargs) -> str:
        """返回目录结构的可读文本（带缓存）"""
        # 如果已有缓存，直接返回
        if self._cache is not None:
            return self._cache

        # 首次调用，生成并缓存结果
        structure = self.tree_structure.get("structure", [])

        if not structure:
            result = "错误: 文档没有目录结构"
        else:
            lines = ["# 文档目录结构\n"]
            for node in structure:
                lines.extend(self._format_node(node, level=0))
            result = "\n".join(lines)

        # 缓存结果
        self._cache = result
        return result

    def _format_node(self, node: Dict[str, Any], level: int) -> List[str]:
        """递归格式化节点为可读文本"""
        indent = "  " * level
        title = node.get("title", "未命名章节")
        start_page = node.get("start_index", "?")
        end_page = node.get("end_index", "?")
        node_id = node.get("node_id", "")

        lines = [f"{indent}- {title} (第 {start_page}-{end_page} 页) [ID: {node_id}]"]

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
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 返回结果数，默认5\n\n"
        "**返回格式：** JSON 数组，每个元素包含：\n"
        "- text: 文档片段内容\n"
        "- obsidian_link: Obsidian wiki link（如 [[file.md#^page-5]]）\n"
        "- page: 页码\n"
        "- anchor: 锚点（如 ^page-5）\n\n"
        "**使用方法：** 在回答中直接使用 obsidian_link 字段的值作为引用。"
    )

    def __init__(
        self,
        index_id: str,
        storage_dir: str,
        markdown_locator: Optional[MarkdownLocator] = None,
    ):
        """
        初始化工具

        Args:
            index_id: 索引 ID
            storage_dir: 存储目录
            markdown_locator: Markdown 定位器（可选），用于生成增强的引用元数据
        """
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.markdown_locator = markdown_locator
        self._search_cache: Dict[str, str] = {}  # 添加搜索缓存 {query_key: result}

    def __call__(self, query: str, top_k: int = 5) -> str:
        """
        执行混合检索（带缓存）

        Args:
            query: 搜索查询
            top_k: 返回结果数量

        Returns:
            JSON 字符串，包含增强的引用元数据：
            - 当 markdown_locator 提供时：返回包含 node_id、obsidian_link、page、anchor、text 的结构化数据
            - 当 markdown_locator 为 None 时：返回基本元数据（text、page、metadata）

            返回格式示例：
            [
                {
                    "node_id": "node_1",
                    "obsidian_link": "[[file.md#^page-5]]",
                    "page": 5,
                    "anchor": "^page-5",
                    "text": "相关内容..."
                },
                ...
            ]
        """
        # 验证查询参数
        if not query or not isinstance(query, str):
            return json.dumps({"error": "查询参数必须是非空字符串"}, ensure_ascii=False)

        # 验证 top_k 参数
        if top_k < 1 or top_k > 50:
            return json.dumps({"error": "top_k 必须在 1-50 之间"}, ensure_ascii=False)

        # 构建缓存键
        cache_key = f"{query}_{top_k}"

        # 检查缓存
        if cache_key in self._search_cache:
            return self._search_cache[cache_key]

        try:
            # 异步调用 query_pdf - 安全地处理事件循环
            # 由于项目已在 main.py 中应用 nest_asyncio，可以安全运行嵌套循环
            try:
                # 使用现代 API 获取事件循环（避免弃用警告）
                loop = asyncio.get_event_loop_policy().get_event_loop()
                if loop.is_running():
                    # 已有运行中的循环，nest_asyncio 允许嵌套 run_until_complete
                    result = loop.run_until_complete(
                        query_pdf(
                            query=query,
                            index_id=self.index_id,
                            storage_dir=self.storage_dir,
                            max_results=top_k,
                        )
                    )
                else:
                    # 循环存在但未运行，使用 run_until_complete
                    result = loop.run_until_complete(
                        query_pdf(
                            query=query,
                            index_id=self.index_id,
                            storage_dir=self.storage_dir,
                            max_results=top_k,
                        )
                    )
            except RuntimeError:
                # 没有循环，使用 asyncio.run 创建新循环
                result = asyncio.run(
                    query_pdf(
                        query=query,
                        index_id=self.index_id,
                        storage_dir=self.storage_dir,
                        max_results=top_k,
                    )
                )

            if result.get("status") == "error":
                return json.dumps(
                    {"error": result.get("error", "检索失败")}, ensure_ascii=False
                )

            search_results = result.get("results", [])

            if not search_results:
                return json.dumps(
                    {"error": f"未找到与 '{query}' 相关的内容"}, ensure_ascii=False
                )

            # 构建结构化结果，包含引用元数据
            structured_results = []

            for item in search_results:
                metadata = item.get("metadata", {})
                node_id = metadata.get("node_id")
                page_num = metadata.get("page")
                text = item.get("text", "")

                # 如果提供了 markdown_locator 且有 node_id，生成增强的引用元数据
                if self.markdown_locator and node_id:
                    citation = self.markdown_locator.generate_citation_metadata(
                        node_id=node_id, page_num=page_num, text=text
                    )
                    # 【调试】记录生成的引用
                    logger.info(
                        f"[工具调用] node_id={node_id}, obsidian_link={citation.get('obsidian_link')}"
                    )
                    structured_results.append(citation)
                else:
                    # 【调试】记录为什么没有使用 markdown_locator
                    if not self.markdown_locator:
                        logger.warning(
                            "[工具调用] markdown_locator 未初始化，无法生成 obsidian_link"
                        )
                    elif not node_id:
                        logger.warning(
                            f"[工具调用] 搜索结果缺少 node_id，metadata={metadata}"
                        )
                    # 回退到基本元数据
                    structured_results.append(
                        {
                            "text": text,
                            "page": page_num,
                            "metadata": metadata,
                        }
                    )

            # 生成结果JSON
            result = json.dumps(structured_results, ensure_ascii=False)

            # 缓存结果
            self._search_cache[cache_key] = result

            return result

        except (ValueError, IOError, OSError, RuntimeError) as e:
            return json.dumps({"error": f"检索失败 - {str(e)}"}, ensure_ascii=False)
        except Exception as e:
            return json.dumps(
                {"error": f"检索时发生未知错误 - {str(e)}"}, ensure_ascii=False
            )


class LLMTreeSearchTool:
    """
    LLM 树搜索工具 - 基于深度理解的智能检索

    通过分析文档树结构找到相关章节，适合跨章节推理、模糊问题。
    """

    name: str = "llm_tree_search"
    description: str = (
        "基于深度理解的智能检索，通过分析文档逻辑结构找到相关章节。"
        "适合跨章节推理、模糊问题或需要理解文档整体脉络的查询。"
        "参数: query (str, 必需) - 搜索问题\n\n"
        "**返回格式：** JSON 数组，包含 obsidian_link、page、text（与"
        "hybrid_search 相同）"
    )

    def __init__(
        self,
        hybrid_search_tool: HybridSearchTool,
        markdown_locator: MarkdownLocator,
        node_map: Dict[str, Any],
        llm_client: Any,
        cache_ttl: int = 300,
    ):
        """
        初始化 LLM 树搜索工具

        Args:
            hybrid_search_tool: 混合检索工具实例
            markdown_locator: Markdown 定位器实例
            node_map: 节点映射表，从 node_id 到节点元数据
            llm_client: LLM 客户端实例
            cache_ttl: 缓存生存时间（秒），默认 300
        """
        self._hybrid_search = hybrid_search_tool
        self._markdown_locator = markdown_locator
        self._node_map = node_map
        self._llm_client = llm_client
        self._cache_ttl = cache_ttl
        self._cache: Dict[str, str] = {}

        logger = logging.getLogger(__name__)
        logger.info("[LLM_TREE_SEARCH] 工具初始化完成")

    def _get_cache_key(self, query: str) -> str:
        """生成缓存键"""
        return hashlib.md5(query.encode()).hexdigest()

    def _get_from_cache(self, query: str) -> Optional[str]:
        """从缓存获取结果（带过期检查）"""
        cache_key = self._get_cache_key(query)
        if cache_key in self._cache:
            logger.info(f"[LLM_TREE_SEARCH][CACHE] 缓存命中: query='{query[:30]}...'")
            return self._cache[cache_key]
        logger.info(f"[LLM_TREE_SEARCH][CACHE] 缓存未命中: query='{query[:30]}...'")
        return None

    def _save_to_cache(self, query: str, result: str):
        """保存结果到缓存"""
        cache_key = self._get_cache_key(query)
        self._cache[cache_key] = result
        logger.info("[LLM_TREE_SEARCH][CACHE] 结果已缓存")

    def __call__(self, query: str, top_k: int = 5) -> str:
        """
        执行 LLM 树搜索

        Args:
            query: 搜索查询
            top_k: 返回结果数量（注意：阶段 1 固定使用 20 进行粗筛）

        Returns:
            JSON 字符串，与 HybridSearchTool 返回格式一致
        """
        logger = logging.getLogger(__name__)

        # 检查缓存
        cached = self._get_from_cache(query)
        if cached is not None:
            return cached

        # ===== 阶段 1: 粗筛 =====
        logger.info(f"[LLM_TREE_SEARCH][STAGE1] 开始粗筛: query='{query[:30]}...'")

        try:
            hybrid_result = self._hybrid_search(query=query, top_k=20)
            logger.info("[LLM_TREE_SEARCH][STAGE1] 粗筛完成")
        except Exception as e:
            logger.error(f"[LLM_TREE_SEARCH][STAGE1] 粗筛失败: {e}")
            return json.dumps({"error": f"检索失败: {str(e)}"}, ensure_ascii=False)

        # 解析 HybridSearchTool 结果
        try:
            hybrid_data = json.loads(hybrid_result)
            if "error" in hybrid_data:
                return hybrid_result
            search_results = (
                hybrid_data
                if isinstance(hybrid_data, list)
                else hybrid_data.get("results", [])
            )
        except json.JSONDecodeError:
            search_results = []

        if not search_results:
            return json.dumps([], ensure_ascii=False)

        # 临时返回 hybrid_result（阶段 2 尚未实现）
        return hybrid_result
