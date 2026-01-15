#!/usr/bin/env python3
"""
DeepPDF MCP Server
PDF 索引和查询服务
"""

import json
import nest_asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
from .config import Config
from .tools.pdf_indexer import index_pdf
from .tools.pdf_query import query_pdf
from .tools.index_manager import list_indexes, delete_index

# 应用 nest_asyncio 以支持嵌套事件循环
# 这对于 PageIndex 库的异步操作很重要
nest_asyncio.apply()


class MCPServer:
    """MCP 服务器封装"""

    def __init__(self):
        self.config = Config()
        self.app = Server("deeppdf-server")
        self.tools = self._setup_handlers()

    def _setup_handlers(self):
        """设置 MCP 处理器"""
        # 定义工具列表 - 使用 types.Tool 类型
        tools = [
            types.Tool(
                name="index_pdf",
                description="解析 PDF 并生成索引",
                inputSchema={
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "PDF 文件路径"}},
                    "required": ["path"],
                },
            ),
            types.Tool(
                name="query_pdf",
                description="查询 PDF 内容",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "查询文本"},
                        "index_id": {"type": "string", "description": "索引 ID"},
                    },
                    "required": ["query", "index_id"],
                },
            ),
            types.Tool(
                name="list_indexes",
                description="列出所有索引",
                inputSchema={"type": "object", "properties": {}},
            ),
            types.Tool(
                name="delete_index",
                description="删除指定索引",
                inputSchema={
                    "type": "object",
                    "properties": {"index_id": {"type": "string", "description": "索引 ID"}},
                    "required": ["index_id"],
                },
            ),
        ]

        @self.app.list_tools()
        async def list_tools() -> list:
            """列出可用工具"""
            return tools

        @self.app.call_tool()
        async def call_tool(name: str, arguments: dict):
            """处理工具调用

            返回格式：直接返回字典作为结构化数据，MCP SDK 会自动序列化
            """
            if name == "index_pdf":
                result = index_pdf(
                    pdf_path=arguments["path"], storage_dir=str(self.config.base_dir)
                )
                return result
            elif name == "query_pdf":
                result = query_pdf(
                    query=arguments["query"],
                    index_id=arguments["index_id"],
                    storage_dir=str(self.config.base_dir),
                    max_results=self.config.max_results,
                )
                return result
            elif name == "list_indexes":
                result = list_indexes(str(self.config.base_dir))
                return result
            elif name == "delete_index":
                result = delete_index(arguments["index_id"], str(self.config.base_dir))
                return result
            # 未知工具
            raise ValueError(f"Unknown tool: {name}")

        return tools

    async def run(self):
        """运行服务器"""
        async with stdio_server() as (read_stream, write_stream):
            await self.app.run(read_stream, write_stream, self.app.create_initialization_options())


def main():
    """入口函数"""
    server = MCPServer()
    import asyncio

    try:
        # 检查是否已有运行中的事件循环
        loop = asyncio.get_running_loop()
        # 如果已有事件循环，使用 run_until_complete
        loop.run_until_complete(server.run())
    except RuntimeError:
        # 没有运行中的事件循环，使用 asyncio.run()
        asyncio.run(server.run())


if __name__ == "__main__":
    main()
