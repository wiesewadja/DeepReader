#!/usr/bin/env python3
"""
DeepReader 后端 API 全接口测试脚本

测试所有 backend-api.md 中定义的接口
"""

import requests
import json
import time
import sys
from pathlib import Path
from datetime import datetime

API_BASE = "http://localhost:6088/api"
HEALTH_URL = "http://localhost:6088/health"
LOG_FILE = Path(__file__).parent / "test_results" / f"api_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"


class APITester:
    def __init__(self):
        self.session = requests.Session()
        self.results = []
        self.index_id = None
        self.test_epub_path = "/Users/lizhao/workspace/DeepReader/backend/data/uploads/如何阅读一本书.epub"

        # 确保日志目录存在
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    def log(self, message: str, level: str = "INFO"):
        """记录日志"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_line = f"[{timestamp}] [{level}] {message}"
        print(log_line)
        self.results.append(log_line)

    def write_report(self):
        """写入测试报告"""
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write(f"# DeepReader API 测试报告\n\n")
            f.write(f"**测试时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"**API 基础 URL**: {API_BASE}\n\n")
            f.write("---\n\n")
            f.write("## 测试日志\n\n```\n")
            f.write("\n".join(self.results))
            f.write("\n```\n")

        print(f"\n测试报告已保存到: {LOG_FILE}")

    def test_api(self, name: str, method: str, url: str, **kwargs) -> dict:
        """测试 API 接口"""
        self.log(f"\n### {name}")
        self.log(f"请求: {method} {url}")

        if "json" in kwargs:
            self.log(f"参数: {json.dumps(kwargs['json'], ensure_ascii=False)[:200]}")

        try:
            start_time = time.time()
            resp = self.session.request(method, url, timeout=60, **kwargs)
            elapsed = (time.time() - start_time) * 1000

            self.log(f"状态码: {resp.status_code} (耗时: {elapsed:.0f}ms)")

            try:
                data = resp.json()
                self.log(f"响应: {json.dumps(data, ensure_ascii=False)[:300]}...")
            except:
                data = {"raw_text": resp.text[:500]}
                self.log(f"响应(非JSON): {resp.text[:200]}")

            if resp.status_code in [200, 201]:
                self.log(f"结果: PASS", level="PASS")
            else:
                self.log(f"结果: FAIL (状态码非2xx)", level="FAIL")

            return {
                "status": resp.status_code,
                "data": data,
                "elapsed_ms": elapsed
            }

        except Exception as e:
            self.log(f"结果: ERROR - {e}", level="ERROR")
            return {"status": -1, "error": str(e)}

    # ============================================================
    # 1. 健康检查
    # ============================================================

    def test_health(self):
        """测试健康检查"""
        self.log("\n" + "="*60)
        self.log("## 1. 健康检查")
        self.log("="*60)

        result = self.test_api(
            "GET /health - 健康检查",
            "GET",
            HEALTH_URL
        )
        return result.get("status") == 200

    # ============================================================
    # 2. 索引管理 API
    # ============================================================

    def test_list_indexes(self):
        """测试列出索引"""
        self.log("\n" + "="*60)
        self.log("## 2. 索引管理 API")
        self.log("="*60)

        result = self.test_api(
            "GET /api/indexes - 列出所有索引",
            "GET",
            f"{API_BASE}/indexes"
        )

        if result.get("status") == 200:
            indexes = result.get("data", {}).get("indexes", [])
            if indexes:
                self.index_id = indexes[0].get("index_id") or indexes[0].get("id")
                self.log(f"使用索引: {self.index_id}")

        return result

    def test_get_index(self):
        """测试获取索引详情"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            f"GET /api/indexes/{{index_id}} - 获取索引详情",
            "GET",
            f"{API_BASE}/indexes/{self.index_id}"
        )

    def test_query(self):
        """测试搜索"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "POST /api/query - 搜索文档",
            "POST",
            f"{API_BASE}/query",
            json={
                "query": "分析阅读的重点是什么",
                "index_id": self.index_id,
                "max_results": 3
            }
        )

    def test_query_with_scope(self):
        """测试范围锁定搜索"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "POST /api/query - 范围锁定搜索",
            "POST",
            f"{API_BASE}/query",
            json={
                "query": "阅读的方法",
                "index_id": self.index_id,
                "max_results": 3,
                "scope_node_ids": ["0010"]
            }
        )

    def test_export_index(self):
        """测试导出索引"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "GET /api/export/{index_id} - 导出索引(Markdown)",
            "GET",
            f"{API_BASE}/export/{self.index_id}"
        )

    def test_get_cover(self):
        """测试获取封面"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "GET /api/export/{index_id}/cover - 获取封面",
            "GET",
            f"{API_BASE}/export/{self.index_id}/cover"
        )

    def test_list_tasks(self):
        """测试列出任务"""
        return self.test_api(
            "GET /api/tasks - 列出所有任务",
            "GET",
            f"{API_BASE}/tasks"
        )

    def test_markdown_mapping(self):
        """测试保存 Markdown 映射"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "POST /api/markdown-mapping/{index_id} - 保存映射",
            "POST",
            f"{API_BASE}/markdown-mapping/{self.index_id}",
            json={
                "file_mapping": {
                    "0001": "book/chapter1.md",
                    "0002": "book/chapter2.md"
                }
            }
        )

    def test_agent_query(self):
        """测试 Agent 查询"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "POST /api/agent/query - Agent查询",
            "POST",
            f"{API_BASE}/agent/query",
            json={
                "query": "这本书讲了什么",
                "index_id": self.index_id,
                "mode": "fast"
            }
        )

    # ============================================================
    # 3. 阅读进度 API
    # ============================================================

    def test_reading_toc(self):
        """测试获取目录"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        self.log("\n" + "="*60)
        self.log("## 3. 阅读进度 API")
        self.log("="*60)

        return self.test_api(
            "GET /api/reading/{index_id}/toc - 获取目录",
            "GET",
            f"{API_BASE}/reading/{self.index_id}/toc"
        )

    def test_reading_toc_flat(self):
        """测试获取扁平目录"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "GET /api/reading/{index_id}/toc/flat - 获取扁平目录",
            "GET",
            f"{API_BASE}/reading/{self.index_id}/toc/flat"
        )

    def test_reading_summary(self):
        """测试获取摘要"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return None

        return self.test_api(
            "GET /api/reading/{index_id}/summary - 获取摘要",
            "GET",
            f"{API_BASE}/reading/{self.index_id}/summary"
        )

    # ============================================================
    # 4. 配置管理 API
    # ============================================================

    def test_config_apis(self):
        """测试配置管理 API"""
        self.log("\n" + "="*60)
        self.log("## 4. 配置管理 API")
        self.log("="*60)

        # 获取所有配置
        self.test_api(
            "GET /api/config - 获取所有配置",
            "GET",
            f"{API_BASE}/config"
        )

        # 获取默认配置
        self.test_api(
            "GET /api/config/default - 获取默认配置",
            "GET",
            f"{API_BASE}/config/default"
        )

        # 创建配置
        self.test_api(
            "POST /api/config - 创建配置",
            "POST",
            f"{API_BASE}/config",
            json={
                "name": "test_config_key",
                "value": "test_config_value"
            }
        )

        # 更新配置
        self.test_api(
            "PUT /api/config/{name} - 更新配置",
            "PUT",
            f"{API_BASE}/config/test_config_key",
            json={"value": "updated_value"}
        )

        # 删除配置
        self.test_api(
            "DELETE /api/config/{name} - 删除配置",
            "DELETE",
            f"{API_BASE}/config/test_config_key"
        )

    # ============================================================
    # 5. 文件管理 API
    # ============================================================

    def test_file_apis(self):
        """测试文件管理 API"""
        self.log("\n" + "="*60)
        self.log("## 5. 文件管理 API")
        self.log("="*60)

        # 列出文件
        result = self.test_api(
            "GET /api/files - 列出文件",
            "GET",
            f"{API_BASE}/files"
        )

        # 获取文件详情（如果有文件）
        if result.get("status") == 200:
            files = result.get("data", {}).get("files", [])
            if files:
                file_id = files[0].get("file_id") or files[0].get("id")
                if file_id:
                    self.test_api(
                        "GET /api/files/{file_id} - 获取文件详情",
                        "GET",
                        f"{API_BASE}/files/{file_id}"
                    )

                    self.test_api(
                        "GET /api/files/{file_id}/cover - 获取文件封面",
                        "GET",
                        f"{API_BASE}/files/{file_id}/cover"
                    )

    # ============================================================
    # 6. Chat API
    # ============================================================

    def test_chat_apis(self):
        """测试 Chat API"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return

        self.log("\n" + "="*60)
        self.log("## 6. Chat API")
        self.log("="*60)

        # 列出会话
        self.test_api(
            "GET /api/chat/sessions/{index_id} - 列出会话",
            "GET",
            f"{API_BASE}/chat/sessions/{self.index_id}"
        )

        # 获取聊天历史（使用测试 session_id）
        test_session = "test_session_001"
        self.test_api(
            "GET /api/chat/history/{index_id}/{session_id} - 获取聊天历史",
            "GET",
            f"{API_BASE}/chat/history/{self.index_id}/{test_session}"
        )

    # ============================================================
    # 7. EPUB 图片 API
    # ============================================================

    def test_epub_image_api(self):
        """测试 EPUB 图片 API"""
        if not self.index_id:
            self.log("跳过: 没有可用的索引ID")
            return

        self.log("\n" + "="*60)
        self.log("## 7. EPUB 图片 API")
        self.log("="*60)

        # 尝试获取一个图片（可能不存在）
        self.test_api(
            "GET /api/epub-images/{index_id}/{image_name} - 获取EPUB图片",
            "GET",
            f"{API_BASE}/epub-images/{self.index_id}/cover.jpg"
        )

    # ============================================================
    # 主测试流程
    # ============================================================

    def run_all_tests(self):
        """运行所有测试"""
        self.log("="*60)
        self.log("DeepReader 后端 API 全接口测试")
        self.log(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.log("="*60)

        # 1. 健康检查
        if not self.test_health():
            self.log("健康检查失败，终止测试")
            self.write_report()
            return

        # 2. 索引管理 API
        self.test_list_indexes()
        self.test_get_index()
        self.test_query()
        self.test_query_with_scope()
        self.test_export_index()
        self.test_get_cover()
        self.test_list_tasks()
        self.test_markdown_mapping()
        self.test_agent_query()

        # 3. 阅读进度 API
        self.test_reading_toc()
        self.test_reading_toc_flat()
        self.test_reading_summary()

        # 4. 配置管理 API
        self.test_config_apis()

        # 5. 文件管理 API
        self.test_file_apis()

        # 6. Chat API
        self.test_chat_apis()

        # 7. EPUB 图片 API
        self.test_epub_image_api()

        # 写入报告
        self.log("\n" + "="*60)
        self.log("测试完成!")
        self.log("="*60)
        self.write_report()


def main():
    tester = APITester()
    tester.run_all_tests()


if __name__ == "__main__":
    main()
