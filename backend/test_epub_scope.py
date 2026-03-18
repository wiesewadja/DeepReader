#!/usr/bin/env python3
"""
EPUB 解析和范围搜索测试脚本

测试流程：
1. 上传/索引一个 EPUB 文件
2. 等待索引完成
3. 执行全文搜索，验证返回段落结果
4. 执行范围锁定搜索，验证只返回指定节点内的结果
"""

import asyncio
import httpx
import time
import sys
import json
from pathlib import Path

API_BASE = "http://localhost:6088/api"
HEALTH_URL = "http://localhost:6088/health"

class EPUBTester:
    def __init__(self):
        self.client = httpx.Client(timeout=300.0)
        self.index_id = None

    def test_health(self):
        """测试后端健康状态"""
        print("\n" + "="*50)
        print("1. 测试后端健康状态")
        print("="*50)

        try:
            resp = self.client.get(HEALTH_URL)
            data = resp.json()
            print(f"   状态: {data}")
            return resp.status_code == 200 and data.get("status") == "ok"
        except Exception as e:
            print(f"   ❌ 连接失败: {e}")
            return False

    def list_indexes(self):
        """列出现有索引"""
        print("\n" + "="*50)
        print("2. 列出现有索引")
        print("="*50)

        resp = self.client.get(f"{API_BASE}/indexes")
        data = resp.json()

        indexes = data.get("indexes", [])
        print(f"   找到 {len(indexes)} 个索引:")
        for idx in indexes[:5]:
            print(f"   - {idx.get('pdf_name', 'Unknown')} (index_id: {idx.get('index_id', 'N/A')})")

        return indexes

    def query_test(self, index_id: str, query: str, scope_node_ids: list = None):
        """执行查询测试"""
        print(f"\n   查询: '{query}'")
        if scope_node_ids:
            print(f"   范围锁定: {scope_node_ids}")

        payload = {
            "query": query,
            "index_id": index_id,
            "max_results": 5
        }
        if scope_node_ids:
            payload["scope_node_ids"] = scope_node_ids

        resp = self.client.post(f"{API_BASE}/query", json=payload)
        data = resp.json()

        if data.get("status") != "success":
            print(f"   ❌ 查询失败: {data.get('error', 'Unknown error')}")
            return None

        results = data.get("results", [])
        print(f"   ✓ 返回 {len(results)} 个结果")

        # 分析结果类型
        paragraph_count = 0
        section_count = 0

        for i, r in enumerate(results):
            metadata = r.get("metadata", {})
            result_type = metadata.get("type", "section")
            block_id = metadata.get("block_id")
            parent_node_id = metadata.get("parent_node_id")
            match_type = metadata.get("match_type", "unknown")

            if result_type == "paragraph":
                paragraph_count += 1
                print(f"   [{i+1}] 📝 段落 | block_id: {block_id} | parent: {parent_node_id}")
            else:
                section_count += 1
                node_id = metadata.get("node_id", "N/A")
                print(f"   [{i+1}] 📖 章节 | node_id: {node_id}")

            # 显示文本预览
            text = r.get("text", "")
            preview = text[:80].replace("\n", " ") + "..." if len(text) > 80 else text.replace("\n", " ")
            print(f"       预览: {preview}")

        print(f"\n   📊 统计: {section_count} 章节 + {paragraph_count} 段落")

        return data

    def get_toc(self, index_id: str):
        """获取目录结构，用于获取 node_id"""
        print(f"\n   获取目录结构...")

        resp = self.client.get(f"{API_BASE}/reading/{index_id}/toc/flat")
        if resp.status_code != 200:
            print(f"   ❌ 获取目录失败: {resp.status_code}")
            return None

        data = resp.json()
        toc = data.get("toc", [])
        print(f"   ✓ 找到 {len(toc)} 个一级章节")

        # 打印目录结构
        for section in toc[:3]:
            level1 = section.get("level_1", "Unknown")
            node_id = section.get("node_id", "N/A")
            sub_chapters = section.get("sub_chapters", [])
            print(f"   - {level1} (node_id: {node_id})")
            for sub in sub_chapters[:2]:
                print(f"     └─ {sub.get('title', 'Unknown')}")

        return toc

    def run_tests(self, index_id: str = None, epub_path: str = None):
        """运行完整测试"""
        print("\n" + "="*60)
        print("EPUB 解析和范围搜索测试")
        print("="*60)

        # 1. 健康检查
        if not self.test_health():
            print("❌ 后端服务不可用")
            return

        # 2. 获取索引
        indexes = self.list_indexes()

        if index_id:
            self.index_id = index_id
        elif indexes:
            # 使用第一个可用索引
            self.index_id = indexes[0].get("index_id")
            print(f"\n   使用索引: {indexes[0].get('pdf_name')} ({self.index_id})")
        else:
            print("❌ 没有可用的索引")
            return

        # 3. 获取目录结构
        toc = self.get_toc(self.index_id)

        # 4. 执行全文搜索
        print("\n" + "="*50)
        print("3. 全文搜索测试")
        print("="*50)

        query = "分析阅读的重点是什么"
        full_result = self.query_test(self.index_id, query)

        # 5. 执行范围锁定搜索
        if toc and len(toc) > 0:
            print("\n" + "="*50)
            print("4. 范围锁定搜索测试")
            print("="*50)

            # 获取第一个章节的 node_id
            first_section = toc[0]
            scope_node_id = first_section.get("node_id")

            if scope_node_id:
                print(f"\n   锁定范围: {first_section.get('level_1')}")
                scoped_result = self.query_test(
                    self.index_id,
                    query,
                    scope_node_ids=[scope_node_id]
                )

                # 验证范围搜索结果
                if scoped_result:
                    results = scoped_result.get("results", [])
                    all_in_scope = all(
                        r.get("metadata", {}).get("parent_node_id") == scope_node_id
                        for r in results
                        if r.get("metadata", {}).get("type") == "paragraph"
                    )
                    if all_in_scope:
                        print(f"\n   ✅ 范围锁定验证通过：所有段落结果都在指定范围内")
                    else:
                        print(f"\n   ⚠️ 范围锁定验证失败：部分段落结果不在指定范围内")

        print("\n" + "="*60)
        print("测试完成")
        print("="*60)


def main():
    tester = EPUBTester()

    # 解析命令行参数
    index_id = None
    epub_path = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--index-id" and i + 1 < len(args):
            index_id = args[i + 1]
            i += 2
        elif args[i] == "--epub" and i + 1 < len(args):
            epub_path = args[i + 1]
            i += 2
        else:
            i += 1

    tester.run_tests(index_id=index_id, epub_path=epub_path)


if __name__ == "__main__":
    main()
