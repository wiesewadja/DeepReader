"""
书籍封面提取服务

从 PDF/EPUB 文件中提取封面图片，如果没有封面则生成默认封面
"""

import base64
import io
import logging
import os
import re
from pathlib import Path
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# 封面尺寸配置
COVER_WIDTH = 200
COVER_HEIGHT = 280
COVER_BG_COLOR = "#2D3748"  # 深灰色背景
COVER_TEXT_COLOR = "#E2E8F0"  # 浅灰色文字


def extract_pdf_cover(pdf_path: str) -> Optional[bytes]:
    """
    从 PDF 文件中提取封面图片

    Args:
        pdf_path: PDF 文件路径

    Returns:
        封面图片的二进制数据（PNG 格式），如果没有封面则返回 None
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(pdf_path)

        # 尝试从第一页提取图片
        first_page = doc[0]
        images = first_page.get_images()

        if images:
            # 获取最大的图片（通常是封面）
            largest_image = None
            largest_area = 0

            for img_index, img in enumerate(images):
                xref = img[0]
                base_image = doc.extract_image(xref)
                if base_image:
                    img_bytes = base_image["image"]
                    try:
                        pil_image = Image.open(io.BytesIO(img_bytes))
                        area = pil_image.width * pil_image.height
                        if area > largest_area:
                            largest_area = area
                            largest_image = pil_image
                    except Exception:
                        continue

            if largest_image:
                # 调整尺寸
                largest_image.thumbnail((COVER_WIDTH, COVER_HEIGHT), Image.Resampling.LANCZOS)
                # 转换为 RGB 模式（如果需要）
                if largest_image.mode in ("RGBA", "P"):
                    largest_image = largest_image.convert("RGB")
                # 保存为 PNG
                output = io.BytesIO()
                largest_image.save(output, format="PNG", optimize=True)
                doc.close()
                return output.getvalue()

        # 如果没有找到图片，尝试将第一页渲染为图片
        mat = fitz.Matrix(2, 2)  # 2x 缩放以提高质量
        pix = first_page.get_pixmap(matrix=mat)

        # 转换为 PIL Image
        img_data = pix.tobytes("png")
        pil_image = Image.open(io.BytesIO(img_data))

        # 调整尺寸
        pil_image.thumbnail((COVER_WIDTH, COVER_HEIGHT), Image.Resampling.LANCZOS)

        output = io.BytesIO()
        pil_image.save(output, format="PNG", optimize=True)
        doc.close()
        return output.getvalue()

    except Exception as e:
        logger.error(f"[封面提取] PDF 封面提取失败: {e}")
        return None


def extract_epub_cover(epub_path: str) -> Optional[bytes]:
    """
    从 EPUB 文件中提取封面图片

    Args:
        epub_path: EPUB 文件路径

    Returns:
        封面图片的二进制数据（PNG 格式），如果没有封面则返回 None
    """
    try:
        import zipfile
        import xml.etree.ElementTree as ET

        with zipfile.ZipFile(epub_path, 'r') as epub:
            # 读取 container.xml 找到 OPF 文件
            try:
                container_xml = epub.read('META-INF/container.xml')
                container_root = ET.fromstring(container_xml)
                # 查找 rootfile 元素
                ns = {'container': 'urn:oasis:names:tc:opendocument:xmlns:container'}
                rootfile = container_root.find('.//container:rootfile', ns)
                if rootfile is None:
                    return None

                opf_path = rootfile.get('full-path')
            except Exception:
                # 尝试常见的 OPF 路径
                opf_path = 'OEBPS/content.opf'

            # 读取 OPF 文件
            try:
                opf_content = epub.read(opf_path)
            except KeyError:
                return None

            opf_root = ET.fromstring(opf_content)

            # 查找封面图片
            # 方法1: 查找 meta name="cover"
            cover_id = None
            for meta in opf_root.iter():
                if meta.get('name') == 'cover':
                    cover_id = meta.get('content')
                    break

            # 方法2: 查找 properties="cover-image"
            if not cover_id:
                for item in opf_root.iter():
                    if 'cover-image' in (item.get('properties') or ''):
                        href = item.get('href')
                        if href:
                            opf_dir = os.path.dirname(opf_path)
                            cover_path = os.path.join(opf_dir, href) if opf_dir else href
                            try:
                                cover_data = epub.read(cover_path)
                                pil_image = Image.open(io.BytesIO(cover_data))
                                pil_image.thumbnail((COVER_WIDTH, COVER_HEIGHT), Image.Resampling.LANCZOS)
                                if pil_image.mode in ("RGBA", "P"):
                                    pil_image = pil_image.convert("RGB")
                                output = io.BytesIO()
                                pil_image.save(output, format="PNG", optimize=True)
                                return output.getvalue()
                            except Exception:
                                continue

            # 方法3: 使用 cover_id 查找
            if cover_id:
                for item in opf_root.iter():
                    if item.get('id') == cover_id:
                        href = item.get('href')
                        if href:
                            opf_dir = os.path.dirname(opf_path)
                            cover_path = os.path.join(opf_dir, href) if opf_dir else href
                            try:
                                cover_data = epub.read(cover_path)
                                pil_image = Image.open(io.BytesIO(cover_data))
                                pil_image.thumbnail((COVER_WIDTH, COVER_HEIGHT), Image.Resampling.LANCZOS)
                                if pil_image.mode in ("RGBA", "P"):
                                    pil_image = pil_image.convert("RGB")
                                output = io.BytesIO()
                                pil_image.save(output, format="PNG", optimize=True)
                                return output.getvalue()
                            except Exception:
                                continue

        return None

    except Exception as e:
        logger.error(f"[封面提取] EPUB 封面提取失败: {e}")
        return None


def generate_default_cover(book_name: str) -> bytes:
    """
    生成默认封面图片

    Args:
        book_name: 书籍名称

    Returns:
        封面图片的二进制数据（PNG 格式）
    """
    # 创建画布
    img = Image.new('RGB', (COVER_WIDTH, COVER_HEIGHT), COVER_BG_COLOR)
    draw = ImageDraw.Draw(img)

    # 清理书名
    clean_name = book_name.replace('.pdf', '').replace('.epub', '')
    clean_name = re.sub(r'[_\-]', ' ', clean_name).strip()

    # 尝试加载支持中文的字体
    font_size = 16
    font = None

    # 按优先级尝试不同字体路径
    font_paths = [
        # macOS 中文字体
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        # Linux 中文字体
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        # Windows 字体
        "C:/Windows/Fonts/msyh.ttc",  # 微软雅黑
        "C:/Windows/Fonts/simhei.ttf",  # 黑体
    ]

    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, font_size)
            logger.debug(f"[封面生成] 成功加载字体: {font_path}")
            break
        except Exception:
            continue

    # 如果所有字体都加载失败，使用默认字体
    if font is None:
        try:
            font = ImageFont.load_default()
            logger.warning("[封面生成] 未找到合适的字体，使用默认字体（可能不支持中文）")
        except Exception as e:
            logger.error(f"[封面生成] 字体加载失败: {e}")
            # 创建一个空白封面
            output = io.BytesIO()
            img.save(output, format="PNG", optimize=True)
            return output.getvalue()

    # 智能换行处理（支持中文和英文混合）
    max_chars_per_line = 10
    lines = []

    # 先尝试按空格分割（英文书名）
    words = clean_name.split()
    if len(words) > 1:
        # 英文书名：按单词换行
        current_line = ""
        for word in words:
            test_line = current_line + " " + word if current_line else word
            if len(test_line) <= max_chars_per_line:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        if current_line:
            lines.append(current_line)
    else:
        # 中文书名或无空格书名：按字符数换行
        for i in range(0, len(clean_name), max_chars_per_line):
            lines.append(clean_name[i:i + max_chars_per_line])

    # 限制最多 5 行
    lines = lines[:5]

    # 计算总高度
    line_height = font_size + 8
    total_height = len(lines) * line_height
    start_y = max(20, (COVER_HEIGHT - total_height) // 2)

    # 绘制文字
    y_offset = start_y
    for line in lines:
        if not line.strip():
            continue
        try:
            # 使用 textlength 获取更准确的宽度（如果可用）
            if hasattr(draw, 'textlength'):
                text_width = draw.textlength(line, font=font)
            else:
                bbox = draw.textbbox((0, 0), line, font=font)
                text_width = bbox[2] - bbox[0]
            x = max(5, (COVER_WIDTH - text_width) // 2)
            draw.text((x, y_offset), line, fill=COVER_TEXT_COLOR, font=font)
        except Exception as e:
            logger.warning(f"[封面生成] 绘制文字失败: {line}, 错误: {e}")
        y_offset += line_height

    # 添加装饰边框
    border_color = "#4A5568"
    border_width = 2
    draw.rectangle(
        [border_width, border_width, COVER_WIDTH - border_width - 1, COVER_HEIGHT - border_width - 1],
        outline=border_color,
        width=border_width
    )

    # 保存为 PNG
    output = io.BytesIO()
    img.save(output, format="PNG", optimize=True)
    logger.info(f"[封面生成] 成功生成封面: {book_name}, 行数: {len(lines)}")
    return output.getvalue()


def extract_or_generate_cover(file_path: str, book_name: str) -> Tuple[bytes, str]:
    """
    提取或生成封面图片

    Args:
        file_path: 书籍文件路径
        book_name: 书籍名称

    Returns:
        (封面图片二进制数据, MIME 类型)
    """
    cover_data = None

    # 根据文件类型提取封面
    if file_path.lower().endswith('.pdf'):
        cover_data = extract_pdf_cover(file_path)
    elif file_path.lower().endswith('.epub'):
        cover_data = extract_epub_cover(file_path)

    # 如果提取失败，生成默认封面
    if cover_data is None:
        logger.info(f"[封面提取] 未找到封面，生成默认封面: {book_name}")
        cover_data = generate_default_cover(book_name)

    return cover_data, "image/png"


def get_cover_base64(file_path: str, book_name: str) -> str:
    """
    获取封面图片的 base64 编码

    Args:
        file_path: 书籍文件路径
        book_name: 书籍名称

    Returns:
        base64 编码的封面图片（带 data URI 前缀）
    """
    cover_data, mime_type = extract_or_generate_cover(file_path, book_name)
    b64_data = base64.b64encode(cover_data).decode('utf-8')
    return f"data:{mime_type};base64,{b64_data}"
