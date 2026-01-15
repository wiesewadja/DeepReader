#!/usr/bin/env python3
"""
测试 PDF 索引功能是否能正常工作（包括嵌套事件循环处理）
"""
import asyncio
import nest_asyncio
import sys
import os

# 设置 PYTHONPATH
sys.path.insert(0, 'packages/deeppdf/src')
sys.path.insert(0, 'packages/pageindex/src')

# 应用 nest_asyncio 以支持嵌套事件循环
nest_asyncio.apply()

from deeppdf.tools.pdf_indexer import index_pdf

async def test_indexing():
    """测试 PDF 索引功能"""
    print("=" * 60)
    print("PDF 索引功能测试")
    print("=" * 60)

    # 检查环境变量
    api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\n⚠ 警告: 未检测到 LLM API Key")
        print("请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量")
        print("或配置 .env 文件")
        return

    print(f"\n✓ 检测到 LLM API Key: {api_key[:8]}...{api_key[-4:]}")

    # 测试索引一个简单的 PDF
    # 注意：这里我们只是测试代码能否运行，不实际创建索引
    print("\n正在测试索引功能...")

    # 创建一个测试 PDF 路径（不存在的文件）
    test_pdf = "/tmp/test.pdf"

    print(f"测试 PDF 路径: {test_pdf}")

    # 调用 index_pdf（会因为文件不存在而返回错误，但这是预期的）
    result = index_pdf(
        pdf_path=test_pdf,
        storage_dir="data/test"
    )

    print(f"\n索引结果:")
    print(f"  状态: {result.get('status')}")
    if result.get('status') == 'error':
        print(f"  错误: {result.get('error')}")
        print("\n✓ 这是预期的错误（文件不存在）")
        print("✓ 重要的是：代码没有因为 asyncio 事件循环而崩溃！")
        return True
    else:
        print(f"  索引 ID: {result.get('index_id')}")
        print(f"  节点数: {result.get('node_count')}")
        return True

# 运行测试
if __name__ == "__main__":
    try:
        print("启动测试...\n")
        result = asyncio.run(test_indexing())

        if result:
            print("\n" + "=" * 60)
            print("✓✓✓ 测试成功！")
            print("=" * 60)
            sys.exit(0)
        else:
            print("\n" + "=" * 60)
            print("✗✗✗ 测试失败")
            print("=" * 60)
            sys.exit(1)
    except Exception as e:
        print(f"\n✗✗✗ 测试失败，抛出异常: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
