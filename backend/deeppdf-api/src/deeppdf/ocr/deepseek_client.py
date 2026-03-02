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

        logger.debug(
            f"[DeepSeekOCR] 使用 API Key: {self.api_key[:12]}...{self.api_key[-4:]}"
        )

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

        logger.info("=" * 60)
        logger.info(f"[DeepSeekOCR] ✅ 客户端初始化成功")
        logger.info(f"[DeepSeekOCR]    - 模型: {self.model}")
        logger.info(f"[DeepSeekOCR]    - API: {self.base_url}")
        logger.info(
            f"[DeepSeekOCR]    - API Key: {self.api_key[:12]}...{self.api_key[-4:]}"
        )
        logger.info(f"[DeepSeekOCR]    - 最大tokens: {self.max_tokens}")
        logger.info("=" * 60)

    def read_pdf_page(
        self,
        pdf_path: str,
        page_num: int,
        dpi: Optional[int] = None,
        prompt: str = """你是一个专业的 OCR 文字识别助手。请识别图片中的所有文字内容。

要求：
1. 只输出图片中实际的文字内容，不要添加任何解释、分析或推理
2. 保持原文的段落结构和换行格式
3. 如果图片中有中英文混合，请准确识别所有字符
4. 对于完全无法识别的文字或模糊区域，标注为 [无法识别]
5. 不要输出类似"我将分析"、"这是"等引导性语句
6. 直接输出识别出的文字内容，从开头到结尾""",
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

        logger.info("=" * 60)
        logger.info(f"[DeepSeekOCR] 🚀 开始处理页面")
        logger.info(f"[DeepSeekOCR]    - PDF: {pdf_path}")
        logger.info(f"[DeepSeekOCR]    - 页码: {page_num + 1}")
        logger.info(f"[DeepSeekOCR]    - DPI: {dpi}")
        logger.info("=" * 60)

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

        img_size_kb = len(img_data) / 1024
        logger.info(f"[DeepSeekOCR] 📷 图片转换完成")
        logger.info(f"[DeepSeekOCR]    - 尺寸: {pix.width} x {pix.height} px")
        logger.info(f"[DeepSeekOCR]    - 大小: {img_size_kb:.1f} KB")
        logger.info(f"[DeepSeekOCR]    - Base64长度: {len(base64_image)} 字符")

        # 3. 调用 API
        logger.info(f"[DeepSeekOCR] 🌐 调用 DeepSeek OCR API...")
        logger.info(f"[DeepSeekOCR]    - 模型: {self.model}")
        logger.info(f"[DeepSeekOCR]    - Base URL: {self.base_url}")
        logger.info(
            f"[DeepSeekOCR]    - API Key: {self.api_key[:12]}...{self.api_key[-4:]}"
        )
        logger.debug(f"[DeepSeekOCR]    - Prompt: {prompt[:100]}...")
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

            logger.info("=" * 60)
            logger.info(f"[DeepSeekOCR] ✅ 第 {page_num+1} 页识别成功")
            logger.info(f"[DeepSeekOCR]    - 识别字符数: {len(result)}")
            logger.info(f"[DeepSeekOCR]    - 内容预览: {result[:100]}...")
            logger.info("=" * 60)
            return result

        except Exception as e:
            logger.error("=" * 60)
            logger.error(f"[DeepSeekOCR] ❌ API 调用失败")
            logger.error(f"[DeepSeekOCR]    - 页码: {page_num + 1}")
            logger.error(f"[DeepSeekOCR]    - 错误: {e}")
            logger.error("=" * 60)
            raise
