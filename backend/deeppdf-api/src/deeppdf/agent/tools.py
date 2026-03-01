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
    """按页读取工具 - 从指定页码读取 PDF 内容（支持视觉密集型 PDF）"""

    name: str = "read_page"
    description: str = (
        "读取 PDF 指定页码的完整内容，返回带段落标记的原始文本。"
        "适用于需要精确引用或深入分析特定页面的场景。"
        "参数: page_num (int, 必需) - 要读取的页码（从1开始）"
    )

    def __init__(
        self,
        pageindex_lib_path: str,
        index_id: str,
        storage_dir: str,
        index_metadata: Optional[Dict[str, Any]] = None,
        deepseek_ocr_client: Optional[Any] = None,
    ):
        """
        初始化工具

        Args:
            pageindex_lib_path: PageIndex 库的路径
            index_id: 索引 ID
            storage_dir: 存储目录
            index_metadata: 索引元数据（包含 visual_heavy 标记）
            deepseek_ocr_client: DeepSeek OCR 客户端（可选）
        """
        self.pageindex_lib_path = pageindex_lib_path
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.index_metadata = index_metadata or {}
        self.deepseek_ocr_client = deepseek_ocr_client
        self._pi = None  # 延迟加载

        # 检测是否为视觉密集型 PDF
        self.is_visual_heavy = self.index_metadata.get("visual_heavy", False)
        if self.is_visual_heavy:
            logger.info("=" * 60)
            logger.info(f"[ReadPageTool] 🔍 视觉密集型模式已启用")
            logger.info(f"[ReadPageTool]    - 索引ID: {index_id}")
            logger.info(f"[ReadPageTool]    - OCR客户端: {'✅ 已配置' if self.deepseek_ocr_client else '❌ 未配置'}")
            logger.info(f"[ReadPageTool]    - 读取方式: DeepSeek OCR 视觉推理")
            logger.info("=" * 60)

    def _load_page_index(self):
        """延迟加载索引数据"""
        if self._pi is None:
            import json

            # 尝试 .json 格式
            json_path = Path(self.storage_dir) / "indexes" / f"{self.index_id}.json"

            if not json_path.exists():
                raise FileNotFoundError(f"索引文件不存在: {json_path}")

            logger.info(f"[ReadPageTool] 📁 加载索引文件: {json_path}")
            with open(json_path, 'r', encoding='utf-8') as f:
                self._pi = json.load(f)

        return self._pi

    def __call__(self, page_num: int, **kwargs: Any) -> str:
        """
        读取指定页码的内容

        Args:
            page_num: 页码（从 1 开始）
            **kwargs: 其他参数（兼容性保留）

        Returns:
            页面文本内容
        """
        logger.info(f"[ReadPageTool] 📖 读取页面请求: 第 {page_num} 页")

        # 如果是视觉密集型，使用 DeepSeek OCR
        if self.is_visual_heavy:
            logger.info(f"[ReadPageTool] → 使用模式: 🖼️ DeepSeek OCR 视觉推理")
            return self._read_page_visual(page_num)

        # 否则使用普通文本读取
        logger.info(f"[ReadPageTool] → 使用模式: 📄 普通文本读取")
        return self._read_page_normal(page_num)

    def _read_page_normal(self, page_num: int) -> str:
        """普通文本读取"""
        try:
            pi = self._load_page_index()

            # 获取总页数
            total_pages = pi.get('total_pages', 0)
            if total_pages == 0:
                # 回退：使用 sections 数量
                total_pages = len(pi.get('sections', []))

            # 验证页码范围
            if page_num < 1 or page_num > total_pages:
                return f"错误: 页码 {page_num} 超出范围（文档共 {total_pages} 页）"

            # 从 sections 中获取页面内容
            sections = pi.get('sections', [])

            # 查找对应页码的 section（页码从 1 开始，数组索引从 0 开始）
            # sections[i] 对应第 i+1 页
            if page_num <= len(sections):
                section = sections[page_num - 1]
                text = section.get('text', '')
                metadata = section.get('metadata', {})
                section_name = metadata.get('section', '未知章节')

                return f"# 第 {page_num} 页内容\n\n**章节**: {section_name}\n\n{text}"
            else:
                return f"错误: 页码 {page_num} 超出范围（sections 共 {len(sections)} 条）"

        except (FileNotFoundError, ValueError, IOError, OSError) as e:
            logger.error(f"[ReadPageTool] ❌ 读取页面失败: {e}")
            return f"错误: 读取页面失败 - {str(e)}"
        except Exception as e:
            logger.error(f"[ReadPageTool] ❌ 读取页面时发生未知错误: {e}", exc_info=True)
            return f"错误: 读取页面时发生未知错误 - {str(e)}"

    def _read_page_visual(self, page_num: int) -> str:
        """视觉读取（DeepSeek OCR）"""
        logger.info("=" * 60)
        logger.info(f"[ReadPageTool] 🖼️  启动 DeepSeek OCR 视觉推理")
        logger.info(f"[ReadPageTool]    - 目标页码: {page_num}")
        logger.info("=" * 60)

        if not self.deepseek_ocr_client:
            logger.error("=" * 60)
            logger.error(f"[ReadPageTool] ❌ DeepSeek OCR 客户端未初始化")
            logger.error(f"[ReadPageTool]    - 请检查 DEEPSEEK_OCR_API_KEY 配置")
            logger.error("=" * 60)
            return "错误: OCR 客户端未配置"

        try:
            # 获取 PDF 路径
            pdf_path = self.index_metadata.get("pdf_path")
            if not pdf_path:
                logger.error(f"[ReadPageTool] ❌ 无法找到 PDF 文件路径")
                return "错误: 无法找到 PDF 文件路径"

            logger.info(f"[ReadPageTool] 📁 PDF 路径: {pdf_path}")

            # 调用 DeepSeek OCR（page_num 转为从 0 开始）
            logger.info(f"[ReadPageTool] 🔄 调用 DeepSeek OCR API...")
            result = self.deepseek_ocr_client.read_pdf_page(
                pdf_path=pdf_path,
                page_num=page_num - 1,
            )

            logger.info("=" * 60)
            logger.info(f"[ReadPageTool] ✅ OCR 识别完成")
            logger.info(f"[ReadPageTool]    - 识别字符数: {len(result)}")
            logger.info("=" * 60)

            return f"# 第 {page_num} 页内容（OCR识别）\n\n{result}"

        except Exception as e:
            logger.error("=" * 60)
            logger.error(f"[ReadPageTool] ❌ 视觉读取失败")
            logger.error(f"[ReadPageTool]    - 页码: {page_num}")
            logger.error(f"[ReadPageTool]    - 错误: {e}")
            logger.error("=" * 60)
            return f"读取失败: {str(e)}"


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

        # ===== 阶段 2: 精排 =====
        # 构建候选子树
        candidate_tree = self._build_candidate_tree(search_results)
        node_count = self._count_nodes(candidate_tree)

        logger.info(f"[LLM_TREE_SEARCH][STAGE2] 候选子树: {node_count} 个节点")

        # 选择 LLM 模型
        model_name = self._select_model(node_count)
        logger.info(f"[LLM_TREE_SEARCH][STAGE2] 使用模型: {model_name}")

        # 构建 Prompt
        from deeppdf.agent.prompt_builder import PromptBuilder

        prompt_builder = PromptBuilder()
        prompt = prompt_builder.build(query, candidate_tree)

        # 调用 LLM
        try:
            llm_response = self._llm_client.chat(prompt)
            logger.info("[LLM_TREE_SEARCH][STAGE2] LLM 响应成功")
        except Exception as e:
            logger.warning(
                f"[LLM_TREE_SEARCH][FALLBACK] LLM 调用失败，回退到 hybrid_search: {e}"
            )
            self._save_to_cache(query, hybrid_result)
            return hybrid_result

        # 解析 LLM 响应
        try:
            llm_data = self._extract_json(llm_response)
            node_list = llm_data.get("node_list", [])
        except Exception as e:
            logger.warning(
                f"[LLM_TREE_SEARCH][FALLBACK] JSON 解析失败，回退到 hybrid_search: {e}"
            )
            self._save_to_cache(query, hybrid_result)
            return hybrid_result

        if not node_list:
            logger.warning(
                "[LLM_TREE_SEARCH][FALLBACK] 空结果，使用 hybrid_search 原始结果"
            )
            self._save_to_cache(query, hybrid_result)
            return hybrid_result

        # 生成最终结果
        final_results = self._generate_results(node_list)
        result_json = json.dumps(final_results, ensure_ascii=False)

        # 缓存并返回
        self._save_to_cache(query, result_json)
        logger.info(f"[LLM_TREE_SEARCH][RESULT] 返回 {len(final_results)} 个节点")

        return result_json

    def _build_candidate_tree(self, search_results: list) -> Dict[str, Any]:
        """从搜索结果构建候选子树"""
        tree_nodes = []
        for result in search_results:
            metadata = result.get("metadata", {})
            node_id = metadata.get("node_id")
            if node_id and node_id in self._node_map:
                node = self._node_map[node_id].copy()
                tree_nodes.append(
                    {
                        "title": node.get("title", ""),
                        "node_id": node_id,
                        "summary": node.get("summary", ""),
                        "prefix_summary": node.get("prefix_summary", ""),
                        "start_index": node.get("start_index"),
                    }
                )
        return {"structure": tree_nodes}

    def _count_nodes(self, tree: Dict[str, Any]) -> int:
        """统计树节点数量"""

        def count(node):
            total = 1
            for child in node.get("nodes", []):
                total += count(child)
            return total

        return sum(count(node) for node in tree.get("structure", []))

    def _select_model(self, node_count: int) -> str:
        """根据节点数量选择 LLM 模型"""
        return "lightweight" if node_count <= 10 else "reasoning"

    def _extract_json(self, response: str) -> Dict[str, Any]:
        """从 LLM 响应中提取 JSON"""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            if "```json" in response:
                start = response.find("```json") + 7
                end = response.rfind("```")
                if end > start:
                    return json.loads(response[start:end].strip())
            raise

    def _generate_results(self, node_list: list) -> list:
        """根据 node_list 生成最终结果"""
        results = []
        for node_id in node_list:
            if node_id not in self._node_map:
                logger.warning(
                    f"[LLM_TREE_SEARCH][RESULT] node_id {node_id} 不在 node_map 中"
                )
                continue
            node = self._node_map[node_id]
            citation = self._markdown_locator.generate_citation_metadata(
                node_id=node_id,
                page_num=node.get("start_index"),
                text=node.get("text", "")[:500],
            )
            results.append(citation)
        return results


# ============================================================
# 跨书籍模式工具
# ============================================================


class CrossBookSearchTool:
    """跨书籍搜索工具 - 在所有已索引书籍中搜索"""

    name: str = "cross_book_search"
    description: str = (
        "在所有已索引的书籍中搜索相关内容。"
        "适用于：主题研究（如'认知偏差在哪些书中提到'）、观点对比、跨书籍知识串联。"
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 每本书返回结果数，默认5\n\n"
        "**返回格式：** JSON 数组，每个元素包含：\n"
        "- text: 文档片段内容\n"
        "- book_name: 来源书籍名称\n"
        "- section: 章节名\n"
        "- page: 页码\n"
        "- obsidian_link: Obsidian wiki 链接\n\n"
        "**使用方法：** 在回答中引用来源书籍，格式：【《书名》章节名】"
    )

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir

    def __call__(self, query: str, top_k: int = 5) -> str:
        from ..services.cross_book_search import cross_book_search

        result = cross_book_search(
            query=query,
            storage_dir=self.storage_dir,
            top_k=top_k
        )

        if result["status"] != "success":
            return f"搜索失败: {result.get('error', 'Unknown error')}"

        if not result["results"]:
            return "未找到相关内容"

        # 格式化输出
        output_lines = [f"在 {result['books_searched']} 本书中找到 {result['total_results']} 条相关内容:\n"]

        for i, r in enumerate(result["results"], 1):
            output_lines.append(
                f"{i}. 【《{r['book_name']}》{r['section']}】(第{r['page']}页)\n"
                f"   {r['text'][:200]}...\n"
            )

        return "\n".join(output_lines)


class ListAvailableBooksTool:
    """列出所有可搜索的书籍"""

    name: str = "list_available_books"
    description: str = (
        "列出当前所有已索引的可搜索书籍。"
        "在开始跨书籍研究前，建议先调用此工具了解可用的书籍范围。"
        "无需任何参数。"
    )

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self._cache: Optional[str] = None

    def __call__(self, **kwargs) -> str:
        if self._cache is not None:
            return self._cache

        from ..services.cross_book_search import get_all_indexes

        indexes = get_all_indexes(self.storage_dir)

        if not indexes:
            return "当前没有已索引的书籍"

        lines = [f"当前共有 {len(indexes)} 本已索引的书籍:\n"]

        for i, idx in enumerate(indexes, 1):
            doc_type_icon = "📘" if idx.get("doc_type") == "epub" else "📕"
            lines.append(
                f"{i}. {doc_type_icon} 《{idx['book_name']}》 "
                f"(节点数: {idx.get('node_count', 'N/A')})"
            )

        self._cache = "\n".join(lines)
        return self._cache
