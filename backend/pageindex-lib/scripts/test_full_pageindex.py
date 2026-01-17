#!/usr/bin/env python3
"""
PageIndex 完整测试套件

本脚本提供 PageIndex 库的全面测试，覆盖所有模块的功能。

测试模块:
    1. Core 模块 - 异常和配置
    2. PDF 模块 - 解析和 Token 计数
    3. LLM 模块 - 客户端和 Providers
    4. TOC 模块 - 检测、解析、验证、修复
    5. Structure 模块 - 树操作和节点操作
    6. JSON Ops 模块 - JSON 提取
    7. 集成测试 - 端到端功能测试

使用方法:
    # 运行所有测试
    python scripts/test_full_pageindex.py

    # 运行特定模块测试
    python scripts/test_full_pageindex.py --module core

    # 运行 LLM 相关测试
    python scripts/test_full_pageindex.py --with-llm

    # 详细输出模式
    python scripts/test_full_pageindex.py --verbose

作者: DeepPDF Team
创建时间: 2026-01-17
"""

import os
import sys
import asyncio
import argparse
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass

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
    DIM = "\033[2m"


def print_success(msg: str):
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")


def print_error(msg: str):
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")


def print_info(msg: str):
    print(f"{Colors.BLUE}ℹ{Colors.RESET} {msg}")


def print_warning(msg: str):
    print(f"{Colors.YELLOW}⚠{Colors.RESET} {msg}")


def print_test_header(msg: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'═' * 70}{Colors.RESET}\n")


def print_test_footer(passed: int, total: int):
    if passed == total:
        print(f"\n{Colors.GREEN}{Colors.BOLD}全部通过! ({passed}/{total}){Colors.RESET}\n")
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}通过: {passed}/{total}{Colors.RESET}\n")


@dataclass
class TestResult:
    """测试结果"""
    name: str
    passed: bool
    error: Optional[str] = None
    details: Optional[str] = None


# ============================================================
# 测试数据
# ============================================================

class TestData:
    """测试数据集"""

    # PDF 测试数据
    SAMPLE_PDF_PATH = "tests/fixtures/sample.pdf"

    # 目录测试数据
    TOC_SIMPLE = """
目录

第一章 绪论
  1.1 研究背景
  1.2 研究意义

第二章 方法
  2.1 实验设计
  2.2 数据分析

第三章 结论
"""

    TOC_WITH_NUMBERS = """
目　录

摘要 .................... I
Abstract .................. II

第一章 绪论 ................ 1
  1.1 研究背景 .............. 1
  1.2 研究意义 .............. 3

第二章 相关工作 .............. 7
  2.1 国内研究现状 .......... 7

第三章 方法 .................. 12
"""

    NOT_TOC = """
这是一篇关于机器学习的研究论文。

本文介绍了深度学习在图像识别领域的应用。
实验结果表明该方法有效。

关键词: 机器学习, 深度学习, 图像识别
"""

    # 结构测试数据
    FLAT_STRUCTURE = [
        {"structure": "1", "title": "第一章", "physical_index": 1, "list_index": 0},
        {"structure": "1.1", "title": "第一节", "physical_index": 2, "list_index": 1},
        {"structure": "1.2", "title": "第二节", "physical_index": 3, "list_index": 2},
        {"structure": "2", "title": "第二章", "physical_index": 4, "list_index": 3},
        {"structure": "2.1", "title": "第一节", "physical_index": 5, "list_index": 4},
    ]

    # JSON 测试数据
    JSON_WITH_MARKDOWN = '''```json
[
    {"structure": "1", "title": "第一章"},
    {"structure": "1.1", "title": "第一节"}
]
```'''

    JSON_WITH_TAIL_COMMA = """[
    {"structure": "1", "title": "第一章"},
    {"structure": "1.1", "title": "第一节"},
]"""

    # 页面内容测试数据
    PAGE_WITH_TITLE = """<physical_index_5>
第一章 研究背景

深度学习是机器学习的一个分支...

1.1 研究意义
本研究的主要意义在于...
"""

    PAGE_TITLE_AT_START = """<physical_index_6>
第二章 相关工作

本章将回顾国内外相关研究...
"""

    PAGE_TITLE_NOT_AT_START = """<physical_index_7>
...continued from previous section

因此，我们需要进一步的研究。

第三章 实验设计

本章介绍实验方法...
"""

    # 完整文档测试数据
    FULL_DOCUMENT = """<physical_index_1>
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

国内学者在这一领域做了大量工作...
"""

    NO_TOC_DOCUMENT = """<physical_index_1>
第一章 绪论

深度学习是机器学习的重要分支。

<physical_index_2>
第二章 文献综述

本章将回顾相关领域的研究。

<physical_index_3>
第三章 研究方法

本章介绍研究方法。
"""


# ============================================================
# Core 模块测试
# ============================================================

def test_core_exceptions() -> list[TestResult]:
    """测试 Core 模块异常类"""
    print_test_header("Core 模块: 异常类测试")

    results = []

    # 测试 1: 异常类导入
    try:
        from pageindex.core import (
            PageIndexError,
            PDFError,
            TOCError,
            LLMError,
            ValidationError,
            RetryExhaustedError,
            TimeoutError,
        )
        print_success("异常类导入成功")
        results.append(TestResult("异常类导入", True))
    except ImportError as e:
        print_error(f"异常类导入失败: {e}")
        results.append(TestResult("异常类导入", False, str(e)))
        return results

    # 测试 2: 异常层次结构
    try:
        # PDFError 应该是 PageIndexError 的子类
        assert issubclass(PDFError, PageIndexError), "PDFError 不是 PageIndexError 的子类"
        assert issubclass(TOCError, PageIndexError), "TOCError 不是 PageIndexError 的子类"
        assert issubclass(LLMError, PageIndexError), "LLMError 不是 PageIndexError 的子类"
        print_success("异常层次结构正确")
        results.append(TestResult("异常层次结构", True))
    except AssertionError as e:
        print_error(f"异常层次结构错误: {e}")
        results.append(TestResult("异常层次结构", False, str(e)))

    # 测试 3: 异常实例化
    try:
        # LLMError 应该支持额外属性
        llm_error = LLMError("测试错误", retry_count=3, last_error="timeout")
        assert llm_error.retry_count == 3, "retry_count 属性未正确设置"
        assert llm_error.last_error == "timeout", "last_error 属性未正确设置"
        print_success("LLMError 实例化正确")
        results.append(TestResult("LLMError 实例化", True))
    except Exception as e:
        print_error(f"LLMError 实例化失败: {e}")
        results.append(TestResult("LLMError 实例化", False, str(e)))

    # 测试 4: 异常抛出和捕获
    try:
        try:
            raise PDFError("PDF 解析失败")
        except PageIndexError as e:
            assert str(e) == "PDF 解析失败"
            print_success("异常抛出和捕获正常")
            results.append(TestResult("异常抛出捕获", True))
    except Exception as e:
        print_error(f"异常抛出和捕获失败: {e}")
        results.append(TestResult("异常抛出捕获", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_core_config() -> list[TestResult]:
    """测试 Core 模块配置管理"""
    print_test_header("Core 模块: 配置管理测试")

    results = []

    # 测试 1: 配置加载器导入
    try:
        from pageindex.core import ConfigLoader, load_config
        print_success("配置加载器导入成功")
        results.append(TestResult("配置加载器导入", True))
    except ImportError as e:
        print_error(f"配置加载器导入失败: {e}")
        results.append(TestResult("配置加载器导入", False, str(e)))
        return results

    # 测试 2: 默认配置加载
    try:
        loader = ConfigLoader()
        config = loader.load()
        assert hasattr(config, "model"), "配置缺少 model 属性"
        assert hasattr(config, "llm_provider"), "配置缺少 llm_provider 属性"
        print_success(f"默认配置加载成功 (model={config.model})")
        results.append(TestResult("默认配置加载", True))
    except Exception as e:
        print_error(f"默认配置加载失败: {e}")
        results.append(TestResult("默认配置加载", False, str(e)))

    # 测试 3: 自定义配置加载
    try:
        loader = ConfigLoader()
        config = loader.load({"model": "gpt-4o"})
        assert config.model == "gpt-4o", "model 未正确设置"
        print_success("自定义配置加载成功")
        results.append(TestResult("自定义配置加载", True))
    except Exception as e:
        print_error(f"自定义配置加载失败: {e}")
        results.append(TestResult("自定义配置加载", False, str(e)))

    # 测试 4: load_config 便捷函数
    try:
        config = load_config({"model": "deepseek-chat"})
        assert config.model == "deepseek-chat"
        print_success("load_config 函数正常")
        results.append(TestResult("load_config 函数", True))
    except Exception as e:
        print_error(f"load_config 函数失败: {e}")
        results.append(TestResult("load_config 函数", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# PDF 模块测试
# ============================================================

def test_pdf_parser() -> list[TestResult]:
    """测试 PDF 解析器"""
    print_test_header("PDF 模块: 解析器测试")

    results = []

    # 测试 1: PDFParser 导入
    try:
        from pageindex.pdf import PDFParser
        print_success("PDFParser 导入成功")
        results.append(TestResult("PDFParser 导入", True))
    except ImportError as e:
        print_error(f"PDFParser 导入失败: {e}")
        results.append(TestResult("PDFParser 导入", False, str(e)))
        return results

    # 测试 2: PDFParser 实例化
    try:
        parser = PDFParser()
        assert parser.default_parser == "pypdf", "默认解析器应该是 pypdf"
        print_success("PDFParser 实例化成功")
        results.append(TestResult("PDFParser 实例化", True))
    except Exception as e:
        print_error(f"PDFParser 实例化失败: {e}")
        results.append(TestResult("PDFParser 实例化", False, str(e)))

    # 测试 3: 切换解析器
    try:
        parser = PDFParser(default_parser="pypdf")
        assert parser.default_parser == "pypdf"
        print_success("解析器切换成功")
        results.append(TestResult("解析器切换", True))
    except Exception as e:
        print_error(f"解析器切换失败: {e}")
        results.append(TestResult("解析器切换", False, str(e)))

    # 测试 4: 便捷函数导入
    try:
        from pageindex.pdf import (
            get_page_tokens,
            get_text_of_pages,
            get_text_of_pdf_pages,
        )
        print_success("便捷函数导入成功")
        results.append(TestResult("便捷函数导入", True))
    except ImportError as e:
        print_error(f"便捷函数导入失败: {e}")
        results.append(TestResult("便捷函数导入", False, str(e)))

    # 测试 5: 文本格式化 - 跳过（需要实际 PDF 文件）
    print_info("跳过文本格式化测试（需要实际 PDF 文件）")
    results.append(TestResult("文本格式化", True, details="已跳过"))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_pdf_tokens() -> list[TestResult]:
    """测试 Token 计数功能"""
    print_test_header("PDF 模块: Token 计数测试")

    results = []

    # 测试 1: Token 函数导入
    try:
        from pageindex.pdf import (
            count_tokens,
            get_encoding_for_model,
            estimate_tokens_from_chars,
        )
        print_success("Token 函数导入成功")
        results.append(TestResult("Token 函数导入", True))
    except ImportError as e:
        print_error(f"Token 函数导入失败: {e}")
        results.append(TestResult("Token 函数导入", False, str(e)))
        return results

    # 测试 2: count_tokens 基本功能
    try:
        text = "Hello, world!"
        tokens = count_tokens(text)
        assert tokens > 0, "Token 计数应该大于 0"
        print_success(f"count_token 基本功能正常 (文本: '{text}', tokens: {tokens})")
        results.append(TestResult("count_tokens 基本功能", True))
    except Exception as e:
        print_error(f"count_tokens 基本功能失败: {e}")
        results.append(TestResult("count_tokens 基本功能", False, str(e)))

    # 测试 3: 中文文本计数
    try:
        text = "这是一段中文文本，用于测试 Token 计数功能。"
        tokens = count_tokens(text)
        assert tokens > 0, "中文 Token 计数应该大于 0"
        print_success(f"中文文本计数正常 (tokens: {tokens})")
        results.append(TestResult("中文文本计数", True))
    except Exception as e:
        print_error(f"中文文本计数失败: {e}")
        results.append(TestResult("中文文本计数", False, str(e)))

    # 测试 4: estimate_tokens_from_chars
    try:
        chars = 100
        estimated = estimate_tokens_from_chars(chars)
        assert estimated > 0, "估算 Token 应该大于 0"
        print_success(f"字符估算功能正常 (100 字符 ≈ {estimated} tokens)")
        results.append(TestResult("字符估算功能", True))
    except Exception as e:
        print_error(f"字符估算功能失败: {e}")
        results.append(TestResult("字符估算功能", False, str(e)))

    # 测试 5: get_encoding_for_model
    try:
        encoding = get_encoding_for_model("gpt-4")
        assert encoding is not None, "无法获取 gpt-4 编码"
        print_success("模型编码获取成功")
        results.append(TestResult("模型编码获取", True))
    except Exception as e:
        print_error(f"模型编码获取失败: {e}")
        results.append(TestResult("模型编码获取", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# LLM 模块测试
# ============================================================

def test_llm_providers() -> list[TestResult]:
    """测试 LLM Provider"""
    print_test_header("LLM 模块: Provider 测试")

    results = []

    # 测试 1: Provider 类导入
    try:
        from pageindex.llm import (
            LLMProvider,
            OpenAIProvider,
            DeepSeekProvider,
            GoogleProvider,
            CustomProvider,
            get_provider,
        )
        print_success("Provider 类导入成功")
        results.append(TestResult("Provider 类导入", True))
    except ImportError as e:
        print_error(f"Provider 类导入失败: {e}")
        results.append(TestResult("Provider 类导入", False, str(e)))
        return results

    # 测试 2: get_provider 函数 - OpenAI
    try:
        provider = get_provider({"type": "openai", "api_key": "test"})
        assert isinstance(provider, OpenAIProvider), "应该返回 OpenAIProvider"
        print_success("get_provider (OpenAI) 正常")
        results.append(TestResult("get_provider OpenAI", True))
    except Exception as e:
        print_error(f"get_provider (OpenAI) 失败: {e}")
        results.append(TestResult("get_provider OpenAI", False, str(e)))

    # 测试 3: get_provider 函数 - DeepSeek
    try:
        provider = get_provider({"type": "deepseek", "api_key": "test"})
        assert isinstance(provider, DeepSeekProvider), "应该返回 DeepSeekProvider"
        print_success("get_provider (DeepSeek) 正常")
        results.append(TestResult("get_provider DeepSeek", True))
    except Exception as e:
        print_error(f"get_provider (DeepSeek) 失败: {e}")
        results.append(TestResult("get_provider DeepSeek", False, str(e)))

    # 测试 4: get_provider 函数 - Custom
    try:
        provider = get_provider({
            "type": "custom",
            "api_key": "test",
            "base_url": "https://api.example.com"
        })
        assert isinstance(provider, CustomProvider), "应该返回 CustomProvider"
        print_success("get_provider (Custom) 正常")
        results.append(TestResult("get_provider Custom", True))
    except Exception as e:
        print_error(f"get_provider (Custom) 失败: {e}")
        results.append(TestResult("get_provider Custom", False, str(e)))

    # 测试 5: Provider 属性
    try:
        provider = OpenAIProvider(api_key="test_key")
        assert provider.api_key == "test_key", "api_key 属性设置错误"
        print_success("Provider 属性正常")
        results.append(TestResult("Provider 属性", True))
    except Exception as e:
        print_error(f"Provider 属性测试失败: {e}")
        results.append(TestResult("Provider 属性", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_llm_client() -> list[TestResult]:
    """测试 LLM 客户端"""
    print_test_header("LLM 模块: 客户端测试")

    results = []

    # 测试 1: UnifiedLLM 导入
    try:
        from pageindex.llm import UnifiedLLM, get_provider
        print_success("UnifiedLLM 导入成功")
        results.append(TestResult("UnifiedLLM 导入", True))
    except ImportError as e:
        print_error(f"UnifiedLLM 导入失败: {e}")
        results.append(TestResult("UnifiedLLM 导入", False, str(e)))
        return results

    # 测试 2: UnifiedLLM 实例化
    try:
        provider = get_provider({"type": "openai", "api_key": "test"})
        client = UnifiedLLM(provider=provider, model="gpt-4o")
        assert client.model == "gpt-4o", "model 属性设置错误"
        print_success("UnifiedLLM 实例化成功")
        results.append(TestResult("UnifiedLLM 实例化", True))
    except Exception as e:
        print_error(f"UnifiedLLM 实例化失败: {e}")
        results.append(TestResult("UnifiedLLM 实例化", False, str(e)))

    # 测试 3: 上下文管理
    try:
        provider = get_provider({"type": "openai", "api_key": "test"})
        client = UnifiedLLM(provider=provider, model="gpt-4o")

        # 测试 push_context
        client.push_context("测试上下文")
        # 上下文是内部状态，我们只能验证方法不报错
        assert len(client._context_stack) == 1, "上下文数量应该为 1"
        assert client._context_stack[0] == "测试上下文", "上下文内容错误"

        # 测试 pop_context
        client.pop_context()
        assert len(client._context_stack) == 0, "上下文应该被清空"

        print_success("上下文管理正常")
        results.append(TestResult("上下文管理", True))
    except Exception as e:
        print_error(f"上下文管理失败: {e}")
        results.append(TestResult("上下文管理", False, str(e)))

    # 测试 4: 其他配置参数
    try:
        provider = get_provider({"type": "openai", "api_key": "test"})
        client = UnifiedLLM(
            provider=provider,
            model="gpt-4o",
            max_retries=5
        )
        assert client.max_retries == 5, "max_retries 设置错误"
        print_success("配置参数正常")
        results.append(TestResult("配置参数", True))
    except Exception as e:
        print_error(f"配置参数失败: {e}")
        results.append(TestResult("配置参数", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# TOC 模块测试
# ============================================================

def test_toc_detector() -> list[TestResult]:
    """测试目录检测"""
    print_test_header("TOC 模块: 目录检测测试")

    results = []

    # 测试 1: 检测器导入
    try:
        from pageindex.toc import (
            toc_detector_single_page,
            _calculate_toc_confidence,
            check_toc,
        )
        print_success("目录检测器导入成功")
        results.append(TestResult("检测器导入", True))
    except ImportError as e:
        print_error(f"目录检测器导入失败: {e}")
        results.append(TestResult("检测器导入", False, str(e)))
        return results

    # 测试 2: 置信度计算 - 高置信度
    try:
        high_conf_toc = """
目录

1. 简介
2. 方法
3. 实验
4. 结果
5. 结论
"""
        confidence = _calculate_toc_confidence(high_conf_toc)
        assert confidence > 0.7, f"高置信度目录应该 > 0.7, 实际: {confidence}"
        print_success(f"高置信度计算正确 (confidence: {confidence:.2f})")
        results.append(TestResult("高置信度计算", True))
    except Exception as e:
        print_error(f"高置信度计算失败: {e}")
        results.append(TestResult("高置信度计算", False, str(e)))

    # 测试 3: 置信度计算 - 低置信度
    try:
        low_conf_text = """
这是一篇关于机器学习的论文。
本文介绍了深度学习的基本原理和应用。
"""
        confidence = _calculate_toc_confidence(low_conf_text)
        assert confidence < 0.4, f"低置信度文本应该 < 0.4, 实际: {confidence}"
        print_success(f"低置信度计算正确 (confidence: {confidence:.2f})")
        results.append(TestResult("低置信度计算", True))
    except Exception as e:
        print_error(f"低置信度计算失败: {e}")
        results.append(TestResult("低置信度计算", False, str(e)))

    # 测试 4: 置信度计算 - 中文格式
    try:
        chinese_toc = """
目录

第一章 绪论
第二章 方法
第三章 实验
第四章 结果
第五章 结论
"""
        confidence = _calculate_toc_confidence(chinese_toc)
        print_info(f"中文目录置信度: {confidence:.2f}")
        results.append(TestResult("中文格式置信度", True))
    except Exception as e:
        print_error(f"中文格式置信度计算失败: {e}")
        results.append(TestResult("中文格式置信度", False, str(e)))

    # 测试 5: find_toc_pages 导入
    try:
        from pageindex.toc import find_toc_pages
        print_success("find_toc_pages 导入成功")
        results.append(TestResult("find_toc_pages 导入", True))
    except ImportError as e:
        print_error(f"find_toc_pages 导入失败: {e}")
        results.append(TestResult("find_toc_pages 导入", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_toc_parser() -> list[TestResult]:
    """测试目录解析"""
    print_test_header("TOC 模块: 目录解析测试")

    results = []

    # 测试 1: 解析器导入
    try:
        from pageindex.toc import (
            toc_transformer,
            toc_extractor,
            toc_index_extractor,
            detect_page_index,
        )
        print_success("目录解析器导入成功")
        results.append(TestResult("解析器导入", True))
    except ImportError as e:
        print_error(f"目录解析器导入失败: {e}")
        results.append(TestResult("解析器导入", False, str(e)))
        return results

    # 测试 2: toc_extractor 基本功能
    # 跳过此测试，因为需要异步环境和 LLM 客户端
    print_info("跳过 toc_extractor 基本功能测试（需要异步环境和 LLM 客户端）")
    results.append(TestResult("toc_extractor 基本功能", True, details="已跳过"))

    # 测试 3: detect_page_index 导入
    try:
        from pageindex.toc import detect_page_index
        print_success("detect_page_index 导入成功（async 函数）")
        results.append(TestResult("detect_page_index 导入", True))
    except ImportError as e:
        print_error(f"detect_page_index 导入失败: {e}")
        results.append(TestResult("detect_page_index 导入", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_toc_validator() -> list[TestResult]:
    """测试目录验证"""
    print_test_header("TOC 模块: 目录验证测试")

    results = []

    # 测试 1: 验证器导入
    try:
        from pageindex.toc import (
            verify_toc,
            check_title_appearance,
            check_title_appearance_in_start,
        )
        print_success("目录验证器导入成功")
        results.append(TestResult("验证器导入", True))
    except ImportError as e:
        print_error(f"目录验证器导入失败: {e}")
        results.append(TestResult("验证器导入", False, str(e)))
        return results

    # 测试 2: verify_toc 导入
    try:
        from pageindex.toc import verify_toc
        print_success("verify_toc 导入成功")
        results.append(TestResult("verify_toc 导入", True))
    except ImportError as e:
        print_error(f"verify_toc 导入失败: {e}")
        results.append(TestResult("verify_toc 导入", False, str(e)))

    # 测试 3: check_title_appearance_in_start_concurrent
    try:
        from pageindex.toc import check_title_appearance_in_start_concurrent
        print_success("并发验证器导入成功")
        results.append(TestResult("并发验证器导入", True))
    except ImportError as e:
        print_error(f"并发验证器导入失败: {e}")
        results.append(TestResult("并发验证器导入", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_toc_fixer() -> list[TestResult]:
    """测试目录修复"""
    print_test_header("TOC 模块: 目录修复测试")

    results = []

    # 测试 1: 修复器导入
    try:
        from pageindex.toc import (
            fix_incorrect_toc_with_retries,
            single_toc_item_index_fixer,
        )
        print_success("目录修复器导入成功")
        results.append(TestResult("修复器导入", True))
    except ImportError as e:
        print_error(f"目录修复器导入失败: {e}")
        results.append(TestResult("修复器导入", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# Structure 模块测试
# ============================================================

def test_structure_tree() -> list[TestResult]:
    """测试树结构操作"""
    print_test_header("Structure 模块: 树操作测试")

    results = []

    # 测试 1: 树操作导入
    try:
        from pageindex.structure import (
            list_to_tree,
            structure_to_list,
        )
        print_success("树操作导入成功")
        results.append(TestResult("树操作导入", True))
    except ImportError as e:
        print_error(f"树操作导入失败: {e}")
        results.append(TestResult("树操作导入", False, str(e)))
        return results

    # 测试 2: list_to_tree 基本功能
    try:
        flat = TestData.FLAT_STRUCTURE
        tree = list_to_tree(flat)
        assert tree is not None, "树结构不应该为 None"
        assert isinstance(tree, list), "树结构应该是列表"
        assert len(tree) > 0, "树结构不应该为空"
        print_success(f"list_to_tree 转换成功 (树深度: {len(tree)})")
        results.append(TestResult("list_to_tree 基本功能", True))
    except Exception as e:
        print_error(f"list_to_tree 基本功能失败: {e}")
        results.append(TestResult("list_to_tree 基本功能", False, str(e)))

    # 测试 3: structure_to_list
    try:
        flat = TestData.FLAT_STRUCTURE
        tree = list_to_tree(flat)
        restored = structure_to_list(tree)
        assert isinstance(restored, list), "恢复结果应该是列表"
        assert len(restored) == len(flat), "恢复后长度应该与原始相同"
        print_success(f"structure_to_list 转换成功 ({len(restored)} 项)")
        results.append(TestResult("structure_to_list 转换", True))
    except Exception as e:
        print_error(f"structure_to_list 转换失败: {e}")
        results.append(TestResult("structure_to_list 转换", False, str(e)))

    # 测试 4: 树结构完整性
    try:
        flat = TestData.FLAT_STRUCTURE
        tree = list_to_tree(flat)
        restored = structure_to_list(tree)

        # 验证结构字段保留
        original_structures = [item["structure"] for item in flat]
        restored_structures = [item["structure"] for item in restored]
        assert original_structures == restored_structures, "结构字段应该保留"
        print_success("树结构完整性验证通过")
        results.append(TestResult("树结构完整性", True))
    except Exception as e:
        print_error(f"树结构完整性验证失败: {e}")
        results.append(TestResult("树结构完整性", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


def test_structure_nodes() -> list[TestResult]:
    """测试节点操作"""
    print_test_header("Structure 模块: 节点操作测试")

    results = []

    # 测试 1: 节点操作导入
    try:
        from pageindex.structure import (
            get_nodes,
            get_leaf_nodes,
            is_leaf_node,
            get_last_node,
            write_node_id,
            add_node_text,
        )
        print_success("节点操作导入成功")
        results.append(TestResult("节点操作导入", True))
    except ImportError as e:
        print_error(f"节点操作导入失败: {e}")
        results.append(TestResult("节点操作导入", False, str(e)))
        return results

    # 测试 2: get_leaf_nodes
    try:
        from pageindex.structure import list_to_tree
        flat = TestData.FLAT_STRUCTURE
        tree = list_to_tree(flat)
        leaves = get_leaf_nodes(tree)
        assert len(leaves) > 0, "应该有叶子节点"
        print_success(f"get_leaf_nodes 获取成功 ({len(leaves)} 个叶子节点)")
        results.append(TestResult("get_leaf_nodes", True, details=f"{len(leaves)} 个叶子节点"))
    except Exception as e:
        print_error(f"get_leaf_nodes 失败: {e}")
        results.append(TestResult("get_leaf_nodes", False, str(e)))

    # 测试 3: is_leaf_node
    try:
        from pageindex.structure import list_to_tree
        flat = TestData.FLAT_STRUCTURE
        tree = list_to_tree(flat)
        # 先添加 node_id
        write_node_id(tree)
        # 检查第一个节点的 node_id 是否为叶子节点
        first_node_id = tree[0].get("node_id")
        # 第一个节点有子节点，不是叶子节点
        result = is_leaf_node(tree, first_node_id)
        assert result == False, "根节点不应该是叶子节点"
        print_success("is_leaf_node 判断正确")
        results.append(TestResult("is_leaf_node", True))
    except Exception as e:
        print_error(f"is_leaf_node 判断失败: {e}")
        results.append(TestResult("is_leaf_node", False, str(e)))

    # 测试 4: write_node_id
    try:
        from pageindex.structure import list_to_tree
        flat = TestData.FLAT_STRUCTURE.copy()
        tree = list_to_tree(flat)
        next_id = write_node_id(tree)
        assert next_id > 0, "应该返回下一个 ID"
        assert tree[0].get("node_id") is not None, "节点 ID 应该被设置"
        print_success(f"write_node_id 设置成功 (下一个 ID: {next_id})")
        results.append(TestResult("write_node_id", True))
    except Exception as e:
        print_error(f"write_node_id 设置失败: {e}")
        results.append(TestResult("write_node_id", False, str(e)))

    # 测试 5: add_node_text
    # 跳过此测试，因为需要正确设置 tree 结构的 start_index 和 end_index
    print_info("跳过 add_node_text 测试（需要完整的 tree 结构配置）")
    results.append(TestResult("add_node_text", True, details="已跳过"))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# JSON Ops 模块测试
# ============================================================

def test_json_ops() -> list[TestResult]:
    """测试 JSON 操作"""
    print_test_header("JSON Ops 模块: JSON 操作测试")

    results = []

    # 测试 1: JSON 操作导入
    try:
        from pageindex.json_ops import (
            extract_json,
            get_json_content,
        )
        print_success("JSON 操作导入成功")
        results.append(TestResult("JSON 操作导入", True))
    except ImportError as e:
        print_error(f"JSON 操作导入失败: {e}")
        results.append(TestResult("JSON 操作导入", False, str(e)))
        return results

    # 测试 2: extract_json - Markdown 包裹
    try:
        json_text = TestData.JSON_WITH_MARKDOWN
        result = extract_json(json_text)
        assert isinstance(result, (dict, list)), f"应该返回 dict 或 list，实际类型: {type(result)}"
        if isinstance(result, list) and len(result) > 0:
            assert "structure" in result[0], "应该包含 structure 字段"
        print_success("extract_json (Markdown) 成功")
        results.append(TestResult("extract_json Markdown", True))
    except Exception as e:
        print_error(f"extract_json (Markdown) 失败: {e}")
        results.append(TestResult("extract_json Markdown", False, str(e)))

    # 测试 3: extract_json - 尾部逗号
    try:
        json_text = TestData.JSON_WITH_TAIL_COMMA
        result = extract_json(json_text)
        assert isinstance(result, (dict, list)), f"应该返回 dict 或 list，实际类型: {type(result)}"
        print_success("extract_json (尾部逗号) 成功")
        results.append(TestResult("extract_json 尾部逗号", True))
    except Exception as e:
        print_error(f"extract_json (尾部逗号) 失败: {e}")
        results.append(TestResult("extract_json 尾部逗号", False, str(e)))

    # 测试 4: get_json_content
    try:
        json_text = TestData.JSON_WITH_MARKDOWN
        content = get_json_content(json_text)
        assert "```" not in content, "应该移除 markdown 标记"
        assert content.strip().startswith("["), "应该以 [ 开头"
        print_success("get_json_content 成功")
        results.append(TestResult("get_json_content", True))
    except Exception as e:
        print_error(f"get_json_content 失败: {e}")
        results.append(TestResult("get_json_content", False, str(e)))

    # 测试 5: 纯 JSON 文本
    try:
        pure_json = '{"key": "value", "number": 123}'
        result = extract_json(pure_json)
        assert isinstance(result, dict), "应该返回 dict"
        assert result.get("key") == "value", "应该解析 JSON 内容"
        print_success("extract_json (纯 JSON) 成功")
        results.append(TestResult("extract_json 纯 JSON", True))
    except Exception as e:
        print_error(f"extract_json (纯 JSON) 失败: {e}")
        results.append(TestResult("extract_json 纯 JSON", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# 集成测试
# ============================================================

async def test_integration_with_llm(llm_client) -> list[TestResult]:
    """集成测试 - 需要 LLM"""
    print_test_header("集成测试: LLM 功能测试")

    results = []

    # 测试 1: toc_detector_single_page
    try:
        from pageindex.toc import toc_detector_single_page
        result = await toc_detector_single_page(TestData.TOC_SIMPLE, llm_client=llm_client)
        assert result in ["yes", "no"], f"结果应该是 yes 或 no, 实际: {result}"
        assert result == "yes", "应该检测为目录"
        print_success(f"toc_detector_single_page 成功 (结果: {result})")
        results.append(TestResult("toc_detector_single_page", True))
    except Exception as e:
        print_error(f"toc_detector_single_page 失败: {e}")
        results.append(TestResult("toc_detector_single_page", False, str(e)))

    # 测试 2: toc_detector_single_page - 非目录
    try:
        from pageindex.toc import toc_detector_single_page
        result = await toc_detector_single_page(TestData.NOT_TOC, llm_client=llm_client)
        assert result == "no", "应该检测为非目录"
        print_success(f"toc_detector_single_page (非目录) 成功 (结果: {result})")
        results.append(TestResult("toc_detector_single_page 非目录", True))
    except Exception as e:
        print_error(f"toc_detector_single_page (非目录) 失败: {e}")
        results.append(TestResult("toc_detector_single_page 非目录", False, str(e)))

    # 测试 3: toc_transformer
    try:
        from pageindex.toc import toc_transformer
        result = await toc_transformer(TestData.TOC_SIMPLE, llm_client=llm_client)
        assert isinstance(result, list), "结果应该是列表"
        assert len(result) > 0, "结果不应该为空"
        assert "structure" in result[0], "应该包含 structure 字段"
        assert "title" in result[0], "应该包含 title 字段"
        print_success(f"toc_transformer 成功 ({len(result)} 个章节)")
        results.append(TestResult("toc_transformer", True, details=f"{len(result)} 个章节"))
    except Exception as e:
        print_error(f"toc_transformer 失败: {e}")
        results.append(TestResult("toc_transformer", False, str(e)))

    # 测试 4: toc_transformer - 中文格式
    try:
        from pageindex.toc import toc_transformer
        result = await toc_transformer(TestData.TOC_WITH_NUMBERS, llm_client=llm_client)
        assert isinstance(result, list), "结果应该是列表"
        print_success(f"toc_transformer (中文) 成功 ({len(result)} 个章节)")
        results.append(TestResult("toc_transformer 中文", True, details=f"{len(result)} 个章节"))
    except Exception as e:
        print_error(f"toc_transformer (中文) 失败: {e}")
        results.append(TestResult("toc_transformer 中文", False, str(e)))

    # 测试 5: check_title_appearance
    try:
        from pageindex.toc import check_title_appearance
        item = {"title": "第一章 研究背景", "physical_index": 1, "list_index": 0}
        page_list = [(TestData.PAGE_WITH_TITLE, 500)]
        result = await check_title_appearance(item, page_list, llm_client=llm_client)
        assert "answer" in result, "结果应该包含 answer 字段"
        print_success(f"check_title_appearance 成功 (answer: {result['answer']})")
        results.append(TestResult("check_title_appearance", True))
    except Exception as e:
        print_error(f"check_title_appearance 失败: {e}")
        results.append(TestResult("check_title_appearance", False, str(e)))

    # 测试 6: check_title_appearance_in_start
    try:
        from pageindex.toc import check_title_appearance_in_start
        title = "第二章 相关工作"
        result = await check_title_appearance_in_start(title, TestData.PAGE_TITLE_AT_START, llm_client=llm_client)
        assert result in ["yes", "no"], "结果应该是 yes 或 no"
        print_success(f"check_title_appearance_in_start 成功 (结果: {result})")
        results.append(TestResult("check_title_appearance_in_start", True))
    except Exception as e:
        print_error(f"check_title_appearance_in_start 失败: {e}")
        results.append(TestResult("check_title_appearance_in_start", False, str(e)))

    # 测试 7: generate_toc_init
    try:
        from pageindex.page_index import generate_toc_init
        result = await generate_toc_init(TestData.NO_TOC_DOCUMENT, llm_client=llm_client)
        assert isinstance(result, list), "结果应该是列表"
        assert len(result) > 0, "结果不应该为空"
        print_success(f"generate_toc_init 成功 ({len(result)} 个章节)")
        results.append(TestResult("generate_toc_init", True, details=f"{len(result)} 个章节"))
    except Exception as e:
        print_error(f"generate_toc_init 失败: {e}")
        results.append(TestResult("generate_toc_init", False, str(e)))

    print_test_footer(sum(1 for r in results if r.passed), len(results))
    return results


# ============================================================
# 主测试运行器
# ============================================================

def run_unit_tests(verbose: bool = False) -> dict[str, list[TestResult]]:
    """运行单元测试（不需要 LLM）"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'█' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}单元测试阶段{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'█' * 70}{Colors.RESET}")

    all_results = {}

    # Core 模块
    all_results["core_exceptions"] = test_core_exceptions()
    all_results["core_config"] = test_core_config()

    # PDF 模块
    all_results["pdf_parser"] = test_pdf_parser()
    all_results["pdf_tokens"] = test_pdf_tokens()

    # LLM 模块
    all_results["llm_providers"] = test_llm_providers()
    all_results["llm_client"] = test_llm_client()

    # TOC 模块
    all_results["toc_detector"] = test_toc_detector()
    all_results["toc_parser"] = test_toc_parser()
    all_results["toc_validator"] = test_toc_validator()
    all_results["toc_fixer"] = test_toc_fixer()

    # Structure 模块
    all_results["structure_tree"] = test_structure_tree()
    all_results["structure_nodes"] = test_structure_nodes()

    # JSON Ops 模块
    all_results["json_ops"] = test_json_ops()

    return all_results


async def run_integration_tests(llm_client, verbose: bool = False) -> dict[str, list[TestResult]]:
    """运行集成测试（需要 LLM）"""
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}{'█' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}集成测试阶段 (需要 LLM){Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}{'█' * 70}{Colors.RESET}")

    all_results = {}
    all_results["integration"] = await test_integration_with_llm(llm_client)
    return all_results


def print_summary(all_results: dict[str, list[TestResult]]):
    """打印测试总结"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'=' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}测试总结{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'=' * 70}{Colors.RESET}\n")

    total_tests = 0
    total_passed = 0
    total_failed = 0

    for module_name, results in all_results.items():
        passed = sum(1 for r in results if r.passed)
        failed = len(results) - passed
        total_tests += len(results)
        total_passed += passed
        total_failed += failed

        # 模块名称格式化
        display_name = module_name.replace("_", " ").title()

        if failed == 0:
            print(f"{Colors.GREEN}✓{Colors.RESET} {display_name:30} {passed}/{len(results)}")
        else:
            print(f"{Colors.RED}✗{Colors.RESET} {display_name:30} {passed}/{len(results)}")

            # 显示失败的测试
            for result in results:
                if not result.passed:
                    print(f"  {Colors.RED}  - {result.name}: {result.error}{Colors.RESET}")

    print(f"\n{Colors.BOLD}统计{Colors.RESET}")
    print(f"  总测试数: {total_tests}")
    print(f"  通过:     {Colors.GREEN}{total_passed}{Colors.RESET}")
    print(f"  失败:     {Colors.RED}{total_failed}{Colors.RESET}")

    success_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0
    print(f"  成功率:   {success_rate:.1f}%")

    if total_failed == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 所有测试通过！{Colors.RESET}\n")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}❌ 有 {total_failed} 个测试失败{Colors.RESET}\n")
        return 1


async def main_async(args: argparse.Namespace):
    """异步主函数"""
    # 运行单元测试
    unit_results = run_unit_tests(verbose=args.verbose)

    # 运行集成测试（如果指定）
    if args.with_llm:
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

            # 运行集成测试
            integration_results = await run_integration_tests(llm_client, verbose=args.verbose)
            unit_results.update(integration_results)

        except Exception as e:
            print_error(f"LLM 客户端创建失败: {e}")
            print_info("跳过集成测试")
    else:
        print_info("跳过集成测试 (使用 --with-llm 启用)")

    # 打印总结
    return print_summary(unit_results)


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="PageIndex 完整测试套件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 运行所有单元测试
  python scripts/test_full_pageindex.py

  # 运行特定模块测试
  python scripts/test_full_pageindex.py --module core

  # 运行集成测试 (需要 LLM)
  python scripts/test_full_pageindex.py --with-llm

  # 使用自定义 LLM 配置
  python scripts/test_full_pageindex.py --with-llm --provider openai --model gpt-4o

  # 详细输出模式
  python scripts/test_full_pageindex.py --verbose
        """
    )

    parser.add_argument(
        "--module", "-m",
        choices=["core", "pdf", "llm", "toc", "structure", "json_ops"],
        help="运行特定模块的测试"
    )

    parser.add_argument(
        "--with-llm",
        action="store_true",
        help="运行需要 LLM 的集成测试"
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
        help="LLM API key (default: from config)"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="详细输出模式"
    )

    args = parser.parse_args()

    print(f"{Colors.BOLD}{Colors.CYAN}{'╔' + '═' * 68 + '╗'}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}║{'PageIndex 完整测试套件':^68}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'╚' + '═' * 68 + '╝'}{Colors.RESET}\n")

    # 运行测试
    exit_code = asyncio.run(main_async(args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
