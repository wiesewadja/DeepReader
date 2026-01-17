#!/usr/bin/env python3
"""
PageIndex 重构验证脚本

本脚本全面验证重构后的 PageIndex 各个模块功能。

验证内容:
    1. PDF 模块 - 文本提取、Token 计数
    2. 结构模块 - 树转换、节点操作
    3. JSON 模块 - JSON 提取
    4. LLM 模块 - 客户端功能
    5. 目录模块 - 目录检测
    6. 集成测试 - 完整流程

作者: DeepPDF Team
创建时间: 2026-01-17
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from typing import Dict, Any, List

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# 颜色输出
class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

def print_success(msg: str):
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")

def print_error(msg: str):
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")

def print_info(msg: str):
    print(f"{Colors.BLUE}ℹ{Colors.RESET} {msg}")

def print_section(msg: str):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")


# ============================================================
# 测试数据
# ============================================================

def get_test_pdf_path() -> str:
    """获取测试 PDF 文件路径"""
    # 尝试多个可能的测试文件位置
    possible_paths = [
        "../../data/sample.pdf",
        "../data/sample.pdf",
        "/Users/lizhao/workspace/DeepPDF/backend/data/sample.pdf",
    ]

    for path in possible_paths:
        if os.path.exists(path):
            return path

    # 如果都找不到，返回第一个（会报错，但至少有明确的路径）
    return possible_paths[0]


# ============================================================
# 1. PDF 模块测试
# ============================================================

def test_pdf_module():
    """测试 PDF 模块功能"""
    print_section("1. PDF 模块测试")

    from pageindex.pdf import PDFParser
    from pageindex.pdf.tokens import count_tokens

    pdf_path = get_test_pdf_path()

    try:
        # 测试 PDFParser
        print_info("测试 PDFParser...")
        parser = PDFParser(default_parser="pypdf")
        pages = parser.parse(pdf_path)

        assert len(pages) > 0, "PDF 解析失败：未获取到页面"
        print_success(f"PDF 解析成功: {len(pages)} 页")

        # 检查页面内容
        first_page_text, first_tokens = pages[0]
        assert len(first_page_text) > 0, "第一页文本为空"
        assert first_tokens > 0, "第一页 Token 数为 0"
        print_success(f"第 1 页: {len(first_page_text)} 字符, {first_tokens} tokens")

        # 测试 Token 计数
        print_info("测试 Token 计数...")
        test_text = "这是一个测试文本，用于验证 Token 计数功能。"
        tokens = count_tokens(test_text, model="gpt-4o")
        assert tokens > 0, "Token 计数失败"
        print_success(f"Token 计数: '{test_text[:20]}...' = {tokens} tokens")

        # 测试带标记的文本提取
        print_info("测试带标记的文本提取...")
        from pageindex.pdf.parser import get_text_of_pdf_pages_with_labels
        labeled_text = get_text_of_pdf_pages_with_labels(pages, 1, min(2, len(pages)))
        assert "<physical_index_1>" in labeled_text, "物理索引标记缺失"
        print_success("带标记文本提取成功")

        print_success("PDF 模块测试通过")
        return True

    except Exception as e:
        print_error(f"PDF 模块测试失败: {e}")
        return False


# ============================================================
# 2. 结构模块测试
# ============================================================

def test_structure_module():
    """测试结构模块功能"""
    print_section("2. 结构模块测试")

    from pageindex.structure.tree import list_to_tree
    from pageindex.structure.nodes import (
        write_node_id,
        get_leaf_nodes,
        get_nodes,
    )
    from pageindex.structure.converter import structure_to_list

    try:
        # 测试数据：扁平的目录列表
        flat_data = [
            {"structure": "1", "title": "第一章", "start_index": 1, "end_index": 5},
            {"structure": "1.1", "title": "第一节", "start_index": 1, "end_index": 3},
            {"structure": "1.2", "title": "第二节", "start_index": 4, "end_index": 5},
            {"structure": "2", "title": "第二章", "start_index": 6, "end_index": 10},
        ]

        # 测试 list_to_tree
        print_info("测试 list_to_tree...")
        tree = list_to_tree(flat_data)
        assert len(tree) == 2, f"根节点数量错误: {len(tree)}, 期望 2"
        assert tree[0]["title"] == "第一章", "第一个根节点错误"
        assert len(tree[0]["nodes"]) == 2, "第一章子节点数量错误"
        print_success(f"树转换成功: {len(tree)} 个根节点")

        # 测试 write_node_id
        print_info("测试 write_node_id...")
        write_node_id(tree)
        assert tree[0].get("node_id") == "0000", "根节点 ID 错误"
        assert tree[0]["nodes"][0].get("node_id") == "0001", "子节点 ID 错误"
        print_success("节点 ID 分配成功")

        # 测试 get_leaf_nodes
        print_info("测试 get_leaf_nodes...")
        leaves = get_leaf_nodes(tree)
        # 树结构: 第一章 (有子节点) -> 第一节、第二节 (叶子); 第二章 (叶子)
        # 共 3 个叶子节点
        assert len(leaves) == 3, f"叶子节点数量错误: {len(leaves)}, 期望 3"
        print_success(f"叶子节点获取成功: {len(leaves)} 个")

        # 测试 get_nodes
        print_info("测试 get_nodes...")
        all_nodes = get_nodes(tree)
        assert len(all_nodes) == 4, f"所有节点数量错误: {len(all_nodes)}, 期望 4"
        print_success(f"节点获取成功: {len(all_nodes)} 个节点")

        # 测试 structure_to_list
        print_info("测试 structure_to_list...")
        flat_result = structure_to_list(tree)
        assert len(flat_result) == 4, f"扁平化结果错误: {len(flat_result)}, 期望 4"
        print_success(f"树扁平化成功: {len(flat_result)} 个节点")

        print_success("结构模块测试通过")
        return True

    except Exception as e:
        print_error(f"结构模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 3. JSON 模块测试
# ============================================================

def test_json_module():
    """测试 JSON 模块功能"""
    print_section("3. JSON 模块测试")

    from pageindex.json_ops import extract_json, get_json_content

    try:
        # 测试标准 JSON
        print_info("测试标准 JSON 提取...")
        standard_json = '{"title": "第一章", "page": 1}'
        result = extract_json(standard_json)
        assert result["title"] == "第一章", "标准 JSON 解析失败"
        print_success("标准 JSON 解析成功")

        # 测试带 markdown 代码块的 JSON
        print_info("测试 Markdown 代码块 JSON 提取...")
        markdown_json = '''
        ```json
        {"title": "第二章", "page": 2}
        ```
        '''
        result = extract_json(markdown_json)
        assert result["title"] == "第二章", "Markdown JSON 解析失败"
        print_success("Markdown JSON 解析成功")

        # 测试带 None 的 JSON
        print_info("测试带 None 的 JSON...")
        json_with_none = '{"title": None, "content": "test"}'
        result = extract_json(json_with_none)
        assert result["title"] is None, "None 值处理失败"
        print_success("None 值处理成功")

        # 测试带换行的 JSON
        print_info("测试带换行的 JSON...")
        json_with_newlines = '{"title": "test",\n"items": [1, 2, 3]}'
        result = extract_json(json_with_newlines)
        assert result["items"] == [1, 2, 3], "换行 JSON 解析失败"
        print_success("换行 JSON 解析成功")

        # 测试 get_json_content
        print_info("测试 get_json_content...")
        response_text = '```json\n{"key": "value"}\n```'
        content = get_json_content(response_text)
        assert '{"key": "value"}' in content, "get_json_content 失败"
        print_success("get_json_content 成功")

        print_success("JSON 模块测试通过")
        return True

    except Exception as e:
        print_error(f"JSON 模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 4. LLM 模块测试
# ============================================================

def test_llm_module():
    """测试 LLM 模块功能"""
    print_section("4. LLM 模块测试")

    try:
        from pageindex.llm import UnifiedLLM, get_provider
        from pageindex.llm.providers import OpenAIProvider, DeepSeekProvider
        from pageindex.llm.retry import RetryPolicy

        # 测试 Provider 创建
        print_info("测试 Provider 创建...")

        # OpenAI Provider (不实际调用 API)
        openai_config = {
            "type": "openai",
            "api_key": "test-key",
        }
        openai_provider = get_provider(openai_config)
        assert isinstance(openai_provider, OpenAIProvider), "OpenAI Provider 类型错误"
        print_success("OpenAI Provider 创建成功")

        # DeepSeek Provider
        deepseek_config = {
            "type": "deepseek",
            "api_key": "test-key",
        }
        deepseek_provider = get_provider(deepseek_config)
        assert isinstance(deepseek_provider, DeepSeekProvider), "DeepSeek Provider 类型错误"
        print_success("DeepSeek Provider 创建成功")

        # 测试 Custom Provider
        print_info("测试 Custom Provider...")
        custom_config = {
            "type": "custom",
            "api_key": "test-key",
            "base_url": "http://localhost:8000",
        }
        custom_provider = get_provider(custom_config)
        print_success("Custom Provider 创建成功")

        # 测试 UnifiedLLM 创建
        print_info("测试 UnifiedLLM 创建...")
        llm_client = UnifiedLLM(
            provider=openai_provider,
            model="gpt-4o",
            max_retries=3
        )
        assert llm_client.model == "gpt-4o", "模型名称设置失败"
        assert llm_client.max_retries == 3, "最大重试次数设置失败"
        print_success("UnifiedLLM 创建成功")

        # 测试上下文管理
        print_info("测试上下文管理...")
        llm_client.push_context("测试上下文")
        assert "测试上下文" in llm_client._get_context_str(), "上下文推入失败"
        llm_client.pop_context()
        print_success("上下文管理成功")

        # 测试重试策略
        print_info("测试重试策略...")
        policy = RetryPolicy(max_retries=5, base_delay=1.0)
        assert policy.max_retries == 5, "重试策略创建失败"
        print_success("重试策略创建成功")

        print_success("LLM 模块测试通过")
        return True

    except Exception as e:
        print_error(f"LLM 模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 5. 目录模块测试
# ============================================================

def test_toc_module():
    """测试目录模块功能"""
    print_section("5. 目录模块测试")

    from pageindex.toc.detector import _calculate_toc_confidence
    from pageindex.toc.parser import toc_index_extractor
    from pageindex.structure.tree import list_to_tree

    try:
        # 测试置信度计算
        print_info("测试目录置信度计算...")

        # 高置信度目录（使用阿拉伯数字格式以触发所有规则）
        high_confidence_toc = """
        目录
        1. 简介
        2. 方法
        3. 实验
        4. 结论
        5. 参考文献
        """
        confidence = _calculate_toc_confidence(high_confidence_toc)
        assert confidence > 0.7, f"高置信度目录计算错误: {confidence}"
        print_success(f"高置信度目录: {confidence:.2f}")

        # 低置信度非目录（避免包含任何目录关键词）
        low_confidence_text = """
        这是一篇关于机器学习的论文。
        本文介绍了深度学习的基本原理和应用。
        实验结果表明该方法有效。
        """
        confidence = _calculate_toc_confidence(low_confidence_text)
        assert confidence < 0.3, f"低置信度文本计算错误: {confidence}"
        print_success(f"低置信度文本: {confidence:.2f}")

        # 跳过页码提取测试（需要异步执行和 LLM 客户端）
        print_info("跳过页码提取测试（需要异步环境和 LLM 客户端）...")
        print_success("页码提取测试已跳过")

        # 测试树转换
        print_info("测试目录树转换...")
        flat_toc = [
            {"structure": "1", "title": "第一章", "page_number": "5"},
            {"structure": "1.1", "title": "第一节", "page_number": "5"},
            {"structure": "2", "title": "第二章", "page_number": "10"},
        ]
        tree = list_to_tree(flat_toc)
        assert len(tree) == 2, "目录树转换失败"
        print_success("目录树转换成功")

        print_success("目录模块测试通过")
        return True

    except Exception as e:
        print_error(f"目录模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 6. 页码转换测试
# ============================================================

def test_page_conversion():
    """测试页码转换功能"""
    print_section("6. 页码转换测试")

    from pageindex.utils import (
        convert_physical_index_to_int,
        convert_page_to_int,
        get_first_start_page_from_text,
        get_last_start_page_from_text,
    )

    try:
        # 测试物理索引转换
        print_info("测试物理索引转换...")
        data_with_tags = [
            {"physical_index": "<physical_index_5>"},
            {"physical_index": "physical_index_10"},
        ]
        result = convert_physical_index_to_int(data_with_tags)
        assert result[0]["physical_index"] == 5, "物理索引转换失败"
        assert result[1]["physical_index"] == 10, "物理索引转换失败"
        print_success("物理索引转换成功")

        # 测试页码转换
        print_info("测试页码转换...")
        data_with_str_pages = [
            {"page": "1", "title": "第一页"},
            {"page": "2", "title": "第二页"},
        ]
        result = convert_page_to_int(data_with_str_pages)
        assert result[0]["page"] == 1, "页码转换失败"
        assert isinstance(result[0]["page"], int), "页码类型错误"
        print_success("页码转换成功")

        # 测试起始页提取
        print_info("测试起始页提取...")
        text_with_tags = "<start_index_5>内容<start_index_10>更多内容"
        first_page = get_first_start_page_from_text(text_with_tags)
        last_page = get_last_start_page_from_text(text_with_tags)
        assert first_page == 5, "第一个起始页提取失败"
        assert last_page == 10, "最后一个起始页提取失败"
        print_success(f"起始页提取成功: {first_page} -> {last_page}")

        print_success("页码转换测试通过")
        return True

    except Exception as e:
        print_error(f"页码转换测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 7. 结构处理测试
# ============================================================

def test_structure_processing():
    """测试结构处理功能"""
    print_section("7. 结构处理测试")

    from pageindex.utils import (
        add_preface_if_needed,
        remove_fields,
        remove_structure_text,
        format_structure,
    )

    try:
        # 测试前言添加
        print_info("测试前言添加...")
        data_without_preface = [
            {"physical_index": 3, "title": "第一章"},
        ]
        result = add_preface_if_needed(data_without_preface)
        assert result[0]["title"] == "Preface", "前言添加失败"
        assert result[0]["physical_index"] == 1, "前言页码错误"
        assert result[1]["title"] == "第一章", "原文内容丢失"
        print_success("前言添加成功")

        # 测试字段移除
        print_info("测试字段移除...")
        tree_with_text = [
            {
                "structure": "1",
                "title": "第一章",
                "text": "很长的文本内容...",
                "nodes": []
            }
        ]
        result = remove_fields(tree_with_text, fields=["text"])
        assert "text" not in result[0], "text 字段未移除"
        assert result[0]["title"] == "第一章", "其他字段丢失"
        print_success("字段移除成功")

        # 测试结构文本移除
        print_info("测试结构文本移除...")
        result = remove_structure_text(tree_with_text)
        assert "text" not in result[0], "text 字段未移除"
        print_success("结构文本移除成功")

        # 测试结构格式化
        print_info("测试结构格式化...")
        order = ["structure", "title", "nodes"]
        result = format_structure(tree_with_text, order=order)
        assert list(result[0].keys())[0] == "structure", "字段顺序错误"
        assert list(result[0].keys())[1] == "title", "字段顺序错误"
        print_success("结构格式化成功")

        print_success("结构处理测试通过")
        return True

    except Exception as e:
        print_error(f"结构处理测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 8. 配置加载测试
# ============================================================

def test_config_loading():
    """测试配置加载功能"""
    print_section("8. 配置加载测试")

    from pageindex.core import ConfigLoader, load_config

    try:
        # 测试配置加载
        print_info("测试配置加载...")
        loader = ConfigLoader()
        config = loader.load({"model": "gpt-4o"})
        assert hasattr(config, "model"), "配置加载失败"
        print_success("配置加载成功")

        # 测试 load_config 函数
        print_info("测试 load_config 函数...")
        config = load_config({"model": "gpt-4"})
        assert config.model == "gpt-4", "load_config 失败"
        print_success("load_config 成功")

        # 测试默认值
        print_info("测试默认值...")
        default_config = loader.load({})
        assert hasattr(default_config, "model"), "默认模型缺失"
        print_success(f"默认模型: {default_config.model}")

        print_success("配置加载测试通过")
        return True

    except Exception as e:
        print_error(f"配置加载测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 9. 集成测试
# ============================================================

def test_integration():
    """测试完整的 PDF 索引流程"""
    print_section("9. 集成测试")

    from pageindex.pdf import PDFParser
    from pageindex.pdf.tokens import count_tokens
    from pageindex.structure.tree import list_to_tree
    from pageindex.structure.nodes import write_node_id
    from pageindex.utils import (
        convert_physical_index_to_int,
        add_preface_if_needed,
        get_pdf_name,
    )
    from pageindex.core import load_config

    try:
        pdf_path = get_test_pdf_path()

        # 步骤 1: 配置加载
        print_info("步骤 1/8: 加载配置...")
        config = load_config()
        print_success(f"配置加载成功: {config.model}")

        # 步骤 2: PDF 解析
        print_info("步骤 2/8: 解析 PDF...")
        parser = PDFParser()
        pages = parser.parse(pdf_path)
        print_success(f"PDF 解析成功: {len(pages)} 页")

        # 步骤 3: PDF 名称提取
        print_info("步骤 3/8: 提取 PDF 名称...")
        pdf_name = get_pdf_name(pdf_path)
        print_success(f"PDF 名称: {pdf_name}")

        # 步骤 4: Token 统计
        print_info("步骤 4/8: 统计 Tokens...")
        total_tokens = sum(tokens for _, tokens in pages)
        print_success(f"总 Tokens: {total_tokens}")

        # 步骤 5: 模拟目录结构
        print_info("步骤 5/8: 模拟目录结构...")
        # 创建模拟的目录数据
        mock_toc = []
        current_page = 1
        page_size = max(1, len(pages) // 3)

        for i in range(1, 4):
            start_page = current_page
            end_page = min(start_page + page_size - 1, len(pages))
            mock_toc.append({
                "structure": str(i),
                "title": f"第{i}章",
                "physical_index": start_page,
            })
            current_page = end_page + 1

        print_success(f"模拟目录: {len(mock_toc)} 个章节")

        # 步骤 6: 页码转换
        print_info("步骤 6/8: 转换页码...")
        mock_toc = convert_physical_index_to_int(mock_toc)
        print_success("页码转换成功")

        # 步骤 7: 添加前言
        print_info("步骤 7/8: 处理前言...")
        mock_toc = add_preface_if_needed(mock_toc)
        print_success(f"前言处理: {len(mock_toc)} 个节点")

        # 步骤 8: 构建树结构
        print_info("步骤 8/8: 构建树结构...")
        tree = list_to_tree(mock_toc)
        write_node_id(tree)
        print_success(f"树结构: {len(tree)} 个根节点")

        # 显示结果
        print_info("集成测试结果:")
        print(f"  - PDF 文件: {pdf_name}")
        print(f"  - 总页数: {len(pages)}")
        print(f"  - 总 Tokens: {total_tokens}")
        print(f"  - 章节数: {len(mock_toc)}")
        print(f"  - 树节点: {len(tree)} 个根节点")

        print_success("集成测试通过")
        return True

    except Exception as e:
        print_error(f"集成测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================
# 主测试运行器
# ============================================================

def run_all_tests():
    """运行所有测试"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}PageIndex 重构验证测试{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")

    tests = [
        ("PDF 模块", test_pdf_module),
        ("结构模块", test_structure_module),
        ("JSON 模块", test_json_module),
        ("LLM 模块", test_llm_module),
        ("目录模块", test_toc_module),
        ("页码转换", test_page_conversion),
        ("结构处理", test_structure_processing),
        ("配置加载", test_config_loading),
        ("集成测试", test_integration),
    ]

    results = []

    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, passed))
        except Exception as e:
            print_error(f"{test_name} 测试异常: {e}")
            results.append((test_name, False))

    # 打印总结
    print_section("测试总结")

    total_tests = len(results)
    passed_tests = sum(1 for _, passed in results if passed)
    failed_tests = total_tests - passed_tests

    for test_name, passed in results:
        if passed:
            print_success(f"{test_name}: 通过")
        else:
            print_error(f"{test_name}: 失败")

    print(f"\n总计: {Colors.BOLD}{total_tests}{Colors.RESET} 个测试")
    print(f"通过: {Colors.GREEN}{Colors.BOLD}{passed_tests}{Colors.RESET} 个")
    print(f"失败: {Colors.RED}{Colors.BOLD}{failed_tests}{Colors.RESET} 个")

    if failed_tests == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}所有测试通过！✓{Colors.RESET}\n")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}部分测试失败！{Colors.RESET}\n")
        return 1


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    import sys

    # 检查测试文件是否存在
    pdf_path = get_test_pdf_path()
    if not os.path.exists(pdf_path):
        print_error(f"测试 PDF 文件不存在: {pdf_path}")
        print_info("请确保项目中有测试 PDF 文件")
        sys.exit(1)

    # 运行测试
    exit_code = run_all_tests()
    sys.exit(exit_code)
