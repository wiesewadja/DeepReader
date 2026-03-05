"""
导出相关的 Pydantic 模型
"""

from typing import List, Optional
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
    parent_id: str | None = None  # 新增：父节点 ID


class ExportIndexResponse(BaseModel):
    """导出索引响应"""

    status: str
    index_id: str
    pdf_name: str
    total_pages: int  # 新增：PDF 总页数
    created_at: str  # 新增：创建时间
    nodes: List[ExportNodeData]


class CoverResponse(BaseModel):
    """封面响应"""

    status: str
    index_id: str
    pdf_name: str
    cover_data: str  # base64 编码的图片数据
    mime_type: str = "image/png"
    has_custom_cover: bool  # 是否有自定义封面（True=提取的，False=生成的默认封面）
