"""
PaddleOCR 文本提取器 - 用于扫描文档的 OCR 索引

使用 PaddleOCR 从 PDF 中提取文本，支持中文和英文。
支持多进程并行处理以加速大文档的 OCR 识别。
"""
import io
import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List, Optional, Tuple

try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None
    # PaddleOCR 是可选依赖，只在需要处理扫描文档时才需要
    # 不在导入时显示警告，避免干扰用户

try:
    import numpy as np
except ImportError:
    np = None

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

# Worker 进程中的全局 PaddleOCR 实例
_worker_ocr = None
_worker_config = None


def _init_worker(use_angle_cls: bool, lang: str, use_gpu: bool, show_log: bool):
    """Worker 进程初始化函数"""
    global _worker_ocr, _worker_config

    if PaddleOCR is None:
        raise ImportError("PaddleOCR is not installed")

    # 减少 PaddleOCR 的日志输出
    _worker_ocr = PaddleOCR(
        use_angle_cls=use_angle_cls,
        lang=lang,
        use_gpu=use_gpu,
        show_log=show_log,
    )

    _worker_config = {
        "use_angle_cls": use_angle_cls,
        "lang": lang,
        "use_gpu": use_gpu,
        "show_log": show_log,
    }


def _process_page(page_data: Tuple[int, bytes, int, int]) -> Tuple[int, str]:
    """
    处理单个页面的 OCR

    Args:
        page_data: (page_num, img_bytes, dpi, total_pages)

    Returns:
        (page_num, text)
    """
    global _worker_ocr

    page_num, img_bytes, dpi, total_pages = page_data

    try:
        # 从 bytes 转换为 PIL Image，再转为 numpy 数组
        img = Image.open(io.BytesIO(img_bytes))
        img_array = np.array(img)

        # OCR 识别
        result = _worker_ocr.ocr(img_array, cls=True)

        # 提取文本
        text_lines = []
        if result and result[0]:
            for line in result[0]:
                if line and len(line) >= 2:
                    text_lines.append(line[1][0])

        page_text = "\n".join(text_lines) if text_lines else ""

        # 清理
        img.close()

        return (page_num, page_text)

    except Exception as e:
        error_msg = str(e) if str(e) else f"{type(e).__name__}"
        logger.error(f"[OCR] 第 {page_num+1}/{total_pages} 页处理失败: {error_msg}")
        return (page_num, "")


class PaddleOCRExtractor:
    """PaddleOCR 文本提取器（支持并行处理）"""

    def __init__(
        self,
        use_angle_cls: bool = True,
        lang: str = "ch",  # 中文
        use_gpu: bool = False,
        show_log: bool = False,
        max_workers: Optional[int] = None,
    ):
        """
        初始化 PaddleOCR

        Args:
            use_angle_cls: 是否使用方向分类器
            lang: 语言 (ch=中文, en=英文)
            use_gpu: 是否使用 GPU
            show_log: 是否显示日志
            max_workers: 最大并行进程数，默认为 CPU 核心数
        """
        if PaddleOCR is None:
            raise ImportError("PaddleOCR is not installed")

        if pymupdf is None:
            raise ImportError("PyMuPDF is not installed")

        if Image is None:
            raise ImportError("PIL is not installed")

        if np is None:
            raise ImportError("numpy is not installed")

        self.use_angle_cls = use_angle_cls
        self.lang = lang
        self.use_gpu = use_gpu
        self.show_log = show_log

        # 默认使用 CPU 核心数，但不超过 4（避免内存压力）
        if max_workers is None:
            max_workers = min(os.cpu_count() or 1, 4)

        self.max_workers = max_workers

        # 初始化一个 PaddleOCR 实例用于串行处理
        self.ocr = PaddleOCR(
            use_angle_cls=use_angle_cls,
            lang=lang,
            use_gpu=use_gpu,
            show_log=show_log,
        )

        logger.info(
            f"[PaddleOCR] 初始化成功 (lang={lang}, gpu={use_gpu}, workers={max_workers})"
        )

    def extract_from_pdf(
        self,
        pdf_path: str,
        dpi: int = 200,
        max_pages: Optional[int] = None,
        parallel: bool = True,
    ) -> List[str]:
        """
        从 PDF 提取文本（OCR 方式）

        Args:
            pdf_path: PDF 文件路径
            dpi: 转换图片的 DPI（影响 OCR 质量）
            max_pages: 最大处理页数（None=全部）
            parallel: 是否使用并行处理（默认 True）

        Returns:
            每页的文本列表
        """
        import gc

        doc = pymupdf.open(pdf_path)
        total_pages = len(doc)
        pages_to_process = min(max_pages or total_pages, total_pages)

        # 准备所有页面的图像数据
        page_data_list = []
        for page_num in range(pages_to_process):
            try:
                page = doc[page_num]
                mat = pymupdf.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                page_data_list.append((page_num, img_bytes, dpi, total_pages))
                pix = None  # 及时释放内存
            except Exception as e:
                logger.error(f"[OCR] 第 {page_num+1} 页图像转换失败: {e}")
                page_data_list.append((page_num, b"", dpi, total_pages))

        doc.close()
        gc.collect()

        # 选择处理方式
        if parallel and pages_to_process > 10 and self.max_workers > 1:
            results = self._process_parallel(page_data_list, total_pages)
        else:
            results = self._process_sequential(page_data_list, total_pages)

        logger.info(f"[PaddleOCR] 处理完成: {len(results)} 页")
        return results

    def _process_sequential(
        self, page_data_list: List[Tuple], total_pages: int
    ) -> List[str]:
        """串行处理页面"""
        import gc

        results = [""] * len(page_data_list)

        for page_num, img_bytes, dpi, _ in page_data_list:
            if not img_bytes:
                continue

            pix = None
            img = None
            img_data = None

            try:
                img = Image.open(io.BytesIO(img_bytes))
                img_array = np.array(img)

                result = self.ocr.ocr(img_array, cls=True)

                text_lines = []
                if result and result[0]:
                    for line in result[0]:
                        if line and len(line) >= 2:
                            text_lines.append(line[1][0])

                page_text = "\n".join(text_lines)
                results[page_num] = page_text

                logger.debug(f"[OCR] 第 {page_num+1}/{total_pages} 页: {len(text_lines)} 行")

            except Exception as e:
                error_msg = str(e) if str(e) else f"{type(e).__name__}"
                logger.error(f"[OCR] 第 {page_num+1} 页处理失败: {error_msg}")
                results[page_num] = ""

            finally:
                if pix is not None:
                    pix = None
                if img is not None:
                    img.close()
                    img = None
                if img_data is not None:
                    img_data = None

            # 每 50 页清理一次
            if (page_num + 1) % 50 == 0:
                gc.collect()

        return results

    def _process_parallel(
        self, page_data_list: List[Tuple], total_pages: int
    ) -> List[str]:
        """并行处理页面"""
        results = [""] * len(page_data_list)
        completed = 0

        logger.info(f"[OCR] 使用 {self.max_workers} 个进程并行处理 {len(page_data_list)} 页")

        with ProcessPoolExecutor(
            max_workers=self.max_workers,
            initializer=_init_worker,
            initargs=(self.use_angle_cls, self.lang, self.use_gpu, self.show_log),
        ) as executor:
            # 提交所有任务
            future_to_page = {
                executor.submit(_process_page, data): data[0]
                for data in page_data_list
                if data[1]  # 跳过空图像
            }

            # 处理完成的任务
            for future in as_completed(future_to_page):
                page_num = future_to_page[future]
                try:
                    page_num, text = future.result()
                    results[page_num] = text
                    completed += 1

                    if completed % 10 == 0 or completed == len(page_data_list):
                        logger.info(f"[OCR] 进度: {completed}/{len(page_data_list)} 页")

                except Exception as e:
                    logger.error(f"[OCR] 第 {page_num+1} 页处理异常: {e}")
                    results[page_num] = ""

        return results
