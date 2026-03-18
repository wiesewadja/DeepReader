#!/usr/bin/env python3
"""
DeepReader Query API 详细测试脚本

重点测试：
1. 基本查询功能
2. 范围锁定 (scope_node_ids)
3. 结果类型 (section vs paragraph)
4. LLM 树搜索模式
5. 边界条件
"""

import requests
import json
import time
from datetime import datetime
from pathlib import Path

API_BASE = "http://localhost:6088/api"
LOG_FILE = Path(__file__).parent / "test_results" / f"query_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"


class QueryAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.results = []
        self.index_id = None
        self.test_queries = [
            # (查询, 描述, 预期结果类型)
            ("分析阅读的重点是什么", "语义查询", "mixed"),
            ("阅读的方法", "关键词查询", "mixed"),
            ("第一章", "章节标题查询", "section"),
            ("检视阅读", "概念查询", "mixed"),
            ("如何做笔记", "问题式查询", "mixed"),
            ("作者想要表达什么", "抽象查询", "mixed"),
        ]

        # 确保日志目录存在
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    def log(self, message: str, level: str = "INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_line = f"[{timestamp}] [{level}] {message}"
        print(log_line)
        self.results.append(log_line)

    def write_report(self):
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write(f"# DeepReader Query API 详细测试报告\n\n")
            f.write(f"**测试时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"**索引 ID**: {self.index_id}\n\n")
            f.write("---\n\n")
            f.write("## 测试日志\n\n```\n")
            f.write("\n".join(self.results))
            f.write("\n```\n")
        print(f"\n测试报告已保存到: {LOG_FILE}")

    def get_first_index(self):
        """获取第一个可用索引"""
        resp = self.session.get(f"{API_BASE}/indexes")
        if resp.status_code == 200:
            data = resp.json()
            indexes = data.get("indexes", [])
            if indexes:
                # 优先使用带 BM25 的测试索引
                for idx in indexes:
                    idx_id = idx.get("id")
                    if "bm25_test" in idx_id:
                        self.index_id = idx_id
                        break
                if not self.index_id:
                    self.index_id = indexes[0].get("id")
                self.log(f"使用索引: {self.index_id}")
                return True
        self.log("没有找到可用索引", "ERROR")
        return False

    def get_toc(self):
        """获取目录，用于范围锁定测试"""
        resp = self.session.get(f"{API_BASE}/reading/{self.index_id}/toc/flat")
        if resp.status_code == 200:
            data = resp.json()
            toc = data.get("toc", [])
            if toc:
                return [item.get("node_id") for item in toc[:5]]
        return []

    def test_query(self, name: str, query: str, **kwargs) -> dict:
        """测试查询接口"""
        self.log(f"\n### {name}")
        self.log(f"查询: '{query}'")

        params = {
            "query": query,
            "index_id": self.index_id,
            **kwargs
        }

        self.log(f"参数: {json.dumps({k: v for k, v in params.items() if k != 'query'}, ensure_ascii=False)}")

        start_time = time.time()
        resp = self.session.post(f"{API_BASE}/query", json=params)
        elapsed = (time.time() - start_time) * 1000

        self.log(f"状态码: {resp.status_code} (耗时: {elapsed:.0f}ms)")

        if resp.status_code != 200:
            self.log(f"错误: {resp.text[:200]}", "ERROR")
            return {"status": "error"}

        data = resp.json()
        results = data.get("results", [])
        search_method = data.get("search_method", "unknown")

        self.log(f"搜索方法: {search_method}")
        self.log(f"结果数量: {len(results)}")

        # 分析结果类型
        section_count = 0
        paragraph_count = 0
        for r in results:
            meta = r.get("metadata", {})
            rtype = meta.get("type", "unknown")
            if rtype == "paragraph":
                paragraph_count += 1
            else:
                section_count += 1

        self.log(f"结果类型分布: {section_count} 章节 + {paragraph_count} 段落")

        # 显示前 3 个结果的摘要
        for i, r in enumerate(results[:3]):
            meta = r.get("metadata", {})
            text = r.get("text", "")[:100]
            rtype = meta.get("type", "unknown")
            node_id = meta.get("node_id", "N/A")
            match_type = meta.get("match_type", "N/A")
            self.log(f"  结果 {i+1}: type={rtype}, match={match_type}, node_id={node_id}")
            self.log(f"         内容: {text}...")

        return data

    # ============================================================
    # 测试用例
    # ============================================================

    def test_basic_queries(self):
        """测试基本查询功能"""
        self.log("\n" + "=" * 60)
        self.log("## 1. 基本查询功能测试")
        self.log("=" * 60)

        for query, desc, expected in self.test_queries:
            self.test_query(f"基本查询: {desc}", query, max_results=5)
            time.sleep(0.5)  # 避免请求过快

    def test_scope_locking(self):
        """测试范围锁定功能"""
        self.log("\n" + "=" * 60)
        self.log("## 2. 范围锁定测试 (scope_node_ids)")
        self.log("=" * 60)

        # 获取目录中的节点 ID
        node_ids = self.get_toc()
        if not node_ids:
            self.log("跳过: 无法获取目录节点", "WARN")
            return

        self.log(f"可用节点: {node_ids}")

        # 测试单节点锁定
        if len(node_ids) >= 1:
            self.test_query(
                "单节点范围锁定",
                "阅读",
                max_results=5,
                scope_node_ids=[node_ids[0]]
            )

        # 测试多节点锁定
        if len(node_ids) >= 3:
            self.test_query(
                "多节点范围锁定",
                "阅读",
                max_results=5,
                scope_node_ids=node_ids[:3]
            )

    def test_result_types(self):
        """测试结果类型分布"""
        self.log("\n" + "=" * 60)
        self.log("## 3. 结果类型分布测试")
        self.log("=" * 60)

        # 使用多个 max_results 值测试
        for max_results in [3, 5, 10]:
            self.log(f"\n--- max_results={max_results} ---")
            data = self.test_query(
                f"结果数量测试 (max_results={max_results})",
                "阅读的方法",
                max_results=max_results
            )

            if data.get("status") != "error":
                results = data.get("results", [])
                section_count = sum(1 for r in results if r.get("metadata", {}).get("type") != "paragraph")
                paragraph_count = sum(1 for r in results if r.get("metadata", {}).get("type") == "paragraph")

                self.log(f"  实际返回: {len(results)} 个结果")
                self.log(f"  类型分布: {section_count} 章节 + {paragraph_count} 段落")

                # 验证段落占比（应该至少有一些段落）
                if paragraph_count > 0:
                    self.log(f"  ✅ 包含段落结果", "PASS")
                else:
                    self.log(f"  ⚠️ 没有段落结果", "WARN")

    def test_llm_tree_search(self):
        """测试 LLM 树搜索模式"""
        self.log("\n" + "=" * 60)
        self.log("## 4. LLM 树搜索模式测试")
        self.log("=" * 60)

        # 测试 LLM 树搜索（需要配置 API Key）
        self.test_query(
            "LLM 树搜索模式",
            "这本书的核心观点是什么",
            max_results=5,
            use_llm_tree_search=True
        )

    def test_edge_cases(self):
        """测试边界条件"""
        self.log("\n" + "=" * 60)
        self.log("## 5. 边界条件测试")
        self.log("=" * 60)

        # 空查询
        self.log("\n--- 空查询测试 ---")
        resp = self.session.post(f"{API_BASE}/query", json={
            "query": "",
            "index_id": self.index_id,
            "max_results": 5
        })
        self.log(f"状态码: {resp.status_code}")
        if resp.status_code != 200:
            self.log(f"预期错误: {resp.json().get('detail', 'unknown')}", "PASS")

        # 超长查询
        self.log("\n--- 超长查询测试 ---")
        long_query = "阅读" * 500
        self.test_query("超长查询", long_query[:500], max_results=3)

        # 特殊字符查询
        self.log("\n--- 特殊字符查询测试 ---")
        self.test_query("特殊字符查询", "阅读!@#$%^&*()", max_results=3)

        # 不存在的索引
        self.log("\n--- 不存在的索引测试 ---")
        resp = self.session.post(f"{API_BASE}/query", json={
            "query": "测试",
            "index_id": "non_existent_index",
            "max_results": 5
        })
        self.log(f"状态码: {resp.status_code}")
        if resp.status_code != 200:
            self.log(f"预期错误: {resp.json().get('detail', 'unknown')}", "PASS")

    def test_search_methods(self):
        """测试不同搜索方法的效果"""
        self.log("\n" + "=" * 60)
        self.log("## 6. 搜索方法对比测试")
        self.log("=" * 60)

        test_query = "分析阅读的规则"

        # 普通混合搜索
        self.log(f"\n--- 混合搜索 ---")
        hybrid_result = self.test_query("混合搜索", test_query, max_results=5)
        hybrid_method = hybrid_result.get("search_method", "")

        # LLM 树搜索
        self.log(f"\n--- LLM 树搜索 ---")
        llm_result = self.test_query("LLM 树搜索", test_query, max_results=5, use_llm_tree_search=True)

        # 对比结果
        self.log("\n--- 结果对比 ---")
        self.log(f"混合搜索方法: {hybrid_method}")

        if hybrid_result.get("results") and llm_result.get("results"):
            hybrid_ids = set(r.get("metadata", {}).get("node_id") for r in hybrid_result.get("results", []))
            llm_ids = set(r.get("metadata", {}).get("node_id") for r in llm_result.get("results", []))
            overlap = hybrid_ids & llm_ids
            self.log(f"结果重叠: {len(overlap)} 个共同节点")

    def run_all_tests(self):
        """运行所有测试"""
        self.log("=" * 60)
        self.log("DeepReader Query API 详细测试")
        self.log(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.log("=" * 60)

        # 获取索引
        if not self.get_first_index():
            self.write_report()
            return

        # 运行测试
        self.test_basic_queries()
        self.test_scope_locking()
        self.test_result_types()
        self.test_llm_tree_search()
        self.test_edge_cases()
        self.test_search_methods()

        # 写入报告
        self.log("\n" + "=" * 60)
        self.log("测试完成!")
        self.log("=" * 60)
        self.write_report()


def main():
    tester = QueryAPITester()
    tester.run_all_tests()


if __name__ == "__main__":
    main()
