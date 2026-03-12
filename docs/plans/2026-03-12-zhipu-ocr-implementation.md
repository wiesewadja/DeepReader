# 智谱 GLM-OCR 集成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将本地 PaddleOCR 替换为智谱 GLM-OCR API，精简 Docker 镜像从 ~14GB 到 ~2-3GB

**Architecture:** 创建可扩展的 OCR 后端抽象层（BaseOCRExtractor），实现智谱 GLM-OCR（ZhipuOCRExtractor），通过工厂函数获取实例。移除 PaddlePaddle 依赖，保留 PyMuPDF 用于 PDF 转图片。

**Tech Stack:** Python 3.10+, PyMuPDF, httpx, Pydantic Settings

---

## Task 1: 创建 OCR 抽象基类

**Files:**
- Create: `backend/pageindex-lib/src/pageindex/pdf/ocr/base.py`

**Step 1: 创建抽象基类文件**

```python
"""
OCR 提取器基类 - 定义统一的 OCR 接口

提供可扩展的 OCR 后端抽象，支持多种 OCR 服务实现。
"""
from abc import ABC, abstractmethod
from typing import List, Optional


class BaseOCRExtractor(ABC):
    """OCR 提取器抽象基类"""

    @abstractmethod
    def extract_from_pdf(
        self,
        pdf_path: str,
        dpi: int = 200,
        max_pages: Optional[int] = None,
    ) -> List[str]:
        """
        从 PDF 提取文本

        Args:
            pdf_path: PDF 文件路径
            dpi: 转换图片的 DPI（影响 OCR 质量）
            max_pages: 最大处理页数（None=全部）

        Returns:
            每页的文本列表，索引对应页码
        """
        pass

    @abstractmethod
    def extract_from_image(self, image_path: str) -> str:
        """
        从单张图片提取文本

        Args:
            image_path: 图片文件路径

        Returns:
            提取的文本内容
        """
        pass
```

**Step 2: 验证文件创建**

Run: `ls -la backend/pageindex-lib/src/pageindex/pdf/ocr/base.py`
Expected: 文件存在

**Step 3: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/pdf/ocr/base.py
git commit -m "feat(ocr): 添加 OCR 抽象基类 BaseOCRExtractor"
```

---

## Task 2: 实现智谱 GLM-OCR 提取器

**Files:**
- Create: `backend/pageindex-lib/src/pageindex/pdf/ocr/zhipu_extractor.py`

**Step 1: 创建智谱 OCR 提取器**

```python
"""
智谱 GLM-OCR 文本提取器

使用智谱 GLM-OCR API 从 PDF 和图片中提取文本。
API 文档: https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr
"""
import base64
import io
import logging
import time
from typing import List, Optional

import httpx

from .base import BaseOCRExtractor

logger = logging.getLogger(__name__)

# 尝试导入可选依赖
try:
    import pymupdf
except ImportError:
    pymupdf = None

try:
    from PIL import Image
except ImportError:
    Image = None


class ZhipuOCRExtractor(BaseOCRExtractor):
    """智谱 GLM-OCR 文本提取器"""

    API_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/layout_parsing"
    MODEL = "glm-ocr"

    def __init__(
        self,
        api_key: str,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        """
        初始化智谱 OCR 提取器

        Args:
            api_key: 智谱 API Key
            timeout: API 请求超时时间（秒）
            max_retries: 失败重试次数
            retry_delay: 重试间隔（秒），指数退避
        """
        if not api_key:
            raise ValueError("智谱 API Key 不能为空")

        if pymupdf is None:
            raise ImportError("PyMuPDF 未安装，请运行: pip install pymupdf")

        if Image is None:
            raise ImportError("PIL 未安装，请运行: pip install Pillow")

        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay

    def extract_from_pdf(
        self,
        pdf_path: str,
        dpi: int = 200,
        max_pages: Optional[int] = None,
    ) -> List[str]:
        """
        从 PDF 提取文本（逐页 OCR）

        Args:
            pdf_path: PDF 文件路径
            dpi: 转换图片的 DPI
            max_pages: 最大处理页数

        Returns:
            每页的文本列表
        """
        doc = pymupdf.open(pdf_path)
        total_pages = len(doc)
        pages_to_process = min(max_pages or total_pages, total_pages)

        logger.info(f"[ZhipuOCR] 开始处理 PDF: {pages_to_process}/{total_pages} 页")

        results = [""] * pages_to_process

        for page_num in range(pages_to_process):
            try:
                # 将 PDF 页面转为图片
                page = doc[page_num]
                mat = pymupdf.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")

                # 转为 Base64 Data URL
                img_base64 = base64.b64encode(img_bytes).decode("utf-8")
                data_url = f"data:image/png;base64,{img_base64}"

                # 调用智谱 API
                text = self._call_api(data_url)
                results[page_num] = text

                logger.debug(f"[ZhipuOCR] 第 {page_num + 1}/{pages_to_process} 页完成")

            except Exception as e:
                logger.error(f"[ZhipuOCR] 第 {page_num + 1} 页处理失败: {e}")
                results[page_num] = ""

        doc.close()
        logger.info(f"[ZhipuOCR] 处理完成: {pages_to_process} 页")
        return results

    def extract_from_image(self, image_path: str) -> str:
        """
        从单张图片提取文本

        Args:
            image_path: 图片文件路径

        Returns:
            提取的文本内容
        """
        with open(image_path, "rb") as f:
            img_bytes = f.read()

        img_base64 = base64.b64encode(img_bytes).decode("utf-8")

        # 根据文件扩展名确定 MIME 类型
        if image_path.lower().endswith(".png"):
            mime_type = "image/png"
        elif image_path.lower().endswith((".jpg", ".jpeg")):
            mime_type = "image/jpeg"
        else:
            mime_type = "image/png"  # 默认

        data_url = f"data:{mime_type};base64,{img_base64}"
        return self._call_api(data_url)

    def _call_api(self, image_data_url: str) -> str:
        """
        调用智谱 OCR API

        Args:
            image_data_url: Base64 Data URL (data:image/png;base64,...)

        Returns:
            提取的文本内容
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.MODEL,
            "file": image_data_url,
        }

        last_error = None

        for attempt in range(self.max_retries):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        self.API_ENDPOINT,
                        headers=headers,
                        json=payload,
                    )

                if response.status_code == 200:
                    result = response.json()
                    # 解析返回结果
                    # 智谱 OCR 返回格式需要根据实际 API 响应调整
                    return self._parse_response(result)

                elif response.status_code == 429:
                    # 速率限制，等待后重试
                    wait_time = self.retry_delay * (2 ** attempt)
                    logger.warning(f"[ZhipuOCR] 触发速率限制，等待 {wait_time} 秒后重试")
                    time.sleep(wait_time)
                    continue

                else:
                    last_error = f"API 请求失败: {response.status_code} - {response.text}"
                    logger.error(f"[ZhipuOCR] {last_error}")

            except httpx.TimeoutException:
                last_error = "API 请求超时"
                logger.warning(f"[ZhipuOCR] {last_error}，尝试重试")

            except Exception as e:
                last_error = f"API 调用异常: {e}"
                logger.error(f"[ZhipuOCR] {last_error}")

            # 重试前等待
            if attempt < self.max_retries - 1:
                wait_time = self.retry_delay * (2 ** attempt)
                time.sleep(wait_time)

        raise RuntimeError(f"OCR API 调用失败: {last_error}")

    def _parse_response(self, result: dict) -> str:
        """
        解析智谱 OCR API 响应

        Args:
            result: API 返回的 JSON 数据

        Returns:
            提取的文本内容
        """
        # 智谱 layout_parsing API 返回格式：
        # {"content": "提取的文本内容", ...}
        # 需要根据实际 API 响应调整

        if "content" in result:
            return result["content"]

        # 备用解析逻辑
        if "data" in result and isinstance(result["data"], dict):
            return result["data"].get("content", "")

        # 如果无法解析，返回空字符串并记录警告
        logger.warning(f"[ZhipuOCR] 无法解析 API 响应: {result}")
        return ""
```

**Step 2: 验证文件创建**

Run: `ls -la backend/pageindex-lib/src/pageindex/pdf/ocr/zhipu_extractor.py`
Expected: 文件存在

**Step 3: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/pdf/ocr/zhipu_extractor.py
git commit -m "feat(ocr): 实现智谱 GLM-OCR 提取器 ZhipuOCRExtractor"
```

---

## Task 3: 更新 OCR 模块导出和工厂函数

**Files:**
- Modify: `backend/pageindex-lib/src/pageindex/pdf/ocr/__init__.py`

**Step 1: 更新 __init__.py**

```python
"""
OCR 子模块 - PDF 视觉检测和 OCR 文本提取

本模块提供：
    - PDF 类型检测：判断 PDF 是否为扫描文档或图表密集型
    - OCR 提取：使用多种 OCR 后端提取 PDF 文本

使用示例:
    >>> from pageindex.pdf.ocr import detect_pdf_type, get_ocr_extractor
    >>>
    >>> # 检测 PDF 类型
    >>> result = detect_pdf_type("document.pdf")
    >>> print(f"视觉密集型: {result.is_visual_heavy}")
    >>>
    >>> # 使用智谱 OCR 提取
    >>> extractor = get_ocr_extractor(backend="zhipu", api_key="your_key")
    >>> texts = extractor.extract_from_pdf("scanned.pdf")
"""

from .base import BaseOCRExtractor
from .detector import VisualDetector, detect_pdf_type, VisualDetectionResult
from .zhipu_extractor import ZhipuOCRExtractor

__all__ = [
    # 基类
    "BaseOCRExtractor",
    # 工厂函数
    "get_ocr_extractor",
    # 视觉检测
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    # OCR 实现
    "ZhipuOCRExtractor",
]


def get_ocr_extractor(backend: str = "zhipu", **kwargs) -> BaseOCRExtractor:
    """
    获取 OCR 提取器实例（工厂函数）

    Args:
        backend: OCR 后端类型，目前支持 "zhipu"
        **kwargs: 传递给 OCR 提取器的参数

    Returns:
        OCR 提取器实例

    Raises:
        ValueError: 不支持的 OCR 后端

    Example:
        >>> extractor = get_ocr_extractor(backend="zhipu", api_key="your_key")
        >>> texts = extractor.extract_from_pdf("document.pdf")
    """
    if backend == "zhipu":
        return ZhipuOCRExtractor(**kwargs)

    raise ValueError(
        f"不支持的 OCR 后端: {backend}。目前支持: zhipu"
    )
```

**Step 2: 验证语法**

Run: `cd backend && uv run python -c "from pageindex.pdf.ocr import get_ocr_extractor, ZhipuOCRExtractor, BaseOCRExtractor; print('OK')"`
Expected: 输出 "OK"

**Step 3: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/pdf/ocr/__init__.py
git commit -m "feat(ocr): 添加 get_ocr_extractor 工厂函数，移除 PaddleOCR 导出"
```

---

## Task 4: 删除 PaddleOCR 提取器

**Files:**
- Delete: `backend/pageindex-lib/src/pageindex/pdf/ocr/paddle_extractor.py`

**Step 1: 删除文件**

Run: `rm backend/pageindex-lib/src/pageindex/pdf/ocr/paddle_extractor.py`
Expected: 文件已删除

**Step 2: 验证删除**

Run: `ls backend/pageindex-lib/src/pageindex/pdf/ocr/`
Expected: 只包含 `__init__.py`, `base.py`, `detector.py`, `zhipu_extractor.py`

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(ocr): 移除 PaddleOCRExtractor"
```

---

## Task 5: 更新上层模块导出

**Files:**
- Modify: `backend/pageindex-lib/src/pageindex/pdf/__init__.py`
- Modify: `backend/pageindex-lib/src/pageindex/__init__.py`

**Step 1: 更新 pdf/__init__.py**

将 `PaddleOCRExtractor` 替换为 `ZhipuOCRExtractor` 和 `get_ocr_extractor`:

```python
"""
PDF 处理模块

包含：
    - PDFParser: PDF 解析器（pypdf、PyMuPDF）
    - OCR: 视觉检测和 OCR 提取
    - Token 计数工具
"""

from .parser import (
    PDFParser,
    get_page_tokens,
    get_text_of_pages,
    get_text_of_pdf_pages,
    get_text_of_pdf_pages_with_labels,
)
from .tokens import (
    count_tokens,
    get_encoding_for_model,
    estimate_tokens_from_chars,
    get_model_encoding_name,
    tokenize,
    decode_tokens,
)
# OCR 导出
from .ocr import (
    VisualDetector,
    detect_pdf_type,
    VisualDetectionResult,
    BaseOCRExtractor,
    ZhipuOCRExtractor,
    get_ocr_extractor,
)

__all__ = [
    # 解析器类
    "PDFParser",
    # PDF 解析便捷函数
    "get_page_tokens",
    "get_text_of_pages",
    "get_text_of_pdf_pages",
    "get_text_of_pdf_pages_with_labels",
    # Token 计数函数
    "count_tokens",
    "get_encoding_for_model",
    "estimate_tokens_from_chars",
    "get_model_encoding_name",
    "tokenize",
    "decode_tokens",
    # OCR
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "BaseOCRExtractor",
    "ZhipuOCRExtractor",
    "get_ocr_extractor",
]
```

**Step 2: 更新 pageindex/__init__.py**

将 `PaddleOCRExtractor` 替换为新的导出:

```python
# 在 PDF 模块导入部分（约第 68-78 行）
from .pdf import (
    PDFParser,
    get_page_tokens,
    get_text_of_pages,
    count_tokens,
    # OCR
    VisualDetector,
    detect_pdf_type,
    VisualDetectionResult,
    BaseOCRExtractor,
    ZhipuOCRExtractor,
    get_ocr_extractor,
)

# 在 __all__ 列表中（约第 127-131 行）
    # OCR 模块
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "BaseOCRExtractor",
    "ZhipuOCRExtractor",
    "get_ocr_extractor",
```

**Step 3: 验证导入**

Run: `cd backend && uv run python -c "from pageindex import get_ocr_extractor, ZhipuOCRExtractor; print('OK')"`
Expected: 输出 "OK"

**Step 4: Commit**

```bash
git add backend/pageindex-lib/src/pageindex/pdf/__init__.py
git add backend/pageindex-lib/src/pageindex/__init__.py
git commit -m "refactor: 更新模块导出，使用新的 OCR 接口"
```

---

## Task 6: 更新 pyproject.toml 移除 PaddlePaddle 依赖

**Files:**
- Modify: `backend/pageindex-lib/pyproject.toml`

**Step 1: 移除 paddleocr 和 paddlepaddle 依赖**

将:
```toml
dependencies = [
    "tiktoken>=0.6.0",
    "openai>=1.30.0",
    "pymupdf>=1.24.0",
    "pypdf>=3.0.0",
    "pyyaml>=6.0.1",
    "python-dotenv>=1.0.0",
    "nest-asyncio>=1.6.0",
    "ebooklib>=0.18",
    "beautifulsoup4>=4.12.0",
    "html2text>=2020.1.16",
    "paddleocr>=2.7.0",
    "paddlepaddle>=3.3.0",
]
```

改为:
```toml
dependencies = [
    "tiktoken>=0.6.0",
    "openai>=1.30.0",
    "pymupdf>=1.24.0",
    "pypdf>=3.0.0",
    "pyyaml>=6.0.1",
    "python-dotenv>=1.0.0",
    "nest-asyncio>=1.6.0",
    "ebooklib>=0.18",
    "beautifulsoup4>=4.12.0",
    "html2text>=2020.1.16",
    "httpx>=0.25.0",
]
```

**Step 2: 更新 uv.lock**

Run: `cd backend && uv lock`
Expected: 成功更新 lock 文件

**Step 3: 同步依赖**

Run: `cd backend && uv sync`
Expected: 成功安装依赖（会移除 paddleocr）

**Step 4: Commit**

```bash
git add backend/pageindex-lib/pyproject.toml backend/uv.lock
git commit -m "chore: 移除 paddleocr/paddlepaddle 依赖，添加 httpx"
```

---

## Task 7: 更新配置文件

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/config.py`

**Step 1: 添加智谱 OCR 配置**

在 `Settings` 类中添加:

```python
    # 智谱 OCR 配置
    zhipu_api_key: Optional[str] = None
    ocr_backend: str = "zhipu"
    ocr_timeout: int = 30
    ocr_max_retries: int = 3
```

**Step 2: 验证配置**

Run: `cd backend && uv run python -c "from deeppdf.config import settings; print(f'ocr_backend: {settings.ocr_backend}')"`
Expected: 输出 "ocr_backend: zhipu"

**Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/config.py
git commit -m "feat(config): 添加智谱 OCR 配置项"
```

---

## Task 8: 更新测试文件

**Files:**
- Modify: `backend/pageindex-lib/tests/pdf/test_ocr.py`

**Step 1: 更新测试文件**

```python
"""测试 OCR 模块"""
import pytest
from unittest.mock import Mock, patch

from pageindex.pdf.ocr import (
    VisualDetector,
    ZhipuOCRExtractor,
    detect_pdf_type,
    get_ocr_extractor,
    BaseOCRExtractor,
)


def test_detector_init():
    """测试检测器初始化"""
    detector = VisualDetector(sample_pages=5)
    assert detector.sample_pages == 5


def test_get_ocr_extractor_zhipu():
    """测试获取智谱 OCR 提取器"""
    extractor = get_ocr_extractor(backend="zhipu", api_key="test_key")
    assert isinstance(extractor, ZhipuOCRExtractor)
    assert extractor.api_key == "test_key"


def test_get_ocr_extractor_invalid_backend():
    """测试无效后端"""
    with pytest.raises(ValueError, match="不支持的 OCR 后端"):
        get_ocr_extractor(backend="invalid")


def test_zhipu_extractor_init_without_api_key():
    """测试没有 API Key 时初始化失败"""
    with pytest.raises(ValueError, match="API Key 不能为空"):
        ZhipuOCRExtractor(api_key="")


@pytest.mark.skip(reason="需要真实 API Key 和网络连接")
def test_zhipu_extractor_extract_from_image():
    """测试从图片提取文本（需要真实 API）"""
    extractor = ZhipuOCRExtractor(api_key="your_real_key")
    # 需要真实图片路径
    # text = extractor.extract_from_image("test.png")
    pass


@pytest.mark.skip(reason="需要真实 PDF 文件和 API Key")
def test_zhipu_extractor_extract_from_pdf():
    """测试从 PDF 提取文本（需要真实 API）"""
    extractor = ZhipuOCRExtractor(api_key="your_real_key")
    # texts = extractor.extract_from_pdf("test.pdf")
    pass


@pytest.mark.skip(reason="需要 sample_pdf_path fixture")
def test_detect_pdf(sample_pdf_path):
    """测试检测 PDF"""
    result = detect_pdf_type(str(sample_pdf_path))
    assert hasattr(result, "is_visual_heavy")
    assert hasattr(result, "text_density")
```

**Step 2: 运行测试**

Run: `cd backend && uv run pytest pageindex-lib/tests/pdf/test_ocr.py -v`
Expected: 测试通过（跳过的除外）

**Step 3: Commit**

```bash
git add backend/pageindex-lib/tests/pdf/test_ocr.py
git commit -m "test(ocr): 更新测试用例，使用 ZhipuOCRExtractor"
```

---

## Task 9: 更新 Dockerfile

**Files:**
- Modify: `backend/Dockerfile`
- Delete: `backend/Dockerfile.slim`（合并到主 Dockerfile）

**Step 1: 更新 Dockerfile，移除 PaddleOCR 相关内容**

```dockerfile
# DeepPDF Backend Dockerfile - Optimized for size
# Uses uv for dependency management

FROM python:3.11-slim-bookworm AS builder

# Install system dependencies required for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY pyproject.toml uv.lock ./
COPY pageindex-lib/ ./pageindex-lib/
COPY deeppdf-api/ ./deeppdf-api/

# Install dependencies using uv with no cache
ENV UV_NO_CACHE=1
RUN uv sync --frozen --no-dev && \
    rm -rf /root/.cache/uv /app/.venv/share/doc /app/.venv/share/man

# Production stage
FROM python:3.11-slim-bookworm AS production

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && rm -rf /usr/share/doc /usr/share/man /usr/share/info

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash app

# Set working directory
WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code (only necessary files)
COPY --from=builder /app/deeppdf-api/src/ ./deeppdf-api/src/
COPY --from=builder /app/pageindex-lib/src/ ./pageindex-lib/src/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/deeppdf-api/src:/app/pageindex-lib/src" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=5088 \
    UVICORN_LOOP=asyncio \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create data directory for persistent storage
RUN mkdir -p /app/data /app/logs && chown -R app:app /app

# Switch to non-root user
USER app

# Expose port
EXPOSE 5088

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5088/health')" || exit 1

# Start the application
CMD ["uvicorn", "deeppdf.main:app", "--host", "0.0.0.0", "--port", "5088", "--loop", "asyncio"]
```

**Step 2: 删除 Dockerfile.slim**

Run: `rm backend/Dockerfile.slim`

**Step 3: Commit**

```bash
git add backend/Dockerfile
git rm backend/Dockerfile.slim
git commit -m "refactor(docker): 精简 Dockerfile，移除 PaddleOCR 依赖"
```

---

## Task 10: 验证构建和测试

**Step 1: 运行后端测试**

Run: `cd backend && uv run pytest pageindex-lib/tests/ -v --ignore=pageindex-lib/tests/pdf/test_ocr.py`
Expected: 所有测试通过

**Step 2: 验证 OCR 模块导入**

Run: `cd backend && uv run python -c "
from pageindex.pdf.ocr import get_ocr_extractor, ZhipuOCRExtractor, BaseOCRExtractor
from pageindex import get_ocr_extractor as get_ocr
print('OCR 模块导入成功')
"`
Expected: 输出 "OCR 模块导入成功"

**Step 3: 构建 Docker 镜像（可选）**

Run: `cd backend && docker build -t deepreader-backend:test .`
Expected: 构建成功，镜像大小约 2-3GB

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: 完成智谱 GLM-OCR 集成，移除 PaddlePaddle 依赖"
```

---

## 实现注意事项

1. **API 响应格式**: 智谱 GLM-OCR API 的实际响应格式可能与文档略有不同，实现后需要根据实际测试调整 `_parse_response` 方法

2. **速率限制**: 智谱 API 有调用频率限制，大批量处理时需要注意控制并发

3. **错误处理**: 已实现重试机制，但对于配额不足等不可恢复错误，需要明确提示用户

4. **向后兼容**: 如果有外部代码直接使用 `PaddleOCRExtractor`，需要更新为 `get_ocr_extractor()` 或 `ZhipuOCRExtractor`
