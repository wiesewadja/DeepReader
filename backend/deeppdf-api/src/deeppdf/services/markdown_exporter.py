"""
Markdown 导出服务
将索引的 PDF 导出为分割的 Markdown 文件
"""
import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


def _sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    清理文件名,移除或替换特殊字符
    """
    name = name.replace("/", "-").replace(":", "-").replace("?", "").replace("*", "")
    name = name.replace('"', "").replace("<", "").replace(">", "").replace("|", "").replace("\\", "-")
    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'-+', '-', name)
    name = name.strip(' -')
    return name[:max_length].strip(' -') if len(name) > max_length else name


def _create_markdown_content(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str
) -> str:
    """
    创建 Markdown 文件内容
    """
    node_id = node.get("id", "")
    text = node.get("text", "")
    metadata = node.get("metadata", {})
    start_page = metadata.get("start_index", "?")
    
    # --- 核心改进：解析物理页码标记 (防止重复) ---
    seen_pages = set()
    
    def replace_page_tag(match):
        page_num = match.group(1)
        if page_num not in seen_pages:
            seen_pages.add(page_num)
            return f"\n\n### 第 {page_num} 页 ^page-{page_num}\n\n"
        else:
            return "" # 重复出现的标签直接抹除
    
    # 统一处理所有可能的标签格式
    processed_text = re.sub(r'<(?:physical|start|end)_index_(\d+)>', replace_page_tag, text)
    
    # 清理多余空行
    processed_text = re.sub(r'\n{3,}', '\n\n', processed_text).strip()
    
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
    title = f"# {section}\n\n"
    footer_link = f"[[{pdf_name}#page={start_page}]]" if str(start_page).isdigit() else f"[[{pdf_name}]]"
    footer = f"\n\n---\n**来源**: {footer_link} (第 {page_range} 页)\n"
    
    return front_matter + title + processed_text + footer


def export_pdf_to_markdown(
    index_id: str,
    storage_dir: str,
    vault_path: str,
    output_folder: str = "DeepPDF"
) -> Dict[str, Any]:
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"
        
        if not metadata_path.exists():
            return {"status": "error", "error": f"Index metadata not found: {index_id}"}
        
        with open(metadata_path, "r", encoding="utf-8") as f:
            index_metadata = json.load(f)
        
        pdf_name = index_metadata.get("pdf_name", "Unknown")
        sections = index_metadata.get("sections", [])
        
        vault_path_obj = Path(vault_path)
        pdf_folder_name = pdf_name.replace(".pdf", "").replace("/", "-")
        output_dir = vault_path_obj / output_folder / pdf_folder_name
        output_dir.mkdir(parents=True, exist_ok=True)
        
        file_mapping = {}
        files_created = 0
        
        for idx, node in enumerate(sections, start=1):
            metadata = node.get("metadata", {})
            section = metadata.get("section", f"Section {idx}")
            node_id = node.get("id", f"node_{idx}")
            node_name = metadata.get("node_name", f"Section {idx}")
            
            start_page = metadata.get("start_index", "?")
            end_page = metadata.get("end_index", "?")
            page_range = f"{start_page}-{end_page}" if start_page != end_page else str(start_page)
            
            filename = f"{idx:02d}-{node_name.replace('/', '-')}.md"
            file_path = output_dir / filename
            
            markdown_content = _create_markdown_content(node, pdf_name, section, page_range)
            
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)
            
            file_mapping[node_id] = f"{output_folder}/{pdf_folder_name}/{filename}"
            files_created += 1
            
        return {"status": "success", "files_created": files_created, "file_mapping": file_mapping}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def get_markdown_path_for_node(index_metadata: Dict[str, Any], node_id: str) -> Optional[str]:
    return index_metadata.get("markdown_files", {}).get(node_id)


# 公共别名：外部导入使用
create_markdown_content = _create_markdown_content
