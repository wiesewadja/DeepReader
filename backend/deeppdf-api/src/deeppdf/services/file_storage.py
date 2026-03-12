"""
文件存储服务

管理上传的 PDF 文件的 CRUD 操作
"""

import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime

from ..api.file_models import FileInfo

logger = logging.getLogger(__name__)


class FileStorage:
    """文件存储管理"""

    # 允许的文件类型
    ALLOWED_EXTENSIONS = {".pdf", ".epub"}
    # 最大文件大小 (50MB)
    MAX_FILE_SIZE = 50 * 1024 * 1024

    def __init__(self, storage_dir: str):
        """
        初始化文件存储

        Args:
            storage_dir: 存储目录路径
        """
        self.storage_dir = Path(storage_dir) / "uploads"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir = Path(storage_dir) / "files_meta"
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir = Path(storage_dir).parent / "results"  # results 目录
        logger.debug(f"[文件存储] 存储目录: {self.storage_dir}")
        logger.debug(f"[文件存储] 元数据目录: {self.metadata_dir}")

    def _get_file_path(self, file_id: str, extension: str = ".pdf") -> Path:
        """获取文件存储路径"""
        return self.storage_dir / f"{file_id}{extension}"

    def _get_metadata_path(self, file_id: str) -> Path:
        """获取元数据文件路径"""
        return self.metadata_dir / f"{file_id}.json"

    def _generate_file_id(self) -> str:
        """生成唯一的文件 ID"""
        return f"f_{uuid.uuid4().hex[:12]}"

    def _compute_content_hash(self, content: bytes) -> str:
        """计算文件内容的 MD5 hash"""
        return hashlib.md5(content).hexdigest()

    def _format_size(self, size_bytes: int) -> str:
        """格式化文件大小"""
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} TB"

    def _find_existing_file_by_hash(
        self, content_hash: str, filename: str
    ) -> Optional[FileInfo]:
        """
        通过内容 hash 查找已存在的文件

        Args:
            content_hash: 文件内容的 MD5 hash
            filename: 文件名（用于匹配扩展名）

        Returns:
            如果找到返回 FileInfo，否则返回 None
        """
        file_ext = Path(filename).suffix.lower()

        for meta_file in self.metadata_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                # 检查 hash 是否匹配
                if data.get("content_hash") == content_hash:
                    file_info = FileInfo(**data)
                    # 检查文件是否还存在
                    if Path(file_info.file_path).exists():
                        logger.info(
                            f"[文件存储] 找到相同内容的文件: {file_info.file_id} ({file_info.file_name})"
                        )
                        return file_info
            except Exception:
                continue

        return None

    def _find_matching_result_file(self, filename: str) -> Optional[Path]:
        """
        在 results 目录查找匹配的结果文件

        Args:
            filename: 原始文件名（不含扩展名）

        Returns:
            匹配的结果文件路径，如果没有找到返回 None
        """
        if not self.results_dir.exists():
            return None

        # 去掉扩展名的文件名
        stem = Path(filename).stem

        # 查找匹配的结果文件
        matching_files = list(
            self.results_dir.glob(f"{stem}_*.json")
        )

        if matching_files:
            # 返回最新的文件
            latest = max(matching_files, key=lambda p: p.stat().st_mtime)
            logger.info(f"[文件存储] 找到匹配的 results 文件: {latest.name}")
            return latest

        return None

    def validate_file(
        self, filename: str, file_size: int
    ) -> Tuple[bool, Optional[str]]:
        """
        验证文件

        Args:
            filename: 文件名
            file_size: 文件大小

        Returns:
            (is_valid, error_message)
        """
        # 检查文件扩展名
        file_ext = Path(filename).suffix.lower()
        if file_ext not in self.ALLOWED_EXTENSIONS:
            return False, f"不支持的文件类型: {file_ext}，仅支持 PDF 和 EPUB 文件"

        # 检查文件大小
        if file_size > self.MAX_FILE_SIZE:
            return (
                False,
                f"文件太大: {self._format_size(file_size)}，最大允许 {self._format_size(self.MAX_FILE_SIZE)}",
            )

        if file_size == 0:
            return False, "文件为空"

        return True, None

    def save_file(
        self,
        filename: str,
        content: bytes,
        check_duplicate: bool = True,
    ) -> Tuple[bool, Optional[FileInfo], Optional[str], Optional[Dict[str, Any]]]:
        """
        保存上传的文件（支持去重和结果复用）

        Args:
            filename: 原始文件名
            content: 文件内容
            check_duplicate: 是否检查重复文件

        Returns:
            (success, file_info, error_message, reuse_info)
            - reuse_info: 如果复用了已有数据，包含 {'existing_file': FileInfo, 'result_file': Path, 'index_id': str}
        """
        # 验证文件
        is_valid, error = self.validate_file(filename, len(content))
        if not is_valid:
            return False, None, error, None

        reuse_info = None

        # 检查重复文件
        if check_duplicate:
            content_hash = self._compute_content_hash(content)
            existing_file = self._find_existing_file_by_hash(content_hash, filename)

            if existing_file:
                logger.info(
                    f"[文件存储] 检测到重复文件，复用已有文件: {existing_file.file_id}"
                )

                # 查找是否有对应的索引
                index_id = None
                result_file = None

                # 1. 检查已有索引
                if existing_file.indexes:
                    index_id = existing_file.indexes[0]
                    logger.info(f"[文件存储] 已有索引: {index_id}")

                # 2. 尝试从 results 目录查找（无论是否有索引都检查）
                result_file = self._find_matching_result_file(filename)
                if result_file:
                    logger.info(f"[文件存储] 从 results 复用: {result_file.name}")
                    # 如果没有索引 ID，从结果文件生成一个
                    if not index_id:
                        index_id = f"idx_{hashlib.md5(result_file.stem.encode()).hexdigest()[:12]}"

                # 无论是否有索引/results，都复用已有文件（避免重复存储）
                reuse_info = {
                    "existing_file": existing_file,
                    "result_file": result_file,
                    "index_id": index_id,
                    "content_hash": content_hash,
                }

                # 更新文件的引用计数（不重新保存文件内容）
                return True, existing_file, None, reuse_info

        # 生成文件 ID
        file_id = self._generate_file_id()
        # 获取文件扩展名
        file_ext = Path(filename).suffix.lower()
        file_path = self._get_file_path(file_id, file_ext)

        # 保存文件
        try:
            with open(file_path, "wb") as f:
                f.write(content)

            # 计算内容 hash
            content_hash = self._compute_content_hash(content)

            # 创建元数据
            file_info = FileInfo(
                file_id=file_id,
                file_name=filename,
                file_size=len(content),
                file_path=str(file_path),
                uploaded_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                status="uploaded",
                indexed=False,
                indexes=[],
            )

            # 添加内容 hash 到元数据
            # 注意：FileInfo 模型可能需要添加 content_hash 字段
            # 这里我们通过保存时额外写入
            self._save_metadata_with_hash(file_id, file_info, content_hash)

            logger.info(
                f"[文件存储] 文件已保存: {file_id} - {filename} ({self._format_size(len(content))})"
            )
            return True, file_info, None, None

        except Exception as e:
            logger.error(f"[文件存储] 保存文件失败: {e}")
            # 清理可能已创建的文件
            if file_path.exists():
                file_path.unlink()
            return False, None, str(e)

    def _save_metadata(self, file_id: str, file_info: FileInfo) -> None:
        """保存文件元数据"""
        metadata_path = self._get_metadata_path(file_id)
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(file_info.model_dump(), f, ensure_ascii=False, indent=2)

    def _save_metadata_with_hash(
        self, file_id: str, file_info: FileInfo, content_hash: str
    ) -> None:
        """保存文件元数据（包含内容 hash）"""
        metadata_path = self._get_metadata_path(file_id)
        data = file_info.model_dump()
        data["content_hash"] = content_hash
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_metadata(self, file_id: str) -> Optional[FileInfo]:
        """加载文件元数据"""
        metadata_path = self._get_metadata_path(file_id)
        if not metadata_path.exists():
            return None

        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return FileInfo(**data)
        except Exception as e:
            logger.error(f"[文件存储] 加载元数据失败 {file_id}: {e}")
            return None

    def _get_file_path_from_metadata(self, file_info: FileInfo) -> Path:
        """从文件元数据获取文件路径"""
        # 从存储的 file_path 中获取扩展名
        return Path(file_info.file_path)

    def get_file(self, file_id: str) -> Optional[FileInfo]:
        """
        获取文件信息

        Args:
            file_id: 文件 ID

        Returns:
            文件信息，不存在返回 None
        """
        file_info = self._load_metadata(file_id)
        if file_info:
            # 检查文件是否存在（使用元数据中存储的路径）
            file_path = self._get_file_path_from_metadata(file_info)
            if not file_path.exists():
                logger.warning(f"[文件存储] 文件不存在: {file_id}")
                return None
        return file_info

    def list_files(self) -> List[FileInfo]:
        """
        列出所有文件

        Returns:
            文件列表
        """
        files = []

        for metadata_file in self.metadata_dir.glob("*.json"):
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    file_info = FileInfo(**data)

                    # 检查文件是否存在（使用元数据中存储的路径）
                    file_path = self._get_file_path_from_metadata(file_info)
                    if file_path.exists():
                        files.append(file_info)
                    else:
                        logger.warning(f"[文件存储] 文件丢失: {file_info.file_id}")
            except Exception as e:
                logger.error(f"[文件存储] 读取元数据失败 {metadata_file}: {e}")

        # 按上传时间倒序排序
        files.sort(key=lambda f: f.uploaded_at, reverse=True)
        logger.info(f"[文件存储] 列出文件: {len(files)} 个")
        return files

    def delete_file(self, file_id: str) -> Tuple[bool, Optional[str], int]:
        """
        删除文件

        Args:
            file_id: 文件 ID

        Returns:
            (success, error_message, deleted_index_count)
        """
        file_info = self.get_file(file_id)
        if not file_info:
            return False, f"文件 '{file_id}' 不存在", 0

        try:
            # 删除文件（使用元数据中存储的路径）
            file_path = self._get_file_path_from_metadata(file_info)
            if file_path.exists():
                file_path.unlink()

            # 删除元数据
            metadata_path = self._get_metadata_path(file_id)
            if metadata_path.exists():
                metadata_path.unlink()

            deleted_indexes = len(file_info.indexes)

            logger.info(
                f"[文件存储] 文件已删除: {file_id}，同时删除 {deleted_indexes} 个索引"
            )
            return True, None, deleted_indexes

        except Exception as e:
            logger.error(f"[文件存储] 删除文件失败 {file_id}: {e}")
            return False, str(e), 0

    def update_file_indexes(
        self, file_id: str, index_id: str, add: bool = True
    ) -> None:
        """
        更新文件的索引列表

        Args:
            file_id: 文件 ID
            index_id: 索引 ID
            add: True 添加索引，False 移除索引
        """
        file_info = self.get_file(file_id)
        if not file_info:
            logger.warning(f"[文件存储] 文件不存在: {file_id}")
            return

        if add:
            if index_id not in file_info.indexes:
                file_info.indexes.append(index_id)
            file_info.indexed = True
        else:
            if index_id in file_info.indexes:
                file_info.indexes.remove(index_id)
            file_info.indexed = len(file_info.indexes) > 0

        self._save_metadata(file_id, file_info)
        logger.info(
            f"[文件存储] 更新索引列表: {file_id} - {index_id} ({'添加' if add else '移除'})"
        )

    def get_file_path(self, file_id: str) -> Optional[str]:
        """
        获取文件的存储路径

        Args:
            file_id: 文件 ID

        Returns:
            文件路径，不存在返回 None
        """
        file_info = self.get_file(file_id)
        if file_info:
            return file_info.file_path
        return None

    def import_from_path(
        self, source_path: str, filename: Optional[str] = None
    ) -> Tuple[bool, Optional[FileInfo], Optional[str], Optional[Dict[str, Any]]]:
        """
        从本地路径导入文件到 uploads 目录（支持去重和复用）

        Args:
            source_path: 源文件路径
            filename: 可选的文件名（默认使用源文件名）

        Returns:
            (success, file_info, error_message, reuse_info)
            - reuse_info: 如果可以复用已有数据，包含复用信息
        """
        source = Path(source_path)

        if not source.exists():
            return False, None, f"源文件不存在: {source_path}", None

        # 使用源文件名或指定的文件名
        actual_filename = filename or source.name

        # 读取文件内容
        try:
            with open(source, "rb") as f:
                content = f.read()
        except Exception as e:
            return False, None, f"读取文件失败: {e}", None

        # 保存到 uploads（启用去重检查）
        success, file_info, error, reuse_info = self.save_file(
            actual_filename, content, check_duplicate=True
        )

        # 如果找到重复文件，尝试查找匹配的索引
        if reuse_info and file_info:
            # 查找匹配的索引文件
            index_file = self._find_matching_index_file(actual_filename)
            if index_file:
                reuse_info["index_file"] = str(index_file)
                logger.info(f"[文件导入] 找到匹配的索引: {index_file.name}")

        return success, file_info, error, reuse_info

    def _find_existing_file_by_hash(
        self, content_hash: str, filename: str
    ) -> Optional[FileInfo]:
        """
        通过内容 hash 查找已存在的文件

        Args:
            content_hash: 文件内容的 MD5 hash
            filename: 文件名（用于匹配扩展名）

        Returns:
            如果找到返回 FileInfo，否则返回 None
        """
        file_ext = Path(filename).suffix.lower()

        for meta_file in self.metadata_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                # 检查 hash 是否匹配
                if data.get("content_hash") == content_hash:
                    file_info = FileInfo(**data)
                    # 检查文件是否还存在
                    if Path(file_info.file_path).exists():
                        logger.info(
                            f"[文件存储] 找到相同内容的文件: {file_info.file_id} ({file_info.file_name})"
                        )
                        return file_info
            except Exception:
                continue

        return None

    def _find_matching_result_file(self, filename: str) -> Optional[Path]:
        """
        在 results 目录查找匹配的结果文件

        Args:
            filename: 原始文件名（可能含扩展名）

        Returns:
            匹配的结果文件路径，如果没有找到返回 None
        """
        if not self.results_dir.exists():
            return None

        # 去掉扩展名的文件名
        stem = Path(filename).stem

        # 查找匹配的结果文件
        matching_files = list(self.results_dir.glob(f"{stem}_*.json"))

        if matching_files:
            # 返回最新的文件
            latest = max(matching_files, key=lambda p: p.stat().st_mtime)
            logger.info(f"[文件存储] 找到匹配的 results 文件: {latest.name}")
            return latest

        return None

    def _find_matching_index_file(self, filename: str) -> Optional[Path]:
        """
        在 indexes 目录查找匹配的索引文件

        Args:
            filename: 原始文件名

        Returns:
            匹配的索引文件路径，如果没有找到返回 None
        """
        indexes_dir = self.metadata_dir.parent / "indexes"
        if not indexes_dir.exists():
            return None

        # 遍历所有索引文件，查找 file_name 匹配的
        for index_file in indexes_dir.glob("*.json"):
            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("file_name") == filename or data.get("pdf_name") == Path(filename).stem:
                    logger.info(f"[文件存储] 找到匹配的索引文件: {index_file.name}")
                    return index_file
            except Exception:
                continue

        return None
