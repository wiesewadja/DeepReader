# src/deeppdf/agent/executor.py
"""
工具执行器 - 管理和调用 Agent 工具
"""

from typing import Dict, Any, Optional
import logging

from .tools import (
    Tool,
    InspectTocTool,
    ReadPageTool,
    HybridSearchTool,
    LLMTreeSearchTool,
    CrossBookSearchTool,
    ListAvailableBooksTool,
)
from .markdown_locator import MarkdownLocator

logger = logging.getLogger(__name__)


class ToolExecutor:
    """工具执行器 - 安全地执行工具调用"""

    def __init__(self, tools: Dict[str, Tool]):
        """
        初始化执行器

        Args:
            tools: 工具字典 {name: tool_instance}
        """
        self.tools = tools

    def execute(self, tool_name: str, **kwargs) -> str:
        """
        安全执行工具

        Args:
            tool_name: 工具名称
            **kwargs: 工具参数

        Returns:
            执行结果字符串
        """
        logger.info(f"      🔍 [工具详情] 名称: {tool_name}")
        logger.info(f"      🔍 [工具详情] 参数: {kwargs}")

        if tool_name not in self.tools:
            error_msg = f"[ERROR] 未知工具: {tool_name}。可用工具: {', '.join(self.tools.keys())}"
            logger.error(f"      ❌ {error_msg}")
            return error_msg

        tool = self.tools[tool_name]

        try:
            logger.info(f"      ⚙️  [执行中] 调用 {tool_name}...")
            result = tool(**kwargs)

            # 记录返回结果的详细信息
            result_length = len(result)
            logger.info(f"      ✅ [执行成功] {tool_name}")
            logger.info(f"      📏 [返回长度] {result_length} 字符")

            # 显示结果预览（前200字符）
            if result_length > 200:
                preview = result[:200] + "..."
            else:
                preview = result
            logger.info(f"      📄 [结果预览] {preview}")

            return f"[SUCCESS] {result}"
        except ValueError as e:
            error_msg = f"[ERROR] 参数错误: {e}"
            logger.error(f"      ❌ [参数错误] {tool_name}: {e}")
            return error_msg
        except FileNotFoundError as e:
            error_msg = "[ERROR] 文件不存在，请确认索引有效"
            logger.error(f"      ❌ [文件错误] {tool_name}: {e}")
            return error_msg
        except Exception as e:
            error_msg = f"[ERROR] 工具执行失败: {str(e)[:100]}"
            logger.error(f"      ❌ [执行失败] {tool_name}: {e}", exc_info=True)
            return error_msg

    def get_tool_descriptions(self) -> str:
        """
        获取所有工具的描述，用于 System Prompt

        Returns:
            工具描述字符串
        """
        lines = ["## 可用工具\n\n"]

        for name, tool in self.tools.items():
            lines.append(f"### {name}")
            lines.append(f"{tool.description}")
            lines.append("")

        return "\n".join(lines)


def create_tool_executor(
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    pageindex_lib_path: Optional[str] = None,
    markdown_locator: Optional[MarkdownLocator] = None,
    enable_llm_tree_search: bool = False,
    llm_client: Optional[Any] = None,
    index_metadata: Optional[Dict[str, Any]] = None,
    deepseek_ocr_client: Optional[Any] = None,
) -> ToolExecutor:
    """
    创建并配置工具执行器

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        tree_structure: 树状结构（来自 index_metadata）
        pageindex_lib_path: PageIndex 库路径（可选）
        markdown_locator: Markdown 定位器（可选，用于生成引用链接）
        enable_llm_tree_search: 是否启用 LLM 树搜索工具（默认 False）
        llm_client: LLM 客户端实例（可选，启用 LLM 树搜索时必需）
        index_metadata: 索引元数据（包含 visual_heavy 标记）
        deepseek_ocr_client: DeepSeek OCR 客户端

    Returns:
        配置好的 ToolExecutor 实例
    """
    tools: Dict[str, Tool] = {}

    # 1. InspectTocTool - 查看目录
    tools["inspect_toc"] = InspectTocTool(tree_structure)

    # 2. HybridSearchTool - 快速检索
    # 如果提供了 markdown_locator，将其注入到工具中（在 Task 2 中使用）
    tools["hybrid_search"] = HybridSearchTool(
        index_id, storage_dir, markdown_locator=markdown_locator
    )

    # 3. ReadPageTool - 按页读取（需要 PageIndex）
    if pageindex_lib_path:
        tools["read_page"] = ReadPageTool(
            pageindex_lib_path,
            index_id,
            storage_dir,
            index_metadata=index_metadata,
            deepseek_ocr_client=deepseek_ocr_client,
        )
    else:
        logger.warning("[工具初始化] 未提供 pageindex_lib_path，read_page 工具将不可用")

    # 4. LLMTreeSearchTool - LLM 树搜索（可选）
    if enable_llm_tree_search:
        if not llm_client:
            logger.warning("[工具初始化] 未提供 llm_client，LLMTreeSearchTool 将不可用")
        else:
            # 创建 node_map: 从 node_id 到节点元数据的映射
            from pageindex.structure.converter import structure_to_list

            nodes_list = structure_to_list(tree_structure.get("structure", []))
            node_map = {
                node.get("node_id"): node for node in nodes_list if node.get("node_id")
            }

            tools["llm_tree_search"] = LLMTreeSearchTool(
                hybrid_search_tool=tools["hybrid_search"],
                markdown_locator=markdown_locator,
                node_map=node_map,
                llm_client=llm_client,
            )
            logger.info("[工具初始化] LLMTreeSearchTool 已启用")

    # 如果提供了 markdown_locator，存储在 ToolExecutor 中供后续使用
    executor = ToolExecutor(tools)
    if markdown_locator:
        executor.markdown_locator = markdown_locator
        logger.info("[工具初始化] MarkdownLocator 已注入到 ToolExecutor")

    return executor


def create_cross_book_executor(
    storage_dir: str,
) -> ToolExecutor:
    """
    创建跨书籍模式的工具执行器

    Args:
        storage_dir: 存储目录

    Returns:
        配置好的 ToolExecutor 实例，包含跨书籍搜索工具
    """
    from .tools import CrossBookSearchTool, ListAvailableBooksTool

    tools: Dict[str, Tool] = {}

    # 跨书籍搜索工具
    tools["cross_book_search"] = CrossBookSearchTool(storage_dir=storage_dir)

    # 列出所有可搜索书籍
    tools["list_available_books"] = ListAvailableBooksTool(storage_dir=storage_dir)

    logger.info("[工具初始化] 跨书籍模式工具已创建")
    return ToolExecutor(tools)
