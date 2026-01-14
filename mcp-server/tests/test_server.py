import asyncio
import pytest
from deeppdf.server import MCPServer

def test_server_creation():
    """测试服务器实例创建"""
    server = MCPServer()
    assert server is not None
    assert hasattr(server, 'app')

@pytest.mark.asyncio
async def test_server_has_tools():
    """测试服务器注册工具"""
    server = MCPServer()
    # 稍后添加工具列表验证
    assert True
