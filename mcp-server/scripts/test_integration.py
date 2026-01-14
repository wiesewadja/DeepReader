#!/usr/bin/env python3
"""
集成测试脚本 - 测试 MCP 服务器功能
"""
import sys
import asyncio
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from deeppdf.tools.pdf_indexer import index_pdf
from deeppdf.tools.pdf_querier import query_pdf
from deeppdf.tools.index_manager import list_indexes, delete_index

async def main():
    storage_dir = "/tmp/deeppdf_test"

    print("🧪 DeepPDF 集成测试")
    print("=" * 50)

    # 测试 1: 列出索引（应该为空）
    print("\n1. 列出索引...")
    result = list_indexes(storage_dir)
    print(f"   结果: {result}")

    # 测试 2: 索引 PDF（需要测试文件）
    print("\n2. 索引 PDF...")
    test_pdf = "/path/to/test.pdf"  # 替换为实际路径
    if Path(test_pdf).exists():
        result = index_pdf(test_pdf, storage_dir, require_llm=False)
        print(f"   结果: {result}")
    else:
        print(f"   跳过: 测试文件不存在 ({test_pdf})")

    # 测试 3: 再次列出索引
    print("\n3. 再次列出索引...")
    result = list_indexes(storage_dir)
    print(f"   结果: {result}")

    print("\n✅ 集成测试完成")

if __name__ == "__main__":
    asyncio.run(main())
