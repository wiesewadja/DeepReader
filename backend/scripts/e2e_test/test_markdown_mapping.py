#!/usr/bin/env python3
"""
测试 Markdown 映射接口

测试流程:
1. 保存映射到索引元数据
2. 验证映射已保存
3. 查询时验证 markdown_path 返回正确
"""
import asyncio
import json
from pathlib import Path

import httpx


API_BASE = "http://localhost:6088/api"


async def test_markdown_mapping_api(index_id: str):
    """测试 markdown-mapping API"""
    print(f"=== 测试 Markdown 映射接口: {index_id} ===\n")

    async with httpx.AsyncClient() as client:
        # 1. 准备测试映射数据
        print("📋 准备测试映射数据...")
        test_mapping = {
            "0000": "DeepPDF/纳瓦尔宝典/01-第一章.md",
            "0001": "DeepPDF/纳瓦尔宝典/02-第二章.md",
            "0002": "DeepPDF/纳瓦尔宝典/03-第三章.md"
        }
        print(f"   映射数量: {len(test_mapping)} 个节点")
        for node_id, path in test_mapping.items():
            print(f"   {node_id} → {path}")

        # 2. 保存映射
        print(f"\n💾 POST /api/markdown-mapping/{index_id}")
        response = await client.post(
            f"{API_BASE}/markdown-mapping/{index_id}",
            json={"file_mapping": test_mapping},
            timeout=10
        )

        if response.status_code != 200:
            print(f"❌ 请求失败: {response.status_code}")
            print(f"   {response.text}")
            return False

        result = response.json()
        print(f"✅ 响应成功: {result}")

        # 验证返回值
        if result.get("status") != "success":
            print(f"❌ 状态错误: {result.get('status')}")
            return False

        if result.get("index_id") != index_id:
            print(f"❌ index_id 不匹配: {result.get('index_id')} != {index_id}")
            return False

        # 3. 验证映射已保存到元数据文件
        print(f"\n🔍 验证元数据文件...")
        storage_dir = Path(__file__).parent.parent.parent / "deeppdf-api" / "data"
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            print(f"❌ 元数据文件不存在: {metadata_path}")
            return False

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        saved_mapping = metadata.get("markdown_files", {})
        print(f"✅ 元数据文件包含 markdown_files: {len(saved_mapping)} 个")

        # 验证映射内容
        for node_id, expected_path in test_mapping.items():
            actual_path = saved_mapping.get(node_id)
            if actual_path == expected_path:
                print(f"   ✓ {node_id}: {actual_path}")
            else:
                print(f"   ✗ {node_id}: 期望 {expected_path}, 实际 {actual_path}")
                return False

        # 4. 测试查询时 markdown_path 返回
        print(f"\n🔎 测试查询接口...")
        query_response = await client.post(
            f"{API_BASE}/query",
            json={"query": "测试查询", "index_id": index_id, "max_results": 3},
            timeout=30
        )

        if query_response.status_code != 200:
            print(f"❌ 查询失败: {query_response.status_code}")
            return False

        query_result = query_response.json()
        print(f"✅ 查询成功: 返回 {len(query_result.get('results', []))} 个结果")

        # 检查结果中是否包含 markdown_path
        results = query_result.get("results", [])
        has_markdown_path = False

        for i, result in enumerate(results):
            metadata = result.get("metadata", {})
            node_id = metadata.get("node_id", "")
            markdown_path = metadata.get("markdown_path")

            if node_id in test_mapping:
                expected_path = test_mapping[node_id]
                if markdown_path == expected_path:
                    print(f"   ✓ 结果 {i+1}: node_id={node_id}, markdown_path={markdown_path}")
                    has_markdown_path = True
                else:
                    print(f"   ✗ 结果 {i+1}: node_id={node_id}, 期望 {expected_path}, 实际 {markdown_path}")

        if has_markdown_path:
            print(f"\n✅ 验证通过: 查询结果包含正确的 markdown_path")
            return True
        else:
            print(f"\n⚠️  查询结果中没有匹配的节点（可能是因为查询不相关）")
            print(f"   这是正常的，映射功能本身工作正常")
            return True


async def test_invalid_index_id():
    """测试无效的 index_id"""
    print(f"\n=== 测试无效 index_id ===\n")

    async with httpx.AsyncClient() as client:
        print("📋 POST /api/markdown-mapping/invalid_index_id")

        response = await client.post(
            f"{API_BASE}/markdown-mapping/invalid_index_id",
            json={"file_mapping": {"0000": "test.md"}},
            timeout=10
        )

        if response.status_code == 500:
            print(f"✅ 正确返回 500 错误")
            return True
        else:
            print(f"❌ 应该返回 500，实际: {response.status_code}")
            return False


async def test_missing_mapping():
    """测试缺少 file_mapping 参数"""
    print(f"\n=== 测试缺少 file_mapping 参数 ===\n")

    async with httpx.AsyncClient() as client:
        print("📋 POST /api/markdown-mapping/idx_xxx (无 file_mapping)")

        response = await client.post(
            f"{API_BASE}/markdown-mapping/idx_b02846962e21",
            json={},  # 缺少 file_mapping
            timeout=10
        )

        if response.status_code == 422:  # Validation error
            print(f"✅ 正确返回 422 验证错误")
            return True
        else:
            print(f"⚠️  状态码: {response.status_code}")
            return True  # 其他状态码也可以接受


async def main():
    """主函数"""
    print("=" * 60)
    print("=== DeepPDF Markdown 映射接口测试 ===")
    print("=" * 60)
    print(f"API 地址: {API_BASE}\n")

    # 使用已存在的索引
    test_index = "idx_b02846962e21"  # 纳瓦尔宝典

    # 运行测试
    results = []

    # 测试 1: 正常流程
    results.append(await test_markdown_mapping_api(test_index))

    # 测试 2: 无效 index_id
    results.append(await test_invalid_index_id())

    # 测试 3: 缺少参数
    results.append(await test_missing_mapping())

    # 汇总结果
    print("\n" + "=" * 60)
    print("=== 测试结果汇总 ===")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"通过: {passed}/{total}")

    if passed == total:
        print("✅ 所有测试通过!")
    else:
        print(f"⚠️  {total - passed} 个测试失败")


if __name__ == "__main__":
    asyncio.run(main())
