"""
PaddleOCR 文本提取器 - 用于扫描文档的 OCR 索引

使用 PaddleOCR 从 PDF 中提取文本，支持中文和英文。
"""
import io
import logging
from typing import List, Optional

try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None
    # PaddleOCR 是可选依赖，只在需要处理扫描文档时才需要
    # 不在导入时显示警告，避免干扰用户

try:
    import pymupdf  # PyMuPDF
except ImportError:
    pymupdf = None
    # PyMuPDF 是可选依赖，只在需要将 PDF 转为图片时才需要

try:
    from PIL import Image
except ImportError:
    Image = None
    # PIL 是可选依赖

logger = logging.getLogger(__name__)


class PaddleOCRExtractor:
    """PaddleOCR 文本提取器"""

    def __init__(
        self,
        use_angle_cls: bool = True,
        lang: str = "ch",  # 中文
        use_gpu: bool = False,
        show_log: bool = False,
    ):
        """
        初始化 PaddleOCR

        Args:
            use_angle_cls: 是否使用方向分类器
            lang: 语言 (ch=中文, en=英文)
            use_gpu: 是否使用 GPU
            show_log: 是否显示日志
        """
        if PaddleOCR is None:
            raise ImportError("PaddleOCR is not installed")

        if pymupdf is None:
            raise ImportError("PyMuPDF is not installed")

        if Image is None:
            raise ImportError("PIL is not installed")

        self.ocr = PaddleOCR(
            use_angle_cls=use_angle_cls,
            lang=lang,
            use_gpu=use_gpu,
            show_log=show_log,
        )

        logger.info(f"[PaddleOCR] 初始化成功 (lang={lang}, gpu={use_gpu})")

    def extract_from_pdf(
        self,
        pdf_path: str,
        dpi: int = 200,
        max_pages: Optional[int] = None,
    ) -> List[str]:
        """
        从 PDF 提取文本（OCR 方式）

        Args:
            pdf_path: PDF 文件路径
            dpi: 转换图片的 DPI（影响 OCR 质量）
            max_pages: 最大处理页数（None=全部）

        Returns:
            每页的文本列表
        """
        doc = pymupdf.open(pdf_path)
        total_pages = len(doc)
        pages_to_process = min(max_pages or total_pages, total_pages)

        results = []

        for page_num in range(pages_to_process):
            try:
                # 将 PDF 页面转换为图片
                page = doc[page_num]
                mat = pymupdf.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)

                # 转换为 PIL Image
                img_data = pix.tobytes("png")
                img = Image.open(io.BytesIO(img_data))

                # OCR 识别
                result = self.ocr.ocr(img, cls=True)

                # 提取文本
                text_lines = []
                if result and result[0]:
                    for line in result[0]:
                        if line and len(line) >= 2:
                            text_lines.append(line[1][0])  # line[1][0] 是文本内容

                    page_text = "\n".join(text_lines)
                    results.append(page_text)

                    logger.debug(
                        f"[OCR] 第 {page_num+1}/{total_pages} 页: {len(text_lines)} 行"
                    )
                else:
                    logger.warning(f"[OCR] 第 {page_num+1} 页未识别到文本")
                    results.append("")

            except Exception as e:
                logger.error(f"[OCR] 第 {page_num+1} 页处理失败: {e}")
                results.append("")

        doc.close()

        logger.info(f"[PaddleOCR] 处理完成: {len(results)} 页")
        return results
