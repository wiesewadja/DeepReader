#!/usr/bin/env python3
"""
中文提示词优化验证脚本

本脚本专门验证针对中文 PDF 优化的 8 个提示词的实际效果。

验证内容:
    1. 目录检测 - toc_detector_single_page
    2. 目录转换 - toc_transformer
    3. 页码提取 - toc_index_extractor
    4. 标题验证 - check_title_appearance
    5. 标题位置验证 - check_title_appearance_in_start
    6. 完整性检查 - check_if_toc_extraction_is_complete
    7. 初始化生成 - generate_toc_init
    8. 续接生成 - generate_toc_continue

作者: DeepPDF Team
创建时间: 2026-01-17
"""

import os
import sys
import asyncio
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# 颜色输出
class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

def print_success(msg: str):
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")

def print_error(msg: str):
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")

def print_info(msg: str):
    print(f"{Colors.BLUE}ℹ{Colors.RESET} {msg}")

def print_test_header(msg: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'─' * 60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'─' * 60}{Colors.RESET}\n")


# ============================================================
# 测试数据 - 中文 PDF 内容
# ============================================================

class ChineseTestData:
    """中文 PDF 测试数据集"""

    # 测试 1: 中文论文目录
    TOC_CHAPTER_1 = """
目录

摘要 .................... I
Abstract .................. II

第一章 绪论 ................ 1
  1.1 研究背景 .............. 1
  1.2 研究意义 .............. 3
  1.3 研究内容 .............. 5

第二章 相关工作 .............. 7
  2.1 国内研究现状 .......... 7
  2.2 国外研究现状 .......... 9

第三章 方法 .................. 12
  3.1 实验设计 ............. 12
  3.2 数据采集 ............. 15

第四章 结果与分析 ........... 20

第五章 结论 ................... 25

参考文献 ..................... 30
致谢 .......................... 32
"""

    # 测试 2: 中文技术文档目录
    TOC_TECH_1 = """
目录

1. 概述
   1.1 产品简介
   1.2 应用场景

2. 快速开始
   2.1 安装指南
   2.2 配置说明

3. 详细说明
   3.1 功能介绍
   3.2 API 参考
"""

    # 测试 3: 混合格式目录
    TOC_MIXED_1 = """
目　录

第一篇  概论
  第一章  背景介绍
    1.1  研究意义
    1.2  研究现状
  第二章  问题陈述

第二篇  方法
  第三章  实验设计
  第四章  数据分析
"""

    # 测试 4: 非目录内容（应该检测为 no）
    NOT_TOC_1 = """
这是一篇关于机器学习的研究论文。

本文介绍了深度学习在图像识别领域的应用。
实验结果表明该方法有效。

关键词: 机器学习, 深度学习, 图像识别
"""

    # 测试 5: 页面内容（用于标题匹配）
    PAGE_WITH_CHAPTER_1 = """
<physical_index_5>
第一章　研究背景

深度学习是机器学习的一个分支...

1.1 研究意义
本研究的主要意义在于...
"""

    # 测试 6: 页面内容（标题在开头）
    PAGE_CHAPTER_AT_START = """
<physical_index_6>
第二章 相关工作

本章将回顾国内外相关研究...
"""

    # 测试 7: 页面内容（标题不在开头）
    PAGE_CHAPTER_NOT_AT_START = """
<physical_index_7>
...continued from previous section

因此，我们需要进一步的研究。

第三章 实验设计

本章介绍实验方法...
"""

    # 测试 8: 完整文档内容（用于完整性检查）
    FULL_DOCUMENT_FOR_COMPLETENESS = """
第一章 绪论

1.1 研究背景
人工智能技术在近年来取得了显著进展...

1.2 研究意义
本研究具有重要的理论意义和应用价值...

1.3 研究内容
本文主要研究以下内容...

第二章 相关工作

2.1 国内研究现状
国内学者在这一领域做了大量工作...

2.2 国外研究现状
国外的研究主要集中在以下几个方面...

第三章 方法

3.1 实验设计
我们设计了以下实验...

3.2 数据采集
数据来源包括...

第四章 结果与分析

4.1 实验结果
实验结果表明...

4.2 分析讨论
结果分析如下...

第五章 结论

本研究得出以下结论...
"""

    # 测试 9: 无目录文档（用于生成目录）
    NO_TOC_DOCUMENT = """
<physical_index_1>
第一章 绪论

深度学习是机器学习的重要分支。本章将介绍研究背景和意义。

<physical_index_1>
1.1 研究背景

近年来，人工智能技术快速发展...

<physical_index_2>
第二章 文献综述

本章将回顾相关领域的先前研究...

<physical_index_2>
2.1 国内研究

国内学者在...

<physical_index_3>
第三章 研究方法

本章介绍本文采用的研究方法...
"""


# ============================================================
# 测试函数
# ============================================================

async def test_toc_detector(llm_client):
    """测试 1: 目录检测"""
    print_test_header("测试 1: 目录检测 (toc_detector_single_page)")

    from pageindex.page_index import toc_detector_single_page

    tests = [
        ("中文论文目录 (第一章)", ChineseTestData.TOC_CHAPTER_1, "yes"),
        ("技术文档目录 (1.1)", ChineseTestData.TOC_TECH_1, "yes"),
        ("混合格式目录 (第一篇)", ChineseTestData.TOC_MIXED_1, "yes"),
        ("非目录内容", ChineseTestData.NOT_TOC_1, "no"),
    ]

    passed = 0
    for name, content, expected in tests:
        try:
            result = await toc_detector_single_page(content, llm_client=llm_client)
            if result == expected:
                print_success(f"{name}: 检测正确 ({result})")
                passed += 1
            else:
                print_error(f"{name}: 检测错误 (期望 {expected}, 得到 {result})")
        except Exception as e:
            print_error(f"{name}: 异常 {str(e)}")

    print(f"\n结果: {passed}/{len(tests)} 通过")
    return passed == len(tests)


async def test_toc_transformer(llm_client):
    """测试 2: 目录转换"""
    print_test_header("测试 2: 目录转换 (toc_transformer)")

    from pageindex.page_index import toc_transformer

    tests = [
        ("中文论文 (第一章)", ChineseTestData.TOC_CHAPTER_1),
        ("技术文档 (1.1)", ChineseTestData.TOC_TECH_1),
        ("混合格式 (第一篇)", ChineseTestData.TOC_MIXED_1),
    ]

    passed = 0
    for name, toc_content in tests:
        try:
            result = await toc_transformer(toc_content, llm_client=llm_client)
            if isinstance(result, list) and len(result) > 0:
                print_success(f"{name}: 转换成功 ({len(result)} 个章节)")
                # 检查第一个章节的结构
                first = result[0]
                if "structure" in first and "title" in first:
                    print(f"  首章节: {first.get('structure')} - {first.get('title')}")
                passed += 1
            else:
                print_error(f"{name}: 转换失败")
        except Exception as e:
            print_error(f"{name}: 异常 {str(e)}")

    print(f"\n结果: {passed}/{len(tests)} 通过")
    return passed == len(tests)


async def test_title_appearance(llm_client):
    """测试 3-4: 标题验证"""
    print_test_header("测试 3-4: 标题验证 (check_title_appearance)")

    from pageindex.page_index import check_title_appearance

    # 模拟页面列表
    page_list = [
        (ChineseTestData.PAGE_WITH_CHAPTER_1, 500),
        (ChineseTestData.PAGE_CHAPTER_AT_START, 500),
        (ChineseTestData.PAGE_CHAPTER_NOT_AT_START, 500),
    ]

    tests = [
        ({"title": "第一章 研究背景", "physical_index": 1, "list_index": 0}, "yes"),
        ({"title": "第二章 相关工作", "physical_index": 2, "list_index": 0}, "yes"),
        ({"title": "第三章 实验设计", "physical_index": 3, "list_index": 0}, "no"),
    ]

    passed = 0
    for item, expected in tests:
        try:
            result = await check_title_appearance(item, page_list, llm_client=llm_client)
            if result.get("answer") == expected:
                print_success(f"{item['title']}: 验证正确 ({result.get('answer')})")
                passed += 1
            else:
                print_error(f"{item['title']}: 验证错误 (期望 {expected}, 得到 {result.get('answer')})")
        except Exception as e:
            print_error(f"{item['title']}: 异常 {str(e)}")

    print(f"\n结果: {passed}/{len(tests)} 通过")
    return passed == len(tests)


async def test_title_at_start(llm_client):
    """测试 5: 标题位置验证"""
    print_test_header("测试 5: 标题位置验证 (check_title_appearance_in_start)")

    from pageindex.page_index import check_title_appearance_in_start

    tests = [
        ("第二章 相关工作 (在开头)", ChineseTestData.PAGE_CHAPTER_AT_START, "yes"),
        ("第三章 实验设计 (不在开头)", ChineseTestData.PAGE_CHAPTER_NOT_AT_START, "no"),
    ]

    passed = 0
    for name, page_text, expected in tests:
        title = page_text.split('\n')[1].strip() if '\n' in page_text else page_text.split()[0]
        try:
            result = await check_title_appearance_in_start(title, page_text, llm_client=llm_client)
            if result == expected:
                print_success(f"{name}: 位置正确 ({result})")
                passed += 1
            else:
                print_error(f"{name}: 位置错误 (期望 {expected}, 得到 {result})")
        except Exception as e:
            print_error(f"{name}: 异常 {str(e)}")

    print(f"\n结果: {passed}/{len(tests)} 通过")
    return passed == len(tests)


async def test_completeness_check(llm_client):
    """测试 6: 完整性检查"""
    print_test_header("测试 6: 完整性检查 (check_if_toc_extraction_is_complete)")

    from pageindex.page_index import check_if_toc_extraction_is_complete

    # 完整的 TOC
    complete_toc = """[
    {"structure": "1", "title": "第一章 绪论"},
    {"structure": "1.1", "title": "研究背景"},
    {"structure": "1.2", "title": "研究意义"},
    {"structure": "1.3", "title": "研究内容"},
    {"structure": "2", "title": "第二章 相关工作"},
    {"structure": "2.1", "title": "国内研究现状"},
    {"structure": "2.2", "title": "国外研究现状"},
    {"structure": "3", "title": "第三章 方法"}
]"""

    # 不完整的 TOC (缺少第二章)
    incomplete_toc = """[
    {"structure": "1", "title": "第一章 绪论"},
    {"structure": "1.1", "title": "研究背景"},
    {"structure": "1.2", "title": "研究意义"},
    {"structure": "3", "title": "第三章 方法"}
]"""

    tests = [
        ("完整目录", ChineseTestData.FULL_DOCUMENT_FOR_COMPLETENESS, complete_toc, "yes"),
        ("不完整目录", ChineseTestData.FULL_DOCUMENT_FOR_COMPLETENESS, incomplete_toc, "no"),
    ]

    passed = 0
    for name, doc, toc, expected in tests:
        try:
            result = await check_if_toc_extraction_is_complete(doc, toc, llm_client=llm_client)
            if result == expected:
                print_success(f"{name}: 检查正确 ({result})")
                passed += 1
            else:
                print_error(f"{name}: 检查错误 (期望 {expected}, 得到 {result})")
        except Exception as e:
            print_error(f"{name}: 异常 {str(e)}")

    print(f"\n结果: {passed}/{len(tests)} 通过")
    return passed == len(tests)


async def test_generate_toc_init(llm_client):
    """测试 7: 初始化生成目录"""
    print_test_header("测试 7: 初始化生成目录 (generate_toc_init)")

    from pageindex.page_index import generate_toc_init

    try:
        result = await generate_toc_init(ChineseTestData.NO_TOC_DOCUMENT, llm_client=llm_client)
        if isinstance(result, list) and len(result) > 0:
            print_success(f"生成成功: {len(result)} 个章节")
            for item in result[:3]:  # 只显示前 3 个
                print(f"  - {item.get('structure')}: {item.get('title')}")
            return True
        else:
            print_error("生成失败: 返回格式不正确")
            return False
    except Exception as e:
        print_error(f"生成异常: {str(e)}")
        return False


async def test_all(llm_client):
    """运行所有测试"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}中文提示词优化验证测试{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")

    tests = [
        ("目录检测", test_toc_detector),
        ("目录转换", test_toc_transformer),
        ("标题验证", test_title_appearance),
        ("标题位置验证", test_title_at_start),
        ("完整性检查", test_completeness_check),
        ("初始化生成", test_generate_toc_init),
    ]

    results = []

    for test_name, test_func in tests:
        try:
            passed = await test_func(llm_client)
            results.append((test_name, passed))
        except Exception as e:
            print_error(f"{test_name} 测试异常: {e}")
            results.append((test_name, False))

    # 打印总结
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}测试总结{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")

    total_tests = len(results)
    passed_tests = sum(1 for _, passed in results if passed)

    for test_name, passed in results:
        if passed:
            print_success(f"{test_name}: 通过")
        else:
            print_error(f"{test_name}: 失败")

    print(f"\n总计: {Colors.BOLD}{total_tests}{Colors.RESET} 个测试")
    print(f"通过: {Colors.GREEN}{Colors.BOLD}{passed_tests}{Colors.RESET} 个")
    print(f"失败: {Colors.RED}{Colors.BOLD}{total_tests - passed_tests}{Colors.RESET} 个")

    if passed_tests == total_tests:
        print(f"\n{Colors.GREEN}{Colors.BOLD}所有测试通过！✓{Colors.RESET}\n")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}部分测试失败！{Colors.RESET}\n")
        return 1


# ============================================================
# 主入口
# ============================================================

async def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="验证中文提示词优化效果")
    parser.add_argument("--provider", default="deepseek", help="LLM provider (default: deepseek)")
    parser.add_argument("--model", default="deepseek-chat", help="LLM model (default: deepseek-chat)")
    parser.add_argument("--api-key", help="LLM API key (default: from config)")

    args = parser.parse_args()

    # 创建 LLM 客户端
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

        # 运行所有测试
        exit_code = await test_all(llm_client)
        sys.exit(exit_code)

    except Exception as e:
        print_error(f"LLM 客户端创建失败: {e}")
        print_info("请检查:")
        print("  1. API key 是否正确")
        print("  2. 网络连接是否正常")
        print("  3. LLM 服务是否可用")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
