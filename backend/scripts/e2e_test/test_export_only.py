#!/usr/bin/env python3
"""
测试导出功能（使用现有索引）

不需要重新索引，直接测试现有索引的导出是否包含原文
"""
import asyncio
import re
from pathlib import Path

import httpx


API_BASE = "http://localhost:6088/api"
OUTPUT_DIR = Path(__file__).parent / "output"


async def test_export(index_id: str):
    """测试指定索引的导出"""
    print(f"=== 测试导出: {index_id} ===\n")

    async with httpx.AsyncClient() as client:
        # 1. 导出索引数据
        print(f"📥 导出索引: {index_id}")
        response = await client.get(f"{API_BASE}/export/{index_id}", timeout=30)

        if response.status_code != 200:
            print(f"❌ 导出失败: {response.status_code}")
            print(f"   {response.text}")
            return

        data = response.json()
        if data.get("status") != "success":
            print(f"❌ 导出失败: {data}")
            return

        print(f"✅ 导出成功!")
        print(f"   PDF: {data['pdf_name']}")
        print(f"   总页数: {data['total_pages']}")
        print(f"   节点数: {len(data['nodes'])}")

        # 2. 检查数据结构
        print(f"\n📊 检查数据结构:")
        first_node = data['nodes'][0] if data['nodes'] else None

        if first_node:
            print(f"   第一个节点字段: {list(first_node.keys())}")
            print(f"   node_id: {first_node.get('node_id')}")
            print(f"   section: {first_node.get('section')}")
            print(f"   text 长度: {len(first_node.get('text', ''))} 字符")

            # 显示前 200 字符
            text_preview = first_node.get('text', '')[:200]
            print(f"\n📄 内容预览:")
            print(f"   {text_preview}...")

            # 检查是否是原文（包含页码标记）或摘要
            has_page_marker = "### 第" in first_node.get('text', '') and "页 ^page-" in first_node.get('text', '')
            is_summary_style = first_node.get('text', '').strip().startswith(("这是一篇", "本文主要", "本文介绍了", "这篇文章"))

            print(f"\n🔍 内容类型分析:")
            print(f"   包含页码锚点: {'是 ✓' if has_page_marker else '否 ✗'}")
            print(f"   摘要风格: {'是 ✗' if is_summary_style else '否 ✓'}")

            if has_page_marker and not is_summary_style:
                print(f"\n✅ 验证通过: 导出的是原文内容")
            elif is_summary_style:
                print(f"\n❌ 验证失败: 导出的是摘要，需要重新创建索引")
                print(f"   提示: 旧索引可能没有 original_text 字段")
            else:
                print(f"\n⚠️  无法确定，请人工检查")

        # 3. 生成 Markdown 文件（可选）
        choice = input("\n是否生成 Markdown 文件? (y/n): ")
        if choice.lower() == 'y':
            from deeppdf.services.markdown_exporter import create_markdown_content

            pdf_name = data['pdf_name']
            pdf_folder_name = pdf_name.replace(".pdf", "")
            base_output_dir = OUTPUT_DIR / pdf_folder_name
            base_output_dir.mkdir(parents=True, exist_ok=True)

            print(f"\n📝 生成 Markdown 文件到: {base_output_dir}")

            for idx, node in enumerate(data['nodes'], start=1):
                node_id = node.get("node_id", "")
                node_name = node.get("node_name", f"Section {idx}")
                section = node.get("section", "")
                page_range = node.get("page_range", "")

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

                print(f"   ✓ {filename}")

            print(f"\n✅ 完成! 输出目录: {base_output_dir.absolute()}")

            # 显示第一个文件的内容
            first_file = base_output_dir / f"01-{data['nodes'][0].get('node_name', 'Section')}.md"
            if first_file.exists():
                print(f"\n📄 第一个文件内容:")
                print("─" * 60)
                content = first_file.read_text(encoding="utf-8")
                lines = content.split('\n')
                print('\n'.join(lines[:30]))
                if len(lines) > 30:
                    print(f"\n... (共 {len(lines)} 行)")
                print("─" * 60)


async def main():
    """主函数"""
    print("=== DeepPDF 导出功能测试 ===\n")

    # 使用已完成的索引
    # idx_b02846962e21 = 纳瓦尔宝典（85个节点）- 最新创建
    test_index = "idx_b02846962e21"

    await test_export(test_index)


if __name__ == "__main__":
    asyncio.run(main())
