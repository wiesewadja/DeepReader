#!/usr/bin/env python3
"""
PageIndex 功能演示脚本
演示 PageIndex 核心功能，使用 mock 避免真实的 LLM API 调用
"""
import sys
import os

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from pageindex.utils import (
    count_tokens,
    extract_json,
    convert_physical_index_to_int,
    convert_page_to_int,
    list_to_tree,
    add_preface_if_needed,
    get_pdf_name,
    ConfigLoader,
    print_json,
)


def demo_token_counting():
    """演示 token 计数功能"""
    print("\n" + "="*60)
    print("1. Token 计数演示")
    print("="*60)

    text = "This is a sample text for counting tokens using tiktoken."
    count = count_tokens(text, model="gpt-4o")
    print(f"文本: {text}")
    print(f"Token 数量: {count}")


def demo_json_extraction():
    """演示 JSON 提取功能"""
    print("\n" + "="*60)
    print("2. JSON 提取演示")
    print("="*60)

    test_cases = [
        ('{"key": "value"}', "简单 JSON"),
        ('```json\n{"answer": "yes"}\n```', "带代码块的 JSON"),
        ('{"key": None, "key2": "value"}', "包含 None 的 JSON"),
    ]

    for content, desc in test_cases:
        result = extract_json(content)
        print(f"\n{desc}:")
        print(f"  输入: {content}")
        print(f"  输出: {result}")


def demo_index_conversion():
    """演示索引转换功能"""
    print("\n" + "="*60)
    print("3. 索引转换演示")
    print("="*60)

    # physical_index 转换
    print("\n物理索引转换:")
    data = [
        {"title": "Chapter 1", "physical_index": "<physical_index_5>"},
        {"title": "Chapter 2", "physical_index": "physical_index_10"},
        {"title": "Chapter 3", "physical_index": 15},
    ]
    print("  转换前:", data)
    convert_physical_index_to_int(data)
    print("  转换后:", data)

    # page 转换
    print("\n页码转换:")
    data2 = [
        {"title": "Chapter 1", "page": "1"},
        {"title": "Chapter 2", "page": "2"},
    ]
    print("  转换前:", data2)
    convert_page_to_int(data2)
    print("  转换后:", data2)


def demo_tree_conversion():
    """演示树结构转换"""
    print("\n" + "="*60)
    print("4. 树结构转换演示")
    print("="*60)

    flat_list = [
        {
            "structure": "1",
            "title": "Chapter 1: Introduction",
            "start_index": 1,
            "end_index": 5,
        },
        {
            "structure": "1.1",
            "title": "Section 1.1: Background",
            "start_index": 2,
            "end_index": 3,
        },
        {
            "structure": "1.2",
            "title": "Section 1.2: Motivation",
            "start_index": 4,
            "end_index": 5,
        },
        {
            "structure": "2",
            "title": "Chapter 2: Methods",
            "start_index": 6,
            "end_index": 10,
        },
    ]

    print("\n扁平结构:")
    print_json(flat_list)

    tree = list_to_tree(flat_list)
    print("\n树状结构:")
    print_json(tree)


def demo_preface_handling():
    """演示前言处理"""
    print("\n" + "="*60)
    print("5. 前言处理演示")
    print("="*60)

    # 需要添加前言的情况
    data1 = [
        {"structure": "1", "title": "Chapter 1", "physical_index": 3},
    ]
    print("\n原始 (physical_index > 1):")
    print(f"  {data1}")
    result1 = add_preface_if_needed(data1)
    print("处理后:")
    print(f"  {result1}")

    # 不需要添加前言的情况
    data2 = [
        {"structure": "1", "title": "Chapter 1", "physical_index": 1},
    ]
    print("\n原始 (physical_index == 1):")
    print(f"  {data2}")
    result2 = add_preface_if_needed(data2)
    print("处理后:")
    print(f"  {result2}")


def demo_config_loading():
    """演示配置加载"""
    print("\n" + "="*60)
    print("6. 配置加载演示")
    print("="*60)

    loader = ConfigLoader()

    print("\n默认配置:")
    default_config = loader.load()
    print(f"  模型: {default_config.model}")
    print(f"  TOC 检查页数: {default_config.toc_check_page_num}")
    print(f"  每节点最大页数: {default_config.max_page_num_each_node}")
    print(f"  每节点最大 token 数: {default_config.max_token_num_each_node}")

    print("\n用户配置覆盖:")
    user_config = loader.load({
        'model': 'gpt-3.5-turbo',
        'max_page_num_each_node': 20
    })
    print(f"  模型: {user_config.model}")
    print(f"  每节点最大页数: {user_config.max_page_num_each_node}")


def demo_complete_workflow():
    """演示完整工作流程"""
    print("\n" + "="*60)
    print("7. 完整工作流程演示")
    print("="*60)

    print("\n模拟从 PDF 提取的目录结构:")
    toc_data = [
        {"structure": "1", "title": "Introduction", "physical_index": "<physical_index_3>", "page": "1"},
        {"structure": "1.1", "title": "Background", "physical_index": "<physical_index_4>", "page": "2"},
        {"structure": "2", "title": "Methods", "physical_index": "<physical_index_6>", "page": "3"},
    ]

    print_json(toc_data)

    # 步骤 1: 转换物理索引
    print("\n步骤 1: 转换物理索引为整数")
    convert_physical_index_to_int(toc_data)
    print_json(toc_data)

    # 步骤 2: 转换页码
    print("\n步骤 2: 转换页码为整数")
    convert_page_to_int(toc_data)
    print_json(toc_data)

    # 步骤 3: 添加前言（如果需要）
    print("\n步骤 3: 添加前言（如果需要）")
    toc_data = add_preface_if_needed(toc_data)
    print_json(toc_data)

    print("\n✓ PageIndex 核心功能演示完成！")
    print("\n注意: 完整的 PDF 索引功能需要:")
    print("  1. OpenAI API 密钥 (设置 CHATGPT_API_KEY 环境变量)")
    print("  2. 真实的 PDF 文件")
    print("  3. 运行 page_index() 函数")


def main():
    """主函数"""
    print("\n" + "="*60)
    print("PageIndex 功能演示")
    print("="*60)
    print("\n此脚本演示 PageIndex 的核心功能，无需 LLM API 调用")

    demo_token_counting()
    demo_json_extraction()
    demo_index_conversion()
    demo_tree_conversion()
    demo_preface_handling()
    demo_config_loading()
    demo_complete_workflow()

    print("\n" + "="*60)
    print("演示完成！")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
