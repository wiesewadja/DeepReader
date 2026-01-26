"""
文件管理 API 模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class FileUploadResponse(BaseModel):
    """文件上传响应"""

    file_id: str = Field(..., description="文件唯一标识")
    file_name: str = Field(..., description="原始文件名")
    file_size: int = Field(..., description="文件大小（字节）")
    file_path: str = Field(..., description="服务器存储路径")
    uploaded_at: str = Field(..., description="上传时间")
    status: str = Field("uploaded", description="文件状态")
    indexed: bool = Field(False, description="是否已索引")


class FileInfo(BaseModel):
    """文件信息"""

    file_id: str = Field(..., description="文件唯一标识")
    file_name: str = Field(..., description="原始文件名")
    file_size: int = Field(..., description="文件大小（字节）")
    file_path: str = Field(..., description="服务器存储路径")
    uploaded_at: str = Field(..., description="上传时间")
    status: str = Field("uploaded", description="文件状态")
    indexed: bool = Field(False, description="是否已索引")
    indexes: List[str] = Field(default_factory=list, description="关联的索引ID列表")


class FileListResponse(BaseModel):
    """文件列表响应"""

    status: str
    files: List[FileInfo]
    total: int = Field(..., description="文件总数")


class FileDetailResponse(BaseModel):
    """文件详情响应"""

    status: str
    file: Optional[FileInfo] = None
    message: Optional[str] = None


class FileDeleteResponse(BaseModel):
    """文件删除响应"""

    status: str
    message: str
    deleted_indexes: int = Field(0, description="同时删除的索引数量")
