"""
PageIndex EPUB 图片提取模块

本模块提供 EPUB 图片提取和路径映射功能。

主要功能:
    - 从 EPUB 中提取所有图片资源
    - 建立原始路径到新文件名的映射
    - 解析 EPUB 内的相对路径

使用示例:
    >>> from pageindex.epub_images import EpubImageExtractor
    >>>
    >>> # 提取图片
    >>> extractor = EpubImageExtractor(output_dir, index_id)
    >>> image_map = extractor.extract_images(book)
    >>>
    >>> # image_map: {"OEBPS/images/fig1.jpg": "a1b2c3d4.jpg", ...}

依赖关系:
    - ebooklib: EPUB 文件解析
    - PIL/Pillow: 图片格式检测（可选）

作者: DeepPDF Team
创建时间: 2026-03-16
"""

import hashlib
import logging
import os
from pathlib import Path
from typing import Dict, Optional, Set

import ebooklib
from ebooklib import epub

logger = logging.getLogger(__name__)

# 支持的图片格式及其 MIME 类型
SUPPORTED_IMAGE_EXTENSIONS = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
}


class EpubImageExtractor:
    """
    EPUB 图片提取器

    从 EPUB 书籍中提取所有图片资源，保存到指定目录，
    并建立原始路径到新文件名的映射关系。

    属性:
        output_dir: 图片输出目录
        index_id: 索引 ID
        image_map: 原始路径 -> 新文件名的映射表

    使用示例:
        >>> extractor = EpubImageExtractor(Path("data/epub_images"), "idx_123")
        >>> image_map = extractor.extract_images(book)
        >>> print(f"提取了 {len(image_map)} 张图片")
    """

    def __init__(self, output_dir: Path, index_id: str):
        """
        初始化图片提取器

        参数:
            output_dir: 图片输出根目录 (如 data/epub_images)
            index_id: 索引 ID，用于创建子目录

        异常:
            ValueError: 如果参数为空
        """
        if not output_dir:
            raise ValueError("输出目录不能为空")
        if not index_id:
            raise ValueError("索引 ID 不能为空")

        self.output_dir = output_dir / index_id
        self.index_id = index_id
        self.image_map: Dict[str, str] = {}  # 原始路径 -> 新文件名
        self._saved_hashes: Set[str] = set()  # 已保存图片的 hash，用于去重

        logger.debug(f"EpubImageExtractor 初始化: {self.output_dir}")

    def extract_images(self, book: epub.EpubBook) -> Dict[str, str]:
        """
        从 EPUB 书籍中提取所有图片

        遍历 EPUB 中的所有图片资源，保存到输出目录，
        并建立路径映射关系。

        参数:
            book: ebooklib EpubBook 对象

        返回:
            图片映射表 {原始路径: 新文件名}

        使用示例:
            >>> extractor = EpubImageExtractor(output_dir, "idx_123")
            >>> image_map = extractor.extract_images(book)
            >>> # image_map: {"OEBPS/images/fig1.jpg": "a1b2c3d4.jpg"}
        """
        # 创建输出目录
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 遍历所有图片资源
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_IMAGE:
                original_path = item.get_name()  # 如 "OEBPS/images/fig1.jpg"
                content = item.get_content()

                # 生成新文件名
                new_name = self._generate_filename(original_path, content)

                # 去重：如果相同内容的图片已存在，跳过
                content_hash = hashlib.md5(content).hexdigest()
                if content_hash in self._saved_hashes:
                    logger.debug(f"跳过重复图片: {original_path}")
                    continue

                # 保存图片
                self._save_image(new_name, content)
                self._saved_hashes.add(content_hash)

                # 建立映射
                self.image_map[original_path] = new_name

                logger.debug(f"[图片提取] {original_path} -> {new_name}")

        logger.info(f"[图片提取] 共提取 {len(self.image_map)} 张图片到 {self.output_dir}")
        return self.image_map

    def _generate_filename(self, original_path: str, content: bytes) -> str:
        """
        生成新文件名

        使用原始路径的 hash 作为文件名，保留原始扩展名。

        参数:
            original_path: 原始图片路径
            content: 图片二进制内容

        返回:
            新文件名 (如 "a1b2c3d4.jpg")
        """
        # 获取原始扩展名
        ext = Path(original_path).suffix.lower()
        if ext not in SUPPORTED_IMAGE_EXTENSIONS:
            # 未知格式，默认使用 .bin
            ext = '.bin'

        # 使用路径 hash 作为文件名（短版本）
        path_hash = hashlib.md5(original_path.encode()).hexdigest()[:12]

        return f"{path_hash}{ext}"

    def _save_image(self, filename: str, content: bytes) -> None:
        """
        保存图片到输出目录

        参数:
            filename: 文件名
            content: 图片二进制内容
        """
        filepath = self.output_dir / filename
        with open(filepath, 'wb') as f:
            f.write(content)

    def get_image_url(self, original_path: str) -> Optional[str]:
        """
        获取图片的 API 访问 URL

        参数:
            original_path: EPUB 中的原始图片路径

        返回:
            图片的 API URL，如果未找到则返回 None

        使用示例:
            >>> url = extractor.get_image_url("OEBPS/images/fig1.jpg")
            >>> # url: "/api/epub-images/idx_123/a1b2c3d4.jpg"
        """
        new_name = self.image_map.get(original_path)
        if new_name:
            return f"/api/epub-images/{self.index_id}/{new_name}"
        return None

    def get_image_count(self) -> int:
        """获取提取的图片数量"""
        return len(self.image_map)

    def has_images(self) -> bool:
        """是否有图片"""
        return len(self.image_map) > 0


def resolve_epub_path(src: str, file_path: str) -> str:
    """
    解析 EPUB 内的相对路径为绝对路径

    EPUB 中的图片引用通常是相对路径，需要根据当前 HTML 文件
    的位置来解析。

    参数:
        src: 图片的 src 属性值 (如 "../images/fig1.jpg")
        file_path: 当前 HTML 文件路径 (如 "OEBPS/chapters/ch1.xhtml")

    返回:
        EPUB 内的绝对路径 (如 "OEBPS/images/fig1.jpg")

    使用示例:
        >>> resolve_epub_path("../images/fig1.jpg", "OEBPS/chapters/ch1.xhtml")
        'OEBPS/images/fig1.jpg'
    """
    # 获取当前文件所在目录
    file_dir = os.path.dirname(file_path)

    # 解析相对路径
    resolved = os.path.normpath(os.path.join(file_dir, src))

    # 统一路径分隔符 (Windows -> Unix)
    resolved = resolved.replace('\\', '/')

    return resolved


def get_mime_type(filename: str) -> str:
    """
    根据文件扩展名获取 MIME 类型

    参数:
        filename: 文件名

    返回:
        MIME 类型字符串
    """
    ext = Path(filename).suffix.lower()
    return SUPPORTED_IMAGE_EXTENSIONS.get(ext, 'application/octet-stream')
