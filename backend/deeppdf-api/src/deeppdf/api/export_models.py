"""
导出相关的 Pydantic 模型
"""
from typing import List, Dict
from pydantic import BaseModel


class ExportNodeData(BaseModel):
    """单个节点的导出数据"""
    node_id: str
    node_name: str
    section: str
    page_range: str
    start_index: int | str
    end_index: int | str
    level: int
    text: str


class ExportIndexResponse(BaseModel):
    """导出索引响应"""
    status: str
    index_id: str
    pdf_name: str
    nodes: List[ExportNodeData]


class SaveMarkdownMappingRequest(BaseModel):
    """保存 Markdown 映射请求"""
    file_mapping: Dict[str, str]


class SaveMarkdownMappingResponse(BaseModel):
    """保存 Markdown 映射响应"""
    status: str
    message: str
