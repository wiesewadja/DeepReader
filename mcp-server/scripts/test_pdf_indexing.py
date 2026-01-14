#!/usr/bin/env python3
"""
DeepPDF 手动测试脚本

使用方法：
1. 安装依赖（只需执行一次）:
   pip install -e packages/pageindex -e packages/deeppdf

2. 设置 API Key:
   export OPENAI_API_KEY="sk-your-deepseek-api-key"

3. 运行测试:
   python scripts/test_pdf_indexing.py
"""
import sys
import os
import json
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional

# 直接导入（已安装包）
from deeppdf.tools.pdf_indexer import index_pdf, LLMRequiredError
from deeppdf.storage.chroma_store import ChromaStore


# ============================================================================
# 配置
# ============================================================================
TEST_CONFIG = {
    # 数据目录
    "data_dir": Path(__file__).parent.parent / "data",

    # 输出目录
    "output_dir": Path(__file__).parent.parent / "data" / "output",
}


# ============================================================================
# 工具函数
# ============================================================================
def print_section(title: str):
    """打印分节标题"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)


def print_success(message: str):
    """打印成功消息"""
    print(f"✅ {message}")


def print_info(message: str):
    """打印信息消息"""
    print(f"ℹ️  {message}")


def print_warning(message: str):
    """打印警告消息"""
    print(f"⚠️  {message}")


def print_error(message: str):
    """打印错误消息"""
    print(f"❌ {message}")


# ============================================================================
# PDF 处理函数
# ============================================================================
def find_pdfs(data_dir: Path, pattern: str = "*.pdf") -> List[Path]:
    """查找数据目录中的 PDF 文件"""
    if not data_dir.exists():
        data_dir.mkdir(parents=True, exist_ok=True)
        print_warning(f"数据目录不存在，已创建: {data_dir}")
        return []

    pdfs = list(data_dir.glob(pattern))
    print_info(f"找到 {len(pdfs)} 个 PDF 文件")
    return pdfs


def test_pdf_indexing(pdf_path: Path, storage_dir: Path, output_dir: Path) -> Dict[str, Any]:
    """
    测试 PDF 索引

    使用 PageIndex + LLM 生成章节级向量索引
    """
    print_info(f"正在索引: {pdf_path.name}")
    print(f"   文件大小: {pdf_path.stat().st_size / 1024:.1f} KB")

    try:
        # 使用 index_pdf 进行索引（需要 LLM API）
        result = index_pdf(
            pdf_path=str(pdf_path),
            storage_dir=str(storage_dir),
            require_llm=True
        )

        if result["status"] == "success":
            print_success(f"索引成功!")
            print(f"   索引 ID: {result['index_id']}")
            print(f"   节点数: {result['node_count']}")
            print(f"   索引方法: {result['indexing_method']}")

            # 查询验证
            print_info("验证向量查询...")
            store = ChromaStore(persist_directory=str(storage_dir / "chroma"))
            query_results = store.query(
                collection_name=result["index_id"],
                query_texts=["测试查询"],
                n_results=2
            )
            print_success(f"向量查询正常，返回 {len(query_results['ids'][0])} 个结果")

            return result
        else:
            print_error(f"索引失败: {result.get('error', 'Unknown error')}")
            return result

    except LLMRequiredError as e:
        print_error(f"LLM API 未配置")
        print(f"   错误: {e}")
        print()
        print("请设置 DeepSeek API Key:")
        print("  export DEEPSEEK_API_KEY=\"sk-your-deepseek-api-key\"")
        return {"status": "error", "error": str(e)}

    except Exception as e:
        print_error(f"索引异常: {e}")
        return {"status": "error", "error": str(e)}


def save_index_summary(results: List[Dict[str, Any]], output_dir: Path):
    """保存索引摘要"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_file = output_dir / "index_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print_success(f"索引摘要已保存: {summary_file}")


# ============================================================================
# 主函数
# ============================================================================
def main():
    """主函数"""
    print_section("DeepPDF PDF 索引测试")

    # 检查 LLM API 配置
    api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")
    if api_key:
        print_success(f"LLM API 已配置: {api_key[:10]}...")
    else:
        print_warning("LLM API 未配置")
        print()
        print("要使用 PageIndex 树状索引，请设置 DeepSeek API Key:")
        print("  export DEEPSEEK_API_KEY=\"sk-your-deepseek-api-key\"")
        print()
        response = input("是否继续？(y/N): ")
        if response.lower() != 'y':
            print_info("已取消")
            return

    # 查找 PDF 文件
    print_info(f"扫描目录: {TEST_CONFIG['data_dir']}")
    pdf_files = find_pdfs(TEST_CONFIG["data_dir"], "*.pdf")

    if not pdf_files:
        print_warning("未找到 PDF 文件")
        print_info(f"请将 PDF 文件放入以下目录: {TEST_CONFIG['data_dir']}")
        return

    print(f"\n发现的文件:")
    for pdf in pdf_files:
        print(f"  - {pdf.name} ({pdf.stat().st_size / 1024:.1f} KB)")

    # 创建存储目录
    storage_dir = TEST_CONFIG["data_dir"] / "test_index"
    storage_dir.mkdir(parents=True, exist_ok=True)

    # 处理每个 PDF
    results = []
    for pdf_path in pdf_files:
        print_section(f"处理: {pdf_path.name}")
        result = test_pdf_indexing(pdf_path, storage_dir, TEST_CONFIG["output_dir"])
        results.append({
            "file": pdf_path.name,
            "result": result
        })

    # 保存摘要
    if results:
        save_index_summary(results, TEST_CONFIG["output_dir"])

    # 总结
    print_section("测试完成")
    successful = sum(1 for r in results if r["result"].get("status") == "success")
    print(f"成功: {successful}/{len(results)}")
    print(f"存储目录: {storage_dir}")
    print(f"输出目录: {TEST_CONFIG['output_dir']}")


if __name__ == "__main__":
    main()
