"""
API 路由定义 - 导出相关端点
"""
import json
from pathlib import Path
from fastapi import HTTPException, status
from ..config import settings


async def export_index_data(index_id: str):
    """
    导出索引的节点数据,供前端生成 Markdown
    
    Args:
        index_id: 索引 ID
        
    Returns:
        包含节点数据的字典
    """
    try:
        # 加载索引元数据
        storage_dir = Path(settings.base_dir)
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"
        
        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Index '{index_id}' not found"
            )
        
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        # 提取节点数据
        nodes = []
        for section in metadata.get("sections", []):
            node_metadata = section.get("metadata", {})
            start_index = node_metadata.get("start_index", "?")
            end_index = node_metadata.get("end_index", "?")
            
            # 格式化页码范围
            if start_index == end_index:
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"
            
            nodes.append({
                "node_id": section.get("id", ""),
                "node_name": node_metadata.get("node_name", ""),
                "section": node_metadata.get("section", ""),
                "page_range": page_range,
                "start_index": start_index,
                "end_index": end_index,
                "level": node_metadata.get("level", 0),
                "text": section.get("text", ""),
            })
        
        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": metadata.get("pdf_name", ""),
            "nodes": nodes
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export index data: {str(e)}"
        )


async def save_markdown_mapping(index_id: str, file_mapping: dict):
    """
    保存 Markdown 文件映射到索引元数据
    
    Args:
        index_id: 索引 ID
        file_mapping: 节点 ID 到 Markdown 文件路径的映射
        
    Returns:
        操作结果
    """
    try:
        # 加载索引元数据
        storage_dir = Path(settings.base_dir)
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"
        
        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Index '{index_id}' not found"
            )
        
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        # 更新文件映射
        metadata["markdown_files"] = file_mapping
        
        # 保存元数据
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        
        return {
            "status": "success",
            "message": "Markdown file mapping saved successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save markdown mapping: {str(e)}"
        )
