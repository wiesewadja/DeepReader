# src/deeppdf/agent/executor.py
"""
工具执行器 - 管理和调用 Agent 工具
"""
from typing import Dict, Any, List, Optional
import logging

from .tools import Tool, InspectTocTool, ReadPageTool, HybridSearchTool

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
        if tool_name not in self.tools:
            return f"[ERROR] 未知工具: {tool_name}。可用工具: {', '.join(self.tools.keys())}"

        tool = self.tools[tool_name]

        try:
            logger.info(f"[工具调用] {tool_name} 参数: {kwargs}")
            result = tool(**kwargs)
            logger.info(f"[工具结果] {tool_name} 成功")
            return f"[SUCCESS] {result}"
        except ValueError as e:
            logger.error(f"[工具错误] {tool_name} 参数错误: {e}")
            return f"[ERROR] 参数错误: {e}"
        except FileNotFoundError as e:
            logger.error(f"[工具错误] {tool_name} 文件不存在: {e}")
            return f"[ERROR] 文件不存在，请确认索引有效"
        except Exception as e:
            logger.error(f"[工具错误] {tool_name} 执行失败: {e}", exc_info=True)
            return f"[ERROR] 工具执行失败: {str(e)[:100]}"

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
    pageindex_lib_path: Optional[str] = None
) -> ToolExecutor:
    """
    创建并配置工具执行器

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        tree_structure: 树状结构（来自 index_metadata）
        pageindex_lib_path: PageIndex 库路径（可选）

    Returns:
        配置好的 ToolExecutor 实例
    """
    tools: Dict[str, Tool] = {}

    # 1. InspectTocTool - 查看目录
    tools["inspect_toc"] = InspectTocTool(tree_structure)

    # 2. HybridSearchTool - 快速检索
    tools["hybrid_search"] = HybridSearchTool(index_id, storage_dir)

    # 3. ReadPageTool - 按页读取（需要 PageIndex）
    if pageindex_lib_path:
        tools["read_page"] = ReadPageTool(pageindex_lib_path, index_id, storage_dir)
    else:
        logger.warning("[工具初始化] 未提供 pageindex_lib_path，read_page 工具将不可用")

    return ToolExecutor(tools)
