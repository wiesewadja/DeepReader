# DeepSeek OCR 集成实施计划（重构版）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepPDF 添加视觉推理能力，支持扫描文档和图表密集型 PDF 的智能索引与问答

**架构设计:**

### 职责分离

**pageindex-lib/** - 文档解析库
- 提供 PDF 类型检测（判断是否需要 OCR）
- 提供 PaddleOCR 文本提取器
- 提供统一的 OCR 解析接口
- **不依赖外部 API 服务**

**deeppdf-api/** - API 服务层
- 集成 DeepSeek OCR 客户端（硅基流动 API）
- Agent 工具自动路由（普通 PDF vs 视觉密集型）
- 配置管理

### 核心流程

1. **索引阶段检测** → pageindex-lib 检测 PDF 类型，返回 `visual_heavy` 标记
2. **OCR 索引** → pageindex-lib 使用 PaddleOCR 提取全文
3. **视觉推理** → deeppdf-api 的 `read_page` 工具根据标记自动路由 DeepSeek OCR

**Tech Stack:**
- **PaddleOCR**: 传统 OCR 引擎（中文优化）
- **PyMuPDF (fitz)**: PDF 页面转图片
- **硅基流动 DeepSeek OCR**: `deepseek-ai/DeepSeek-OCR` API

---

## 第一阶段：pageindex-lib - OCR 模块

### Task 1: 添加 PaddleOCR 依赖到 pageindex-lib

**Files:**
- Modify: `backend/pageindex-lib/pyproject.toml`

**Step 1: 添加依赖**

在 `dependencies` 中添加：
```toml
"PaddleOCR>=2.7.0",
```

**Step 2: 安装依赖**

Run: `cd backend/pageindex-lib && uv add PaddleOCR`
Expected: 安装成功

**Step 3: 验证安装**

Run: `cd backend/pageindex-lib && uv run python -c "from paddleocr import PaddleOCR; print('OK')"`
Expected: 输出 "OK"

**Step 4: Commit**

```bash
git add backend/pageindex-lib/pyproject.toml
git commit -m "feat(pageindex-lib): add PaddleOCR dependency"
```

---

### Task 2: 创建 OCR 子模块

**Files:**
- Create: `backend/pageindex-lib/src/pageindex/pdf/ocr/__init__.py`
- Create: `backend/pageindex-lib/src/pageindex/pdf/ocr/detector.py`
- Create: `backend/pageindex-lib/src/pageindex/pdf/ocr/paddle_extractor.py`

**Step 1: 创建 OCR 模块初始化文件**

Create `backend/pageindex-lib/src/pageindex/pdf/ocr/__init__.py`:
```python
"""
OCR 子模块 - PDF 视觉检测和 OCR 文本提取

本模块提供：
    - PDF 类型检测：判断 PDF 是否为扫描文档或图表密集型
    - PaddleOCR 提取：使用 PaddleOCR 提取 PDF 文本

使用示例:
    >>> from pageindex.pdf.ocr import detect_pdf_type, PaddleOCRExtractor
    >>>
    >>> # 检测 PDF 类型
    >>> result = detect_pdf_type("document.pdf")
    >>> print(f"视觉密集型: {result.is_visual_heavy}")
    >>>
    >>> # OCR 提取
    >>> extractor = PaddleOCRExtractor()
    >>> texts = extractor.extract_from_pdf("scanned.pdf")
"""

from .detector import VisualDetector, detect_pdf_type, VisualDetectionResult
from .paddle_extractor import PaddleOCRExtractor

__all__ = [
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "PaddleOCRExtractor",
]
```

**Step 2: 创建视觉检测器**

Create `backend/pageindex-lib/src/pageindex/pdf/ocr/detector.py`:
```python
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
```

**Step 3: 创建 PaddleOCR 提取器**

Create `backend/pageindex-lib/src/pageindex/pdf/ocr/paddle_extractor.py`:
```python
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
    logging.warning("PaddleOCR not installed.")

try:
    import pymupdf  # PyMuPDF
except ImportError:
    pymupdf = None
    logging.warning("PyMuPDF not installed.")

try:
    from PIL import Image
except ImportError:
    Image = None
    logging.warning("PIL not installed.")

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
```

**Step 4: 更新 pdf/__init__.py 导出 OCR 功能**

Modify `backend/pageindex-lib/src/pageindex/pdf/__init__.py`:
```python
"""
PDF 处理模块

包含：
    - PDFParser: PDF 解析器（pypdf、PyMuPDF）
    - OCR: 视觉检测和 OCR 提取
    - Token 计数工具
"""

# 现有导出
from .parser import PDFParser
from .tokens import count_tokens, get_page_tokens, get_text_of_pages

# 新增 OCR 导出
from .ocr import VisualDetector, detect_pdf_type, VisualDetectionResult, PaddleOCRExtractor

__all__ = [
    "PDFParser",
    "count_tokens",
    "get_page_tokens",
    "get_text_of_pages",
    # OCR
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "PaddleOCRExtractor",
]
```

**Step 5: 创建测试**

Create `backend/pageindex-lib/tests/pdf/test_ocr.py`:
```python
"""测试 OCR 模块"""
import pytest
from pageindex.pdf.ocr import VisualDetector, PaddleOCRExtractor, detect_pdf_type


def test_detector_init():
    """测试检测器初始化"""
    detector = VisualDetector(sample_pages=5)
    assert detector.sample_pages == 5


def test_paddle_ocr_init():
    """测试 PaddleOCR 初始化"""
    extractor = PaddleOCRExtractor(use_gpu=False)
    assert extractor.ocr is not None


@pytest.mark.skipif(not pytest.config.getoption("--run-slow", default=False), reason="slow test")
def test_detect_pdf(sample_pdf_path):
    """测试检测 PDF"""
    result = detect_pdf_type(str(sample_pdf_path))
    assert hasattr(result, "is_visual_heavy")
    assert hasattr(result, "text_density")
```

**Step 6: 运行测试**

Run: `cd backend/pageindex-lib && uv run pytest tests/pdf/test_ocr.py -v`
Expected: 测试通过

**Step 7: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/pdf/ocr/
git add backend/pageindex-lib/src/pageindex/pdf/__init__.py
git add backend/pageindex-lib/tests/pdf/test_ocr.py
git commit -m "feat(pageindex-lib): add OCR detection and extraction module"
```

---

### Task 3: 在 pageindex-lib 主入口添加 OCR 支持

**Files:**
- Modify: `backend/pageindex-lib/src/pageindex/__init__.py`

**Step 1: 添加 OCR 导出**

在 `__all__` 和导入部分添加：
```python
# PDF 模块
from .pdf import (
    PDFParser,
    get_page_tokens,
    get_text_of_pages,
    count_tokens,
    # 新增 OCR
    VisualDetector,
    detect_pdf_type,
    VisualDetectionResult,
    PaddleOCRExtractor,
)

__all__ = [
    # ... 现有导出 ...
    # PDF 模块
    "PDFParser",
    "get_page_tokens",
    "get_text_of_pages",
    "count_tokens",
    # OCR 模块
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "PaddleOCRExtractor",
]
```

**Step 2: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/__init__.py
git commit -m "feat(pageindex-lib): export OCR functions from main module"
```

---

## 第二阶段：deeppdf-api - DeepSeek OCR 客户端

### Task 4: 添加 DeepSeek OCR 客户端

**Files:**
- Modify: `backend/deeppdf-api/pyproject.toml`
- Modify: `backend/deeppdf-api/src/deeppdf/config.py`
- Create: `backend/deeppdf-api/src/deeppdf/ocr/__init__.py`
- Create: `backend/deeppdf-api/src/deeppdf/ocr/deepseek_client.py`

**Step 1: 添加 openai 依赖（如果还没有）**

检查 `backend/deeppdf-api/pyproject.toml` 是否有 `openai`，如果没有则添加：
```toml
"openai>=1.0.0",
```

**Step 2: 添加配置**

在 `backend/deeppdf-api/src/deeppdf/config.py` 的 Settings 类中添加：
```python
# DeepSeek OCR 配置
deepseek_ocr_api_key: Optional[str] = None
deepseek_ocr_base_url: str = "https://api.siliconflow.cn/v1"
deepseek_ocr_model: str = "deepseek-ai/DeepSeek-OCR"
deepseek_ocr_max_tokens: int = 4096

# PDF 转图片配置
pdf_image_dpi: int = 200
pdf_image_format: str = "png"

# PDF 视觉检测阈值（与 pageindex-lib 对齐）
visual_detect_sample_pages: int = 10
visual_density_threshold: float = 0.3
visual_text_threshold: int = 50
```

**Step 3: 创建 OCR 模块**

Create `backend/deeppdf-api/src/deeppdf/ocr/__init__.py`:
```python
"""
OCR 模块 - DeepSeek OCR 客户端（硅基流动 API）
"""

from .deepseek_client import DeepSeekOCRClient

__all__ = ["DeepSeekOCRClient"]
```

**Step 4: 创建 DeepSeek OCR 客户端**

Create `backend/deeppdf-api/src/deeppdf/ocr/deepseek_client.py`:
```python
"""
DeepSeek OCR 客户端 - 硅基流动 API

使用硅基流动的 DeepSeek OCR API 进行视觉推理。
"""
import base64
import logging
from typing import Optional

from openai import OpenAI
try:
    import pymupdf  # PyMuPDF
except ImportError:
    pymupdf = None
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
            logger.info(f"[DeepSeekOCR] 第 {page_num+1} 页识别完成: {len(result)} 字符")
            return result

        except Exception as e:
            logger.error(f"[DeepSeekOCR] API 调用失败: {e}")
            raise
```

**Step 5: 创建测试**

Create `backend/deeppdf-api/tests/ocr/test_deepseek_client.py`:
```python
"""测试 DeepSeek OCR 客户端"""
import pytest
from deeppdf.ocr import DeepSeekOCRClient
from deeppdf.config import settings


def test_client_init():
    """测试客户端初始化（使用假 key）"""
    client = DeepSeekOCRClient(api_key="test-key")
    assert client.model == "deepseek-ai/DeepSeek-OCR"


def test_client_init_missing_key():
    """测试缺少 API Key"""
    with pytest.raises(ValueError):
        DeepSeekOCRClient(api_key=None)


@pytest.mark.skipif(not settings.deepseek_ocr_api_key, reason="需要 API Key")
def test_read_pdf_page(sample_pdf_path):
    """测试读取 PDF 页面"""
    client = DeepSeekOCRClient()
    result = client.read_pdf_page(str(sample_pdf_path), page_num=0)
    assert isinstance(result, str)
    assert len(result) > 0
```

**Step 6: 运行测试**

Run: `cd backend/deeppdf-api && uv run pytest tests/ocr/test_deepseek_client.py::test_client_init -v`
Expected: 测试通过

**Step 7: 更新 .env.example**

Add to `backend/deeppdf-api/.env.example`:
```bash
# DeepSeek OCR (硅基流动)
DEEPSEEK_OCR_API_KEY=your-api-key-here
DEEPSEEK_OCR_BASE_URL=https://api.siliconflow.cn/v1
DEEPSEEK_OCR_MODEL=deepseek-ai/DeepSeek-OCR
```

**Step 8: Commit**

```bash
git add backend/deeppdf-api/pyproject.toml
git add backend/deeppdf-api/src/deeppdf/config.py
git add backend/deeppdf-api/src/deeppdf/ocr/
git add backend/deeppdf-api/tests/ocr/test_deepseek_client.py
git add backend/deeppdf-api/.env.example
git commit -m "feat(deeppdf-api): add DeepSeek OCR client (SiliconFlow)"
```

---

## 第三阶段：集成到索引流程

### Task 5: 修改索引服务支持视觉检测

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/indexer.py`

**Step 1: 在 _index_pdf_sync 中添加视觉检测**

在 `pdf_path_obj = Path(pdf_path)` 之后、`# 解析 LLM 配置` 之前添加：
```python
# 步骤 1.5: 检测 PDF 类型（是否需要 OCR）
from pageindex.pdf.ocr import detect_pdf_type

detector_result = detect_pdf_type(
    pdf_path,
    sample_pages=config.get("visual_detect_sample_pages", settings.visual_detect_sample_pages),
    text_threshold=config.get("visual_text_threshold", settings.visual_text_threshold),
    image_threshold=config.get("visual_density_threshold", settings.visual_density_threshold),
)

is_visual_heavy = detector_result.is_visual_heavy
logger.info(f"[PDF分类] 检测结果: {'视觉密集型' if is_visual_heavy else '普通文本型'}")
logger.info(f"[PDF分类] 文本密度: {detector_result.text_density:.0f} 字符/页")
logger.info(f"[PDF分类] 图片密度: {detector_result.image_density*100:.1f}%")
logger.info(f"[PDF分类] 判断依据: {detector_result.reason}")
```

**Step 2: 修改元数据保存**

在 `_save_metadata` 函数的 `metadata_content` 中添加：
```python
metadata_content = {
    # ... 现有字段 ...
    "visual_heavy": is_visual_heavy,
    "visual_detection": {
        "text_density": detector_result.text_density,
        "image_density": detector_result.image_density,
        "reason": detector_result.reason,
        "sampled_pages": detector_result.sampled_pages,
    },
}
```

**Step 3: 测试索引流程**

Run: `curl -X POST http://localhost:6088/index -F "file=@test.pdf"`
Expected: 索引成功，返回的元数据中包含 `visual_heavy` 字段

**Step 4: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/services/indexer.py
git commit -m "feat(indexer): integrate visual detection from pageindex-lib"
```

---

## 第四阶段：Agent 工具路由

### Task 6: 修改 ReadPageTool 支持视觉路由

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py`
- Modify: `backend/deeppdf-api/src/deeppdf/agent/executor.py`
- Modify: `backend/deeppdf-api/src/deeppdf/agent/core.py`

**Step 1: 修改 ReadPageTool 初始化**

在 `backend/deeppdf-api/src/deeppdf/agent/tools.py` 中修改 `ReadPageTool.__init__`：

```python
def __init__(
    self,
    pageindex_lib_path: str,
    index_id: str,
    storage_dir: str,
    index_metadata: Optional[Dict[str, Any]] = None,
    deepseek_ocr_client: Optional[Any] = None,
):
    """
    初始化工具

    Args:
        pageindex_lib_path: PageIndex 库路径
        index_id: 索引 ID
        storage_dir: 存储目录
        index_metadata: 索引元数据（包含 visual_heavy 标记）
        deepseek_ocr_client: DeepSeek OCR 客户端（可选）
    """
    self.pageindex_lib_path = pageindex_lib_path
    self.index_id = index_id
    self.storage_dir = storage_dir
    self.index_metadata = index_metadata or {}
    self.deepseek_ocr_client = deepseek_ocr_client
    self._pi = None

    # 检测是否为视觉密集型 PDF
    self.is_visual_heavy = self.index_metadata.get("visual_heavy", False)
    if self.is_visual_heavy:
        logger.info(f"[ReadPageTool] 视觉密集型模式: {index_id}")
```

**Step 2: 修改 ReadPageTool.__call__ 添加路由**

替换 `ReadPageTool.__call__` 方法：

```python
def __call__(self, page_num: int, **kwargs: Any) -> str:
    """
    读取指定页码的内容

    Args:
        page_num: 页码（从 1 开始）
        **kwargs: 其他参数（兼容性保留）

    Returns:
        页面文本内容
    """
    # 如果是视觉密集型，使用 DeepSeek OCR
    if self.is_visual_heavy:
        return self._read_page_visual(page_num)

    # 否则使用普通文本读取
    return self._read_page_normal(page_num)


def _read_page_normal(self, page_num: int) -> str:
    """普通文本读取"""
    try:
        pi = self._load_page_index()

        # 验证页码范围
        if page_num < 1 or page_num > pi.page_count:
            return f"错误: 页码超出范围 (1-{pi.page_count})"

        # 获取页面内容
        page_content = pi.get_page(page_num)

        if not page_content or not page_content.strip():
            return f"第 {page_num} 页为空或无法读取"

        return page_content

    except Exception as e:
        logger.error(f"[ReadPageTool] 普通读取失败: {e}")
        return f"读取失败: {str(e)}"


def _read_page_visual(self, page_num: int) -> str:
    """视觉读取（DeepSeek OCR）"""
    if not self.deepseek_ocr_client:
        logger.error("[ReadPageTool] DeepSeek OCR 客户端未初始化")
        return "错误: OCR 客户端未配置"

    try:
        # 获取 PDF 路径
        pdf_path = self.index_metadata.get("pdf_path")
        if not pdf_path:
            return "错误: 无法找到 PDF 文件路径"

        # 调用 DeepSeek OCR（page_num 转为从 0 开始）
        result = self.deepseek_ocr_client.read_pdf_page(
            pdf_path=pdf_path,
            page_num=page_num - 1,
        )

        return result

    except Exception as e:
        logger.error(f"[ReadPageTool] 视觉读取失败: {e}")
        return f"读取失败: {str(e)}"
```

**Step 3: 修改 executor.py 传递参数**

在 `backend/deeppdf-api/src/deeppdf/agent/executor.py` 的 `create_tool_executor` 函数中：

```python
def create_tool_executor(
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    pageindex_lib_path: Optional[str] = None,
    markdown_locator: Optional[MarkdownLocator] = None,
    enable_llm_tree_search: bool = False,
    llm_client: Optional[Any] = None,
    index_metadata: Optional[Dict[str, Any]] = None,  # 新增
    deepseek_ocr_client: Optional[Any] = None,  # 新增
) -> ToolExecutor:
    """
    创建并配置工具执行器

    Args:
        index_metadata: 索引元数据（包含 visual_heavy 标记）
        deepseek_ocr_client: DeepSeek OCR 客户端
    """
    # ... 现有代码 ...

    # 3. ReadPageTool - 按页读取（需要 PageIndex）
    if pageindex_lib_path:
        tools["read_page"] = ReadPageTool(
            pageindex_lib_path,
            index_id,
            storage_dir,
            index_metadata=index_metadata,  # 新增
            deepseek_ocr_client=deepseek_ocr_client,  # 新增
        )
```

**Step 4: 修改 core.py 初始化 OCR 客户端**

在 `backend/deeppdf-api/src/deeppdf/agent/core.py` 的 `DeepPDFAgent.__init__` 中：

```python
# 如果 PDF 是视觉密集型，初始化 DeepSeek OCR 客户端
self.deepseek_ocr_client = None
if index_metadata and index_metadata.get("visual_heavy"):
    from deeppdf.ocr import DeepSeekOCRClient

    api_key = api_key or settings.deepseek_ocr_api_key
    if api_key:
        self.deepseek_ocr_client = DeepSeekOCRClient(api_key=api_key)
        logger.info("[Agent初始化] DeepSeek OCR 客户端已创建")
    else:
        logger.warning("[Agent初始化] visual_heavy=true 但未提供 API Key")

# 初始化工具执行器（传递新参数）
self.executor: ToolExecutor = create_tool_executor(
    index_id=index_id,
    storage_dir=storage_dir,
    tree_structure=tree_structure,
    pageindex_lib_path=pageindex_lib_path,
    markdown_locator=markdown_locator,
    enable_llm_tree_search=enable_llm_tree_search,
    llm_client=self.client if enable_llm_tree_search else None,
    index_metadata=index_metadata,  # 新增
    deepseek_ocr_client=self.deepseek_ocr_client,  # 新增
)
```

**Step 5: 测试工具路由**

```bash
# 1. 索引扫描文档
curl -X POST http://localhost:6088/index -F "file=@visual_test.pdf"

# 2. 测试问答
curl -X POST http://localhost:6088/agent/query \
  -H "Content-Type: application/json" \
  -d '{"index_id": "xxx", "message": "第一页有什么内容？"}'
```

Expected: Agent 自动使用 DeepSeek OCR 读取页面

**Step 6: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/tools.py
git add backend/deeppdf-api/src/deeppdf/agent/executor.py
git add backend/deeppdf-api/src/deeppdf/agent/core.py
git commit -m "feat(agent): add visual routing to read_page tool"
```

---

## 第五阶段：测试和文档

### Task 7: 创建集成测试

**Files:**
- Create: `backend/deeppdf-api/tests/integration/test_ocr_integration.py`

**Step 1: 创建集成测试**

```python
"""OCR 功能端到端测试"""
import pytest
from pathlib import Path
from pageindex.pdf.ocr import detect_pdf_type, PaddleOCRExtractor
from deeppdf.ocr import DeepSeekOCRClient
from deeppdf.config import settings


@pytest.mark.integration
class TestOCRIntegration:
    """OCR 集成测试"""

    def test_visual_detection_from_lib(self, sample_visual_pdf):
        """测试从 pageindex-lib 导入的视觉检测"""
        result = detect_pdf_type(str(sample_visual_pdf))
        assert result.is_visual_heavy is True

    def test_paddle_ocr_from_lib(self, sample_visual_pdf):
        """测试从 pageindex-lib 导入的 PaddleOCR"""
        extractor = PaddleOCRExtractor(use_gpu=False)
        texts = extractor.extract_from_pdf(str(sample_visual_pdf), max_pages=1)
        assert len(texts) == 1

    @pytest.mark.skipif(not settings.deepseek_ocr_api_key, reason="需要 API Key")
    def test_deepseek_ocr_read(self, sample_visual_pdf):
        """测试 DeepSeek OCR 读取"""
        client = DeepSeekOCRClient()
        result = client.read_pdf_page(str(sample_visual_pdf), page_num=0)
        assert isinstance(result, str)
        assert len(result) > 10
```

**Step 2: 运行集成测试**

Run: `cd backend/deeppdf-api && uv run pytest tests/integration/test_ocr_integration.py -v`
Expected: 所有测试通过

**Step 3: Commit**

```bash
git add backend/deeppdf-api/tests/integration/test_ocr_integration.py
git commit -m "test(ocr): add end-to-end integration tests"
```

---

### Task 8: 更新文档

**Files:**
- Create: `backend/deeppdf-api/docs/deepseek-ocr-guide.md`

**Step 1: 创建使用指南**

```markdown
# DeepSeek OCR 集成指南

## 功能概述

DeepPDF 现在支持扫描文档和图表密集型 PDF 的智能索引与问答。

## 架构说明

### 职责分离

**pageindex-lib/** - 文档解析库
- PDF 类型检测（判断是否需要 OCR）
- PaddleOCR 文本提取
- 不依赖外部 API 服务

**deeppdf-api/** - API 服务层
- DeepSeek OCR 客户端（硅基流动 API）
- Agent 工具自动路由

### 工作流程

1. **索引阶段**: pageindex-lib 检测 PDF 类型
2. **元数据标记**: 存储检测结果到索引元数据
3. **查询阶段**: Agent 根据 `visual_heavy` 标记自动路由

## 配置

### 环境变量

```bash
# DeepSeek OCR (硅基流动)
DEEPSEEK_OCR_API_KEY=your-api-key
DEEPSEEK_OCR_BASE_URL=https://api.siliconflow.cn/v1

# 视觉检测阈值
VISUAL_DETECT_SAMPLE_PAGES=10
VISUAL_DENSITY_THRESHOLD=0.3
VISUAL_TEXT_THRESHOLD=50
```

## 使用示例

### 1. 直接使用 pageindex-lib

```python
from pageindex.pdf.ocr import detect_pdf_type, PaddleOCRExtractor

# 检测 PDF 类型
result = detect_pdf_type("document.pdf")
print(f"视觉密集型: {result.is_visual_heavy}")

# OCR 提取
extractor = PaddleOCRExtractor()
texts = extractor.extract_from_pdf("scanned.pdf")
```

### 2. 使用 DeepSeek OCR

```python
from deeppdf.ocr import DeepSeekOCRClient

client = DeepSeekOCRClient()
text = client.read_pdf_page("document.pdf", page_num=0)
```

### 3. 完整流程（通过 API）

```bash
# 索引（自动检测）
curl -X POST http://localhost:6088/index -F "file=@scanned.pdf"

# 问答（自动路由）
curl -X POST http://localhost:6088/agent/query \
  -H "Content-Type: application/json" \
  -d '{"index_id": "idx_xxx", "message": "图表显示什么？"}'
```
```

**Step 2: Commit**

```bash
git add backend/deeppdf-api/docs/deepseek-ocr-guide.md
git commit -m "docs(ocr): add DeepSeek OCR integration guide"
```

---

## 总结

### 架构优势

1. **清晰的职责分离**
   - pageindex-lib: 文档解析能力（可复用）
   - deeppdf-api: API 服务和外部集成

2. **依赖方向合理**
   - deeppdf-api 依赖 pageindex-lib
   - pageindex-lib 不依赖 deeppdf-api

3. **可扩展性强**
   - 其他项目可以使用 pageindex-lib 的 OCR 功能
   - 可以轻松添加其他 OCR 服务（如本地 DeepSeek）

### 完成的功能

1. ✅ **pageindex-lib**: PDF 类型检测、PaddleOCR 提取
2. ✅ **deeppdf-api**: DeepSeek OCR 客户端
3. ✅ **索引集成**: 自动检测并标记 `visual_heavy`
4. ✅ **Agent 路由**: 根据标记自动选择读取方式
5. ✅ **测试覆盖**: 单元测试、集成测试
6. ✅ **文档完善**: 使用指南、架构说明
