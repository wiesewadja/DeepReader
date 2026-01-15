#!/usr/bin/env python3
"""
测试 nest_asyncio 是否正确处理嵌套事件循环
"""
import asyncio
import nest_asyncio
import sys
sys.path.insert(0, 'packages/pageindex/src')

# 应用 nest_asyncio
nest_asyncio.apply()

async def test_async_function():
    """测试异步函数"""
    await asyncio.sleep(0.01)
    return "异步函数执行成功"

async def page_index_builder():
    """模拟 page_index_main 中的异步函数"""
    result = await test_async_function()
    return f"PageIndex 模拟: {result}"

async def main_event_loop():
    """模拟 MCP 服务器的异步运行"""
    print("✓ 主事件循环已启动")

    # 模拟 page_index_main 中的代码
    try:
        loop = asyncio.get_running_loop()
        print("✓ 检测到运行中的事件循环")

        # 这是 page_index_main 中的关键代码
        result = loop.run_until_complete(page_index_builder())
        print(f"✓ 结果: {result}")
        return result
    except Exception as e:
        print(f"✗ 错误: {e}")
        raise

# 运行主事件循环
if __name__ == "__main__":
    try:
        result = asyncio.run(main_event_loop())
        print(f"\n✓✓✓ 测试成功！nest_asyncio 正确处理了嵌套事件循环")
        print(f"最终结果: {result}")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗✗✗ 测试失败: {e}")
        sys.exit(1)
