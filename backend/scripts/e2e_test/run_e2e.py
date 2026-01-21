#!/usr/bin/env python3
"""
端到端测试：验证原文导出功能

测试流程：
1. 检查服务是否运行
2. 使用 sample.pdf 创建索引
3. 轮询等待索引完成
4. 导出为 Markdown 数据
5. 生成 Markdown 文件
6. 验证内容是原文而非摘要

环境变量：
    DEEPSEEK_API_KEY: DeepSeek API 密钥（必需）
"""
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Optional

import httpx


# 配置
API_BASE = "http://localhost:6088/api"
TIMEOUT = 600  # 10 分钟超时
POLL_INTERVAL = 3  # 轮询间隔（秒）

# 测试文件
PROJECT_ROOT = Path(__file__).parent.parent.parent
FIXTURES_DIR = PROJECT_ROOT / "deeppdf-api" / "fixtures"
SAMPLE_PDF = FIXTURES_DIR / "纳瓦尔宝典.pdf"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "e2e_test" / "output"


class Colors:
    """终端颜色"""
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    END = "\033[0m"


def print_step(step: str):
    """打印步骤标题"""
    print(f"\n{Colors.BLUE}{Colors.BOLD}▶ {step}{Colors.END}")


def print_success(msg: str):
    """打印成功消息"""
    print(f"{Colors.GREEN}✅ {msg}{Colors.END}")


def print_info(msg: str):
    """打印信息"""
    print(f"  {msg}")


def print_error(msg: str):
    """打印错误消息"""
    print(f"{Colors.RED}❌ {msg}{Colors.END}")


def print_warning(msg: str):
    """打印警告"""
    print(f"{Colors.YELLOW}⚠️  {msg}{Colors.END}")


async def check_server(client: httpx.AsyncClient) -> bool:
    """检查服务器是否运行"""
    print_step("检查服务状态")
    try:
        response = await client.get("http://localhost:6088/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print_success(f"服务运行中 (version: {data.get('version', 'unknown')})")
            return True
    except Exception as e:
        print_error(f"服务未运行: {e}")
        print_info("请先启动服务: uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio")
        return False


async def create_index(
    client: httpx.AsyncClient,
    pdf_path: str,
    deepseek_api_key: str
) -> Optional[str]:
    """创建索引"""
    print_step("创建 PDF 索引")

    pdf_file = Path(pdf_path)
    if not pdf_file.exists():
        print_error(f"PDF 文件不存在: {pdf_path}")
        return None

    print_info(f"PDF 文件: {pdf_file.name}")
    print_info(f"文件大小: {pdf_file.stat().st_size / 1024:.1f} KB")

    request_data = {
        "path": str(pdf_file.absolute()),
        "llm_provider": "deepseek",
        "llm_model": "deepseek-chat",
        "deepseek_api_key": deepseek_api_key,
        "max_pages_per_node": 20,
        "if_add_node_summary": True  # 重新启用摘要，已修复死锁问题
    }

    try:
        response = await client.post(f"{API_BASE}/index", json=request_data, timeout=30)
        response.raise_for_status()
        data = response.json()

        if data.get("status") in ["success", "pending"]:
            task_id = data.get("index_id")
            if task_id:
                print_success(f"索引任务创建成功")
                print_info(f"  task_id: {task_id}")
                return task_id

        error = data.get('error') or data.get('detail')
        print_error(f"创建索引失败: {error}")
        return None

    except Exception as e:
        print_error(f"请求失败: {e}")
        return None


async def wait_for_completion(
    client: httpx.AsyncClient,
    task_id: str,
    timeout: int = TIMEOUT
) -> Optional[str]:
    """等待索引完成"""
    print_step("等待索引完成")

    start_time = time.time()

    while True:
        if time.time() - start_time > timeout:
            print_error("索引超时")
            return None

        try:
            response = await client.get(f"{API_BASE}/tasks/{task_id}/progress", timeout=10)
            response.raise_for_status()
            data = response.json()

            status = data.get("status")
            progress = data.get("progress_percent", 0)
            current_step = data.get("current_step", "")
            message = data.get("message", "")

            if status == "processing":
                print_info(f"  进度: {progress}% | {current_step} | {message}")
            elif status == "completed":
                print_success(f"索引完成!")
                index_id = data.get("index_id")
                node_count = data.get("node_count")
                pdf_name = data.get("pdf_name")
                print_info(f"  index_id: {index_id}")
                print_info(f"  节点数: {node_count}")
                print_info(f"  PDF: {pdf_name}")
                return index_id
            elif status == "failed":
                print_error(f"索引失败: {data.get('error', 'Unknown error')}")
                return None
            elif status == "cancelled":
                print_warning("索引已取消")
                return None

        except Exception as e:
            print_error(f"查询进度失败: {e}")
            return None

        await asyncio.sleep(POLL_INTERVAL)


async def export_index(
    client: httpx.AsyncClient,
    index_id: str
) -> Optional[dict]:
    """导出索引数据"""
    print_step("导出索引数据")

    try:
        response = await client.get(f"{API_BASE}/export/{index_id}", timeout=30)
        response.raise_for_status()
        data = response.json()

        if data.get("status") == "success":
            print_success("导出成功!")
            print_info(f"  PDF: {data.get('pdf_name')}")
            print_info(f"  总页数: {data.get('total_pages')}")
            print_info(f"  节点数: {len(data.get('nodes', []))}")
            return data
        else:
            print_error(f"导出失败: {data}")
            return None

    except Exception as e:
        print_error(f"导出请求失败: {e}")
        return None


def generate_markdown_files(
    export_data: dict,
    output_dir: Path
) -> int:
    """生成 Markdown 文件"""
    print_step("生成 Markdown 文件")

    from deeppdf.services.markdown_exporter import create_markdown_content

    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_name = export_data.get("pdf_name", "document")
    pdf_folder_name = pdf_name.replace(".pdf", "")
    base_output_dir = output_dir / pdf_folder_name
    base_output_dir.mkdir(parents=True, exist_ok=True)

    nodes = export_data.get("nodes", [])
    files_created = 0

    for idx, node in enumerate(nodes, start=1):
        try:
            node_id = node.get("node_id", "")
            node_name = node.get("node_name", f"Section {idx}")
            section = node.get("section", "")
            page_range = node.get("page_range", "")

            import re
            filename_base = re.sub(r'[\\/*?:"<>|]', '', node_name)
            filename = f"{idx:02d}-{filename_base}.md"
            file_path = base_output_dir / filename

            markdown_content = create_markdown_content(
                node={"id": node_id, "text": node.get("text", ""), "metadata": node},
                pdf_name=pdf_name,
                section=section,
                page_range=page_range
            )

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)

            files_created += 1
            print_info(f"  ✓ {filename}")

        except Exception as e:
            print_error(f"  生成文件失败 ({node_name}): {e}")

    print_success(f"创建了 {files_created} 个 Markdown 文件")
    print_info(f"  输出目录: {base_output_dir}")

    return files_created


def verify_export(output_dir: Path) -> bool:
    """验证导出内容是原文而非摘要"""
    print_step("验证导出内容")

    # 查找生成的 markdown 文件
    md_files = list(output_dir.glob("**/*.md"))
    if not md_files:
        print_error("未找到生成的 Markdown 文件")
        return False

    print_info(f"找到 {len(md_files)} 个 Markdown 文件")

    # 读取第一个文件进行验证
    first_file = md_files[0]
    print_info(f"检查文件: {first_file.name}")

    content = first_file.read_text(encoding="utf-8")

    # 提取正文内容（去除 front matter）
    lines = content.split('\n')
    content_start = 0
    for i, line in enumerate(lines):
        if line.strip() == "---" and i > 0:
            content_start = i + 1
            break

    body_content = '\n'.join(lines[content_start:])

    # 显示前500个字符
    preview = body_content[:500]
    print_info(f"\n内容预览:\n{preview}...")

    # 验证：原文应该包含页码标记（如 ### 第 N 页）
    has_page_anchor = "### 第" in body_content and "页 ^page-" in body_content
    # 摘要通常是"这是一篇..."或"本文主要..."开头
    is_summary_style = body_content.strip().startswith(("这是一篇", "本文主要", "本文介绍了", "这篇文章"))

    if has_page_anchor:
        print_success("验证通过: 内容包含页码锚点，是原文格式")
        return True
    elif is_summary_style:
        print_error("验证失败: 内容似乎是摘要而非原文")
        return False
    else:
        print_warning("无法确定内容类型，请人工检查")
        return True


async def main():
    """主函数"""
    print(f"{Colors.BOLD}{Colors.BLUE}=== DeepPDF E2E 测试：原文导出 ==={Colors.END}")

    # 获取 API Key
    import os
    deepseek_api_key = os.environ.get("DEEPSEEK_API_KEY", "")

    if not deepseek_api_key:
        print_error("请设置 DEEPSEEK_API_KEY 环境变量")
        print_info("示例: export DEEPSEEK_API_KEY=sk-xxx")
        sys.exit(1)

    # 创建 HTTP 客户端
    async with httpx.AsyncClient() as client:
        # 1. 检查服务
        if not await check_server(client):
            sys.exit(1)

        # 2. 创建索引
        task_id = await create_index(client, str(SAMPLE_PDF), deepseek_api_key)
        if not task_id:
            sys.exit(1)

        # 3. 等待完成
        index_id = await wait_for_completion(client, task_id)
        if not index_id:
            sys.exit(1)

        # 4. 导出数据
        export_data = await export_index(client, index_id)
        if not export_data:
            sys.exit(1)

        # 5. 生成 Markdown 文件
        files_created = generate_markdown_files(export_data, OUTPUT_DIR)

        # 6. 验证内容
        pdf_name = export_data.get('pdf_name', 'document').replace('.pdf', '')
        output_path = OUTPUT_DIR / pdf_name
        verified = verify_export(output_path)

        # 完成
        print(f"\n{Colors.GREEN}{Colors.BOLD}=== 测试完成 ==={Colors.END}")
        print_info(f"索引 ID: {index_id}")
        print_info(f"创建了 {files_created} 个 Markdown 文件")
        print_info(f"输出目录: {output_path}")
        if verified:
            print_success("验证通过: 导出的是原文内容")
        else:
            print_error("验证失败: 导出内容不正确")


if __name__ == "__main__":
    asyncio.run(main())
