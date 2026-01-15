#!/usr/bin/env python3
"""
测试环境变量是否正确传递到 Python 进程
"""
import os
import sys

def print_env_vars():
    """打印相关的环境变量"""
    print("=" * 60)
    print("环境变量检查")
    print("=" * 60)

    # LLM API 配置
    deepseek_key = os.getenv("DEEPSEEK_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")

    print(f"\n[LLM API 配置]")
    if deepseek_key:
        print(f"  ✓ DEEPSEEK_API_KEY: {deepseek_key[:8]}...{deepseek_key[-4:]}")
    else:
        print(f"  ✗ DEEPSEEK_API_KEY: (未设置)")

    if openai_key:
        print(f"  ✓ OPENAI_API_KEY: {openai_key[:8]}...{openai_key[-4:]}")
    else:
        print(f"  ✗ OPENAI_API_KEY: (未设置)")

    # PDF 索引配置
    print(f"\n[PDF 索引配置]")
    llm_provider = os.getenv("PDF_INDEX_LLM_PROVIDER", "deepseek")
    model = os.getenv("PDF_INDEX_MODEL", "deepseek-chat")
    toc_pages = os.getenv("PDF_INDEX_TOC_CHECK_PAGES", "20")
    max_pages = os.getenv("PDF_INDEX_MAX_PAGES_PER_NODE", "10")
    max_tokens = os.getenv("PDF_INDEX_MAX_TOKENS_PER_NODE", "20000")
    add_summary = os.getenv("PDF_INDEX_IF_ADD_NODE_SUMMARY", "yes")

    print(f"  PDF_INDEX_LLM_PROVIDER: {llm_provider}")
    print(f"  PDF_INDEX_MODEL: {model}")
    print(f"  PDF_INDEX_TOC_CHECK_PAGES: {toc_pages}")
    print(f"  PDF_INDEX_MAX_PAGES_PER_NODE: {max_pages}")
    print(f"  PDF_INDEX_MAX_TOKENS_PER_NODE: {max_tokens}")
    print(f"  PDF_INDEX_IF_ADD_NODE_SUMMARY: {add_summary}")

    # 检查是否有可用的 API Key
    print(f"\n[状态检查]")
    if deepseek_key or openai_key:
        print(f"  ✓ 已配置 LLM API Key")
        return True
    else:
        print(f"  ✗ 未配置 LLM API Key")
        print(f"\n  请在 Obsidian 设置中配置 API Key，或编辑 .env 文件")
        return False

if __name__ == "__main__":
    success = print_env_vars()
    sys.exit(0 if success else 1)
