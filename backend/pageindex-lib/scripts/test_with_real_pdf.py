#!/usr/bin/env python3
"""
PageIndex 真实 PDF 测试脚本

本脚本使用真实的 PDF 文件对 PageIndex 库进行全面测试。

测试内容:
    1. PDF 解析 - 提取页面文本
    2. 目录检测 - 查找目录页
    3. 目录解析 - 转换为结构化数据
    4. 目录验证 - 验证目录准确性
    5. 完整索引流程 - 端到端测试

使用方法:
    # 指定 PDF 文件路径
    python scripts/test_with_real_pdf.py /path/to/your/document.pdf

    # 使用 LLM 进行完整测试
    python scripts/test_with_real_pdf.py /path/to/your/document.pdf --with-llm

    # 指定 LLM provider
    python scripts/test_with_real_pdf.py /path/to/your/document.pdf --with-llm --provider openai

注意:
    - 需要提供真实的 PDF 文件路径
    - --with-llm 选项需要配置 LLM API 密钥
    - 测试会输出详细的处理信息

作者: DeepPDF Team
创建时间: 2026-01-17
"""

import os
import sys
import asyncio
import argparse
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# 颜色输出
class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m]"


def print_success(msg: str):
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")


def print_error(msg: str):
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")


def print_info(msg: str):
    print(f"{Colors.BLUE}ℹ{Colors.RESET} {msg}")


def print_warning(msg: str):
    print(f"{Colors.YELLOW}⚠{Colors.RESET} {msg}")


def print_section(msg: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'=' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'=' * 70}{Colors.RESET}\n")


def print_subsection(msg: str):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'─' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'─' * 70}{Colors.RESET}\n")


@dataclass
class TestResult:
    """测试结果"""
    name: str
    passed: bool
    duration: float = 0.0
    details: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class PDFTestReport:
    """PDF 测试报告"""
    pdf_path: str
    file_size: int
    page_count: int
    results: List[TestResult] = field(default_factory=list)
    total_duration: float = 0.0

    def add_result(self, result: TestResult):
        self.results.append(result)

    def print_summary(self):
        """打印测试摘要"""
        print_section("测试摘要")

        # 文件信息
        print(f"{Colors.BOLD}文件信息:{Colors.RESET}")
        print(f"  路径: {self.pdf_path}")
        print(f"  大小: {self.file_size:,} 字节 ({self.file_size / 1024:.1f} KB)")
        print(f"  页数: {self.page_count}")

        # 测试结果
        passed = sum(1 for r in self.results if r.passed)
        total = len(self.results)

        print(f"\n{Colors.BOLD}测试结果:{Colors.RESET}")
        print(f"  总计: {total}")
        print(f"  通过: {Colors.GREEN}{passed}{Colors.RESET}")
        print(f"  失败: {Colors.RED}{total - passed}{Colors.RESET}")
        print(f"  成功率: {Colors.GREEN}{(passed / total * 100):.1f}%{Colors.RESET if passed == total else Colors.RED}")

        # 详细结果
        if passed < total:
            print(f"\n{Colors.BOLD}失败的测试:{Colors.RESET}")
            for result in self.results:
                if not result.passed:
                    print(f"  {Colors.RED}✗{Colors.RESET} {result.name}")
                    if result.error:
                        print(f"    {Colors.DIM}{result.error}{Colors.RESET}")

        # 时间统计
        durations = [r.duration for r in self.results]
        if durations:
            print(f"\n{Colors.BOLD}时间统计:{Colors.RESET}")
            print(f"  总耗时: {self.total_duration:.2f} 秒")
            print(f"  平均: {sum(durations) / len(durations):.2f} 秒")
            print(f"  最快: {min(durations):.2f} 秒")
            print(f"  最慢: {max(durations):.2f} 秒")


# ============================================================
# 测试函数
# ============================================================

async def test_pdf_parsing(pdf_path: str) -> TestResult:
    """测试 PDF 解析"""
    print_subsection("测试 1: PDF 解析")

    start_time = time.time()
    details = {}

    try:
        from pageindex.pdf import PDFParser

        print_info(f"解析 PDF: {pdf_path}")

        # 创建解析器
        parser = PDFParser(default_parser="pypdf")

        # 解析 PDF
        pages = parser.parse(pdf_path)

        page_count = len(pages)
        details["page_count"] = page_count

        print_success(f"成功解析 {page_count} 页")

        # 显示前几页的内容预览
        print_info("\n页面内容预览:")
        for i, (page_text, token_count) in enumerate(pages[:3]):
            preview = page_text[:100].replace("\n", " ")
            print(f"  页面 {i + 1}: {preview}... ({token_count} tokens)")

        if page_count > 3:
            print(f"  ... (还有 {page_count - 3} 页)")

        duration = time.time() - start_time
        print_success(f"解析完成 (耗时: {duration:.2f} 秒)")

        return TestResult(
            name="PDF 解析",
            passed=True,
            duration=duration,
            details=details
        )

    except Exception as e:
        duration = time.time() - start_time
        print_error(f"PDF 解析失败: {e}")
        return TestResult(
            name="PDF 解析",
            passed=False,
            duration=duration,
            error=str(e)
        )


async def test_token_counting(pdf_path: str) -> TestResult:
    """测试 Token 计数"""
    print_subsection("测试 2: Token 计数")

    start_time = time.time()
    details = {}

    try:
        from pageindex.pdf import PDFParser, count_tokens

        print_info("计算 Token 数量...")

        # 解析 PDF
        parser = PDFParser()
        pages = parser.parse(pdf_path)

        # 计算总 Token 数
        total_tokens = sum(token_count for _, token_count in pages)
        details["total_tokens"] = total_tokens

        print_success(f"总 Token 数: {total_tokens:,}")

        # 统计每页的 Token 分布
        token_counts = [token_count for _, token_count in pages]
        avg_tokens = sum(token_counts) / len(token_counts)
        min_tokens = min(token_counts)
        max_tokens = max(token_counts)

        details["avg_tokens_per_page"] = avg_tokens
        details["min_tokens"] = min_tokens
        details["max_tokens"] = max_tokens

        print(f"  平均每页: {avg_tokens:.0f} tokens")
        print(f"  最少: {min_tokens} tokens")
        print(f"  最多: {max_tokens} tokens")

        # 显示 Token 分布
        print_info("\nToken 分布:")
        for i, (page_text, token_count) in enumerate(pages[:10]):
            bar_length = int(token_count / max_tokens * 30)
            bar = "█" * bar_length
            print(f"  页 {i + 1:3d}: {token_count:4d} tokens {Colors.GREEN}{bar}{Colors.RESET}")

        if len(pages) > 10:
            print(f"  ... (还有 {len(pages) - 10} 页)")

        duration = time.time() - start_time
        print_success(f"Token 统计完成 (耗时: {duration:.2f} 秒)")

        return TestResult(
            name="Token 计数",
            passed=True,
            duration=duration,
            details=details
        )

    except Exception as e:
        duration = time.time() - start_time
        print_error(f"Token 计数失败: {e}")
        return TestResult(
            name="Token 计数",
            passed=False,
            duration=duration,
            error=str(e)
        )


async def test_toc_detection(pdf_path: str, llm_client=None) -> TestResult:
    """测试目录检测"""
    print_subsection("测试 3: 目录检测")

    start_time = time.time()
    details = {}

    try:
        from pageindex.pdf import PDFParser
        from pageindex.toc import find_toc_pages, _calculate_toc_confidence
        from pageindex.core import ConfigLoader, load_config

        print_info("检测目录页...")

        # 解析 PDF
        parser = PDFParser()
        pages = parser.parse(pdf_path)
        page_list = [(text, tokens) for text, tokens in pages]

        # 加载配置
        config = load_config()

        # 检测目录页
        toc_pages = await find_toc_pages(
            page_list,
            config,
            llm_client=llm_client
        )

        details["toc_pages_found"] = len(toc_pages)
        details["toc_page_indices"] = toc_pages

        if toc_pages:
            print_success(f"找到 {len(toc_pages)} 个目录页: {toc_pages}")

            # 显示目录内容
            print_info("\n目录内容:")
            for page_idx in toc_pages[:3]:  # 只显示前 3 页
                page_text = page_list[page_idx][0]
                preview = page_text[:300].replace("\n", " ")
                print(f"\n  页面 {page_idx + 1}:")
                print(f"  {Colors.DIM}{preview}...{Colors.RESET}")

                # 计算置信度
                confidence = _calculate_toc_confidence(page_text)
                print(f"  置信度: {Colors.GREEN if confidence > 0.7 else Colors.YELLOW}{confidence:.2f}{Colors.RESET}")

            # 提取完整目录内容
            from pageindex.toc import extract_toc_content

            toc_content = extract_toc_content(page_list, toc_pages)
            details["toc_content_length"] = len(toc_content)

            print_info(f"\n完整目录长度: {len(toc_content)} 字符")

        else:
            print_warning("未找到目录页")
            print_info("将使用 LLM 生成目录...")

        duration = time.time() - start_time
        print_success(f"目录检测完成 (耗时: {duration:.2f} 秒)")

        return TestResult(
            name="目录检测",
            passed=True,
            duration=duration,
            details=details
        )

    except Exception as e:
        duration = time.time() - start_time
        print_error(f"目录检测失败: {e}")
        import traceback
        traceback.print_exc()
        return TestResult(
            name="目录检测",
            passed=False,
            duration=duration,
            error=str(e)
        )


async def test_toc_parsing(pdf_path: str, llm_client=None) -> TestResult:
    """测试目录解析"""
    print_subsection("测试 4: 目录解析")

    start_time = time.time()
    details = {}

    try:
        from pageindex.pdf import PDFParser
        from pageindex.toc import find_toc_pages, toc_transformer
        from pageindex.core import load_config

        print_info("解析目录结构...")

        # 解析 PDF
        parser = PDFParser()
        pages = parser.parse(pdf_path)
        page_list = [(text, tokens) for text, tokens in pages]

        # 加载配置
        config = load_config()

        # 检测目录页
        toc_pages = await find_toc_pages(page_list, config, llm_client=llm_client)

        if not toc_pages:
            print_warning("未找到目录，跳过目录解析")
            return TestResult(
                name="目录解析",
                passed=True,
                duration=time.time() - start_time,
                details={"skipped": True}
            )

        # 提取目录内容
        toc_content = ""
        for page_idx in toc_pages:
            toc_content += page_list[page_idx][0]

        # 使用 LLM 解析目录
        if llm_client:
            print_info("使用 LLM 解析目录...")
            toc_json = await toc_transformer(toc_content, llm_client=llm_client)
        else:
            print_warning("未提供 LLM 客户端，跳过 LLM 解析")
            toc_json = []

        details["toc_entries"] = len(toc_json)
        details["toc_structure"] = toc_json

        if toc_json:
            print_success(f"成功解析 {len(toc_json)} 个章节")

            # 显示目录结构
            print_info("\n目录结构:")
            for entry in toc_json[:10]:  # 只显示前 10 个
                structure = entry.get("structure", "")
                title = entry.get("title", "")
                page = entry.get("physical_index", "")
                page_str = f" (页 {page})" if page else ""

                # 缩进显示层级
                level = structure.count(".") if structure else 0
                indent = "  " * level
                print(f"  {indent}{structure}. {title}{page_str}")

            if len(toc_json) > 10:
                print(f"  ... (还有 {len(toc_json) - 10} 个章节)")
        else:
            print_warning("目录解析为空")

        duration = time.time() - start_time
        print_success(f"目录解析完成 (耗时: {duration:.2f} 秒)")

        return TestResult(
            name="目录解析",
            passed=bool(toc_json),
            duration=duration,
            details=details
        )

    except Exception as e:
        duration = time.time() - start_time
        print_error(f"目录解析失败: {e}")
        import traceback
        traceback.print_exc()
        return TestResult(
            name="目录解析",
            passed=False,
            duration=duration,
            error=str(e)
        )


async def test_full_indexing(pdf_path: str, llm_client=None) -> TestResult:
    """测试完整索引流程"""
    print_subsection("测试 5: 完整索引流程")

    start_time = time.time()
    details = {}

    try:
        from pageindex import page_index
        from pageindex.core import load_config

        print_info("执行完整索引流程...")
        print_warning("这可能需要几分钟时间...")

        # 加载配置
        config = load_config()

        # 执行索引
        result = page_index(
            pdf_path=pdf_path,
            opt=config,
            llm_client=llm_client
        )

        details["doc_name"] = result.get("doc_name")
        details["structure_count"] = len(result.get("structure", []))

        print_success(f"索引完成!")

        # 显示结果
        print(f"\n{Colors.BOLD}索引结果:{Colors.RESET}")
        print(f"  文档名称: {result.get('doc_name')}")
        print(f"  章节数量: {len(result.get('structure', []))}")

        structure = result.get("structure", [])
        if structure:
            print_info("\n文档结构:")
            for item in structure[:10]:  # 只显示前 10 个
                structure_id = item.get("structure", "")
                title = item.get("title", "")
                print(f"  {structure_id}. {title}")

            if len(structure) > 10:
                print(f"  ... (还有 {len(structure) - 10} 个章节)")

        duration = time.time() - start_time
        print_success(f"完整索引完成 (耗时: {duration:.2f} 秒)")

        return TestResult(
            name="完整索引",
            passed=True,
            duration=duration,
            details=details
        )

    except Exception as e:
        duration = time.time() - start_time
        print_error(f"完整索引失败: {e}")
        import traceback
        traceback.print_exc()
        return TestResult(
            name="完整索引",
            passed=False,
            duration=duration,
            error=str(e)
        )


# ============================================================
# 主测试流程
# ============================================================

async def run_tests(pdf_path: str, with_llm: bool = False, llm_client=None) -> PDFTestReport:
    """运行所有测试"""

    # 获取文件信息
    file_path = Path(pdf_path)
    file_size = file_path.stat().st_size

    print_section(f"PageIndex 真实 PDF 测试")
    print(f"{Colors.BOLD}文件:{Colors.RESET} {pdf_path}")
    print(f"{Colors.BOLD}大小:{Colors.RESET} {file_size:,} 字节 ({file_size / 1024:.1f} KB)")
    print(f"{Colors.BOLD}LLM:{Colors.RESET} {'启用' if with_llm else '禁用'}")

    # 创建报告
    report = PDFTestReport(
        pdf_path=pdf_path,
        file_size=file_size,
        page_count=0
    )

    start_time = time.time()

    # 测试 1: PDF 解析
    result = await test_pdf_parsing(pdf_path)
    report.add_result(result)
    if result.passed:
        report.page_count = result.details.get("page_count", 0)

    # 测试 2: Token 计数
    result = await test_token_counting(pdf_path)
    report.add_result(result)

    # 测试 3-5: 需要 LLM 的测试
    if with_llm and llm_client:
        # 测试 3: 目录检测
        result = await test_toc_detection(pdf_path, llm_client)
        report.add_result(result)

        # 测试 4: 目录解析
        result = await test_toc_parsing(pdf_path, llm_client)
        report.add_result(result)

        # 测试 5: 完整索引
        result = await test_full_indexing(pdf_path, llm_client)
        report.add_result(result)
    else:
        print_warning("未启用 LLM，跳过目录检测和索引测试")
        print_info("使用 --with-llm 启用完整测试")

    report.total_duration = time.time() - start_time

    return report


async def main_async(args: argparse.Namespace):
    """异步主函数"""

    # 检查 PDF 文件
    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print_error(f"PDF 文件不存在: {args.pdf_path}")
        sys.exit(1)

    if not pdf_path.is_file():
        print_error(f"路径不是文件: {args.pdf_path}")
        sys.exit(1)

    if not pdf_path.suffix.lower() == ".pdf":
        print_warning(f"文件扩展名不是 .pdf: {args.pdf_path}")
        response = input("是否继续? (y/n): ")
        if response.lower() != "y":
            sys.exit(1)

    # 创建 LLM 客户端
    llm_client = None
    if args.with_llm:
        print_info(f"创建 LLM 客户端: {args.provider} / {args.model}")

        from pageindex.llm import get_provider, UnifiedLLM

        provider_config = {
            "type": args.provider,
            "api_key": args.api_key or os.environ.get("LLM_API_KEY"),
        }

        if args.provider != "openai":
            provider_config["base_url"] = os.environ.get("LLM_BASE_URL")

        try:
            provider = get_provider(provider_config)
            llm_client = UnifiedLLM(provider=provider, model=args.model)
            print_success("LLM 客户端创建成功\n")
        except Exception as e:
            print_error(f"LLM 客户端创建失败: {e}")
            print_info("将运行不需要 LLM 的测试")
            args.with_llm = False

    # 运行测试
    report = await run_tests(
        pdf_path=str(pdf_path),
        with_llm=args.with_llm,
        llm_client=llm_client
    )

    # 打印摘要
    report.print_summary()

    # 返回退出码
    passed = sum(1 for r in report.results if r.passed)
    total = len(report.results)

    if passed == total:
        print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 所有测试通过！{Colors.RESET}\n")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}❌ 部分测试失败{Colors.RESET}\n")
        return 1


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="PageIndex 真实 PDF 测试脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 基本测试 (不需要 LLM)
  python scripts/test_with_real_pdf.py document.pdf

  # 完整测试 (需要 LLM)
  python scripts/test_with_real_pdf.py document.pdf --with-llm

  # 使用自定义 LLM
  python scripts/test_with_real_pdf.py document.pdf --with-llm --provider openai --model gpt-4o

测试内容:
  1. PDF 解析 - 提取页面文本
  2. Token 计数 - 统计 token 数量
  3. 目录检测 - 查找目录页 (需要 LLM)
  4. 目录解析 - 解析目录结构 (需要 LLM)
  5. 完整索引 - 端到端测试 (需要 LLM)
        """
    )

    parser.add_argument(
        "pdf_path",
        help="PDF 文件路径"
    )

    parser.add_argument(
        "--with-llm",
        action="store_true",
        help="启用 LLM 相关测试"
    )

    parser.add_argument(
        "--provider",
        default="deepseek",
        help="LLM provider (default: deepseek)"
    )

    parser.add_argument(
        "--model",
        default="deepseek-chat",
        help="LLM model (default: deepseek-chat)"
    )

    parser.add_argument(
        "--api-key",
        help="LLM API key (default: from environment)"
    )

    args = parser.parse_args()

    # 运行测试
    exit_code = asyncio.run(main_async(args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
