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


def _create_markdown_content(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str
) -> str:
    """
    创建 Markdown 文件内容
    
    Args:
        node: 节点数据
        pdf_name: PDF 文件名
        section: 章节路径
        page_range: 页码范围
        
    Returns:
        Markdown 内容
    """
    node_id = node.get("id", "")
    text = node.get("text", "")
    metadata = node.get("metadata", {})
    
    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
---

"""
    
    # 创建标题
    title = f"# {section}\n\n"
    
    # 内容
    content = text.strip() + "\n\n"
    
    # 添加来源信息
    footer = f"""---
**来源**: [[{pdf_name}]] 第 {page_range} 页
"""
    
    return front_matter + title + content + footer


def export_pdf_to_markdown(
    index_id: str,
    storage_dir: str,
    vault_path: str,
    output_folder: str = "DeepPDF"
) -> Dict[str, Any]:
    """
    将索引的 PDF 导出为分割的 Markdown 文件
    
    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        vault_path: Obsidian vault 路径
        output_folder: 输出文件夹名称 (相对于 vault)
        
    Returns:
        {
            "status": "success",
            "files_created": 10,
            "output_path": "/path/to/vault/DeepPDF/PDF名称/",
            "file_mapping": {
                "node_id_1": "DeepPDF/PDF名称/01-章节名称.md",
                ...
            }
        }
    """
    try:
        # 加载索引元数据
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"
        
        if not metadata_path.exists():
            return {
                "status": "error",
                "error": f"Index metadata not found: {index_id}"
            }
        
        with open(metadata_path, "r", encoding="utf-8") as f:
            index_metadata = json.load(f)
        
        pdf_name = index_metadata.get("pdf_name", "Unknown")
        sections = index_metadata.get("sections", [])
        
        if not sections:
            return {
                "status": "error",
                "error": "No sections found in index metadata"
            }
        
        # 创建输出目录
        vault_path_obj = Path(vault_path)
        if not vault_path_obj.exists():
            return {
                "status": "error",
                "error": f"Vault path does not exist: {vault_path}"
            }
        
        # 清理 PDF 名称用于文件夹名
        pdf_folder_name = _sanitize_filename(pdf_name.replace(".pdf", ""))
        output_dir = vault_path_obj / output_folder / pdf_folder_name
        output_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"[Markdown Export] 导出到: {output_dir}")
        logger.info(f"[Markdown Export] 节点数量: {len(sections)}")
        
        # 导出每个节点为 Markdown 文件
        file_mapping = {}
        files_created = 0
        
        for idx, node in enumerate(sections, start=1):
            try:
                metadata = node.get("metadata", {})
                section = metadata.get("section", f"Section {idx}")
                node_id = node.get("id", f"node_{idx}")
                node_name = metadata.get("node_name", f"Section {idx}")
                
                # 页码范围
                start_page = metadata.get("start_index", "?")
                end_page = metadata.get("end_index", "?")
                if start_page == end_page:
                    page_range = str(start_page)
                else:
                    page_range = f"{start_page}-{end_page}"
                
                # 生成文件名
                filename_base = _sanitize_filename(node_name)
                filename = f"{idx:02d}-{filename_base}.md"
                file_path = output_dir / filename
                
                # 生成 Markdown 内容
                markdown_content = _create_markdown_content(
                    node=node,
                    pdf_name=pdf_name,
                    section=section,
                    page_range=page_range
                )
                
                # 写入文件
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(markdown_content)
                
                # 记录映射 (相对于 vault 的路径)
                relative_path = f"{output_folder}/{pdf_folder_name}/{filename}"
                file_mapping[node_id] = relative_path
                files_created += 1
                
                logger.debug(f"  ✓ 创建: {filename}")
                
            except Exception as e:
                logger.error(f"  ✗ 导出节点 {idx} 失败: {e}")
                continue
        
        logger.info(f"[Markdown Export] 完成: 创建了 {files_created} 个文件")
        
        return {
            "status": "success",
            "files_created": files_created,
            "output_path": str(output_dir),
            "file_mapping": file_mapping
        }
        
    except Exception as e:
        logger.error(f"[Markdown Export] 失败: {e}", exc_info=True)
        return {
            "status": "error",
            "error": str(e)
        }


def get_markdown_path_for_node(
    index_metadata: Dict[str, Any],
    node_id: str
) -> Optional[str]:
    """
    获取节点对应的 Markdown 文件路径
    
    Args:
        index_metadata: 索引元数据
        node_id: 节点 ID
        
    Returns:
        Markdown 文件路径 (相对于 vault),如果不存在则返回 None
    """
    markdown_files = index_metadata.get("markdown_files", {})
    return markdown_files.get(node_id)
