"""
DeepSeek OCR 客户端 - 硅基流动 API

使用硅基流动的 DeepSeek OCR API 进行视觉推理。
"""

# mypy: disable-error-code="import-untyped"
import base64
import logging
from typing import Optional

from openai import OpenAI

try:
    import pymupdf  # PyMuPDF # type: ignore[import-untyped]
except ImportError:
    pymupdf = None  # type: ignore[assignment]
    logging.warning("PyMuPDF not installed.")

from deeppdf.config import settings

logger = logging.getLogger(__name__)


class DeepSeekOCRClient:
    """DeepSeek OCR 客户端（硅基流动）"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ):
        """
        初始化客户端

        Args:
            api_key: 硅基流动 API Key（默认从 settings 读取）
            base_url: API 基础 URL（默认从 settings 读取）
            model: 模型名称（默认从 settings 读取）
            max_tokens: 最大生成 token 数（默认从 settings 读取）
        """
        self.api_key = api_key or settings.deepseek_ocr_api_key
        self.base_url = base_url or settings.deepseek_ocr_base_url
        self.model = model or settings.deepseek_ocr_model
        self.max_tokens = max_tokens or settings.deepseek_ocr_max_tokens

        if not self.api_key:
            raise ValueError("DEEPSEEK_OCR_API_KEY is required")

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

        logger.info(f"[DeepSeekOCR] 客户端初始化成功 (model={self.model})")

    def read_pdf_page(
        self,
        pdf_path: str,
        page_num: int,
        dpi: Optional[int] = None,
        prompt: str = "请详细阅读这张图片的内容，包括所有文字、图表、数据。请按原文结构输出，保持格式。",
    ) -> str:
        """
        使用 DeepSeek OCR 读取 PDF 页面

        Args:
            pdf_path: PDF 文件路径
            page_num: 页码（从 0 开始）
            dpi: 转换图片的 DPI（默认从 settings 读取）
            prompt: 提示词

        Returns:
            OCR 识别的文本内容
        """
        if pymupdf is None:
            raise ImportError("PyMuPDF is required for PDF to image conversion")

        dpi = dpi or settings.pdf_image_dpi

        # 1. 将 PDF 页面转换为图片
        doc = pymupdf.open(pdf_path)

        if page_num < 0 or page_num >= len(doc):
            doc.close()
            raise ValueError(f"页码超出范围: {page_num} (总页数: {len(doc)})")

        page = doc[page_num]
        mat = pymupdf.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        doc.close()

        # 2. 转换为 base64
        img_data = pix.tobytes("png")
        base64_image = base64.b64encode(img_data).decode("utf-8")

        logger.info(f"[DeepSeekOCR] 正在识别第 {page_num+1} 页...")

        # 3. 调用 API
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}"
                                },
                            },
                        ],
                    }
                ],
                max_tokens=self.max_tokens,
                stream=False,
            )

            result = response.choices[0].message.content
            if result is None:
                raise ValueError("OCR API 返回空内容")

            logger.info(f"[DeepSeekOCR] 第 {page_num+1} 页识别完成: {len(result)} 字符")
            return result

        except Exception as e:
            logger.error(f"[DeepSeekOCR] API 调用失败: {e}")
            raise
