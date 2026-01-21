"""
Markdown 内容生成服务

注意：此模块只负责生成 Markdown 内容字符串，不涉及文件写入。
文件写入应由前端（Obsidian 插件）在用户本地完成。
"""
import re
from typing import Dict, Any


def _sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    清理文件名，移除或替换特殊字符

    Args:
        name: 原始文件名
        max_length: 最大长度

    Returns:
        清理后的文件名
    """
    # 替换特殊字符
    name = name.replace("/", "-")
    name = name.replace(":", "-")
    name = name.replace("?", "")
    name = name.replace("*", "")
    name = name.replace('"', "")
    name = name.replace("<", "")
    name = name.replace(">", "")
    name = name.replace("|", "")
    name = name.replace("\\", "-")

    # 移除多余的空格和破折号
    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'-+', '-', name)
    name = name.strip(' -')

    # 截断过长的文件名
    if len(name) > max_length:
        name = name[:max_length].strip(' -')

    return name


def create_markdown_content(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str
) -> str:
    """
    创建 Markdown 文件内容

    将节点数据转换为 Obsidian 兼容的 Markdown 格式，包含：
    - YAML Front Matter（含 node_id 用于搜索跳转）
    - 页码锚点 (^page-N)
    - 来源链接 ([[pdf.pdf#page=N]])

    Args:
        node: 节点数据，包含：
            - id: 节点 ID
            - text: 节点文本内容（含 <physical_index_N> 标记）
            - metadata: 元数据（start_index, level 等）
        pdf_name: PDF 文件名
        section: 章节路径/标题
        page_range: 页码范围（如 "1-5"）

    Returns:
        Markdown 内容字符串

    前端使用示例:
        >>> # 前端在生成文件时，添加 filepath 到 front matter
        >>> filepath = "DeepPDF/sample/01-Chapter 1.md"
        >>> markdown = create_markdown_content(node, pdf_name, section, page_range)
        >>> # 在第一个 --- 后插入 filepath
        >>> markdown = markdown.replace('---\\n', f'---\\nfilepath: {filepath}\\n', 1)

    Example:
        >>> node = {
        ...     "id": "node_1",
        ...     "text": "<physical_index_5>\\nContent\\n<physical_index_5>",
        ...     "metadata": {"start_index": 5, "level": 1}
        ... }
        >>> md = create_markdown_content(
        ...     node=node,
        ...     pdf_name="sample.pdf",
        ...     section="Chapter 1",
        ...     page_range="5-6"
        ... )
        >>> print(md)
        ---
        pdf_name: sample.pdf
        node_id: node_1
        section: Chapter 1
        page_range: 5-6
        level: 1
        tags: [DeepPDF, sample.pdf]
        ---

        # Chapter 1

        ### 第 5 页 ^page-5

        Content

        ---
        **来源**: [[sample.pdf#page=5]] (第 5-6 页)
    """
    node_id = node.get("id", "")
    text = node.get("text", "")
    metadata = node.get("metadata", {})
    start_page = metadata.get("start_index", "?")

    # --- 解析物理页码标记 ---
    # 输入格式: <physical_index_5>\n页面内容\n<physical_index_5>
    # 输出格式: ### 第 5 页 ^page-5\n页面内容

    # 1. 移除结束标记
    text = text.strip()
    text = re.sub(r'<physical_index_\d+>\s*$', '', text)
    text = re.sub(r'<physical_index_\d+>\s*\n', '\n', text)

    # 2. 替换开始标记为 Obsidian 锚点
    def replace_page_tag(match):
        page_num = match.group(1)
        return f"\n\n### 第 {page_num} 页 ^page-{page_num}\n\n"

    text = re.sub(r'<(?:physical|start)_index_(\d+)>', replace_page_tag, text)
    text = re.sub(r'<end_index_\d+>', '', text)

    # 3. 清理多余空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()

    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
tags: [DeepPDF, {pdf_name}]
---

"""

    # 创建标题
    title = f"# {section}\n\n"

    # 内容
    content = text + "\n\n"

    # 添加来源信息（精确跳转到起始页）
    footer_link = f"[[{pdf_name}]]"
    if str(start_page).isdigit():
        footer_link = f"[[{pdf_name}#page={start_page}]]"

    footer = f"""---
**来源**: {footer_link} (第 {page_range} 页)
"""

    return front_matter + title + content + footer


# 向后兼容：保留旧名称
_create_markdown_content = create_markdown_content
