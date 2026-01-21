import sys
from pathlib import Path

# 添加路径以便导入模块
sys.path.append(str(Path(__file__).parent.parent / "deeppdf-api/src"))

from deeppdf.services.markdown_exporter import _create_markdown_content

def test_anchor_generation():
    print("\n🚀 开始测试: Markdown 锚点生成逻辑")
    
    # 模拟 pageindex-lib 输出的带标签文本
    # 场景: 第5页开始 -> 第5页结束 -> 第6页开始 -> 第6页结束
    mock_text = """<physical_index_5>
这是第 5 页的内容，第一段。
这是第 5 页的内容，第二段。
<physical_index_5>

<physical_index_6>
这是第 6 页的内容。
<physical_index_6>"""

    # 模拟节点数据
    mock_node = {
        "id": "test_node",
        "text": mock_text,
        "metadata": {
            "section": "测试章节",
            "start_index": 5,
            "end_index": 6,
            "level": 1
        }
    }

    # 执行转换
    markdown = _create_markdown_content(
        node=mock_node,
        pdf_name="test.pdf",
        section="测试章节",
        page_range="5-6"
    )

    print("\n📄 生成的 Markdown 内容预览:")
    print("-" * 40)
    print(markdown)
    print("-" * 40)

    # --- 断言检查 ---
    errors = []

    # 1. 检查锚点格式
    if "### 第 5 页 ^page-5" not in markdown:
        errors.append("❌ 缺失第 5 页锚点")
    
    if "### 第 6 页 ^page-6" not in markdown:
        errors.append("❌ 缺失第 6 页锚点")

    # 2. 检查去重 (确保锚点没有重复出现)
    if markdown.count("^page-5") > 1:
        errors.append("❌ 第 5 页锚点重复出现")

    # 3. 检查残留标签 (确保原始标签被清理干净)
    if "<physical_index_" in markdown:
        errors.append("❌ 原始 <physical_index> 标签未清理干净")

    # 4. 检查页脚链接
    if "[[test.pdf#page=5]]" not in markdown:
        errors.append("❌ 页脚回溯链接错误")

    # --- 输出结果 ---
    if not errors:
        print("\n✅ 测试通过！所有逻辑符合预期。")
    else:
        print("\n🚫 测试失败，发现以下问题:")
        for err in errors:
            print(err)

if __name__ == "__main__":
    test_anchor_generation()
