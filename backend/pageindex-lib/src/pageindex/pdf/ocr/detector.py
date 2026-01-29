"""
PDF 视觉检测器 - 判断 PDF 是否为视觉密集型（扫描文档/图表密集）

检测逻辑：
    1. 文本密度检测：每页字符数低于阈值
    2. 图片密度检测：图片面积占比高于阈值

满足任一条件即判定为视觉密集型，建议使用 OCR 处理。
"""
import logging
from dataclasses import dataclass
from typing import Tuple

try:
    import pymupdf  # PyMuPDF
except ImportError:
    pymupdf = None
    logging.warning("PyMuPDF not installed. Visual detection will be limited.")

logger = logging.getLogger(__name__)


@dataclass
class VisualDetectionResult:
    """视觉检测结果"""

    is_visual_heavy: bool  # 是否为视觉密集型
    text_density: float  # 平均每页字符数
    image_density: float  # 图片面积占比 (0-1)
    sampled_pages: int  # 采样的页数
    reason: str  # 判断依据


class VisualDetector:
    """PDF 视觉检测器"""

    def __init__(
        self,
        sample_pages: int = 10,
        text_threshold: int = 50,
        image_threshold: float = 0.3,
    ):
        """
        初始化检测器

        Args:
            sample_pages: 采样检测的页数
            text_threshold: 每页最小字符数阈值（低于此值判定为文本稀疏）
            image_threshold: 图片面积占比阈值（高于此值判定为图片密集）
        """
        if pymupdf is None:
            raise ImportError("PyMuPDF (pymupdf) is required for visual detection")

        self.sample_pages = sample_pages
        self.text_threshold = text_threshold
        self.image_threshold = image_threshold

    def detect(self, pdf_path: str) -> VisualDetectionResult:
        """
        检测 PDF 是否为视觉密集型

        Args:
            pdf_path: PDF 文件路径

        Returns:
            VisualDetectionResult 检测结果
        """
        doc = pymupdf.open(pdf_path)
        total_pages = len(doc)

        # 限制采样页数
        pages_to_check = min(self.sample_pages, total_pages)

        total_text = 0
        total_image_area = 0
        total_page_area = 0

        for page_num in range(pages_to_check):
            page = doc[page_num]

            # 1. 提取文本
            text = page.get_text()
            total_text += len(text)

            # 2. 计算图片面积
            page_area = page.rect.width * page.rect.height
            total_page_area += page_area

            # 统计图片数量和估算面积
            image_list = page.get_images()
            # 简化估算：每张图片约占 20% 页面
            image_area = min(len(image_list) * 0.2 * page_area, page_area)
            total_image_area += image_area

        doc.close()

        # 计算平均值
        avg_text_per_page = total_text / pages_to_check if pages_to_check > 0 else 0
        image_density = total_image_area / total_page_area if total_page_area > 0 else 0

        # 判断逻辑
        reasons = []
        is_visual_heavy = False

        # 条件1: 文本稀疏
        if avg_text_per_page < self.text_threshold:
            is_visual_heavy = True
            reasons.append(
                f"文本稀疏 ({avg_text_per_page:.0f} 字符/页 < {self.text_threshold})"
            )

        # 条件2: 图片密集
        if image_density > self.image_threshold:
            is_visual_heavy = True
            reasons.append(
                f"图片密集 ({image_density*100:.1f}% > {self.image_threshold*100:.0f}%)"
            )

        reason = "、".join(reasons) if reasons else "普通文本文档"

        logger.info(f"[视觉检测] {pdf_path}: {reason}")

        return VisualDetectionResult(
            is_visual_heavy=is_visual_heavy,
            text_density=avg_text_per_page,
            image_density=image_density,
            sampled_pages=pages_to_check,
            reason=reason,
        )


def detect_pdf_type(
    pdf_path: str,
    sample_pages: int = 10,
    text_threshold: int = 50,
    image_threshold: float = 0.3,
) -> VisualDetectionResult:
    """
    便捷函数：检测 PDF 类型

    Args:
        pdf_path: PDF 文件路径
        sample_pages: 采样页数
        text_threshold: 文本阈值
        image_threshold: 图片阈值

    Returns:
        VisualDetectionResult
    """
    detector = VisualDetector(sample_pages, text_threshold, image_threshold)
    return detector.detect(pdf_path)
