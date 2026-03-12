# 智谱 GLM-OCR 集成设计方案

## 背景

当前 Docker 镜像约 14GB，主要原因是 PaddlePaddle 和 PaddleOCR 依赖占用大量空间。为了精简镜像，计划将本地 OCR 替换为智谱 GLM-OCR API 服务。

## 目标

- 将 Docker 镜像从 ~14GB 精简到 ~2-3GB
- 移除 PaddlePaddle/PaddleOCR 依赖
- 保持现有 OCR 接口不变
- 设计可扩展的 OCR 后端架构，方便后续切换其他服务

## 架构变更

```
┌─────────────────────────────────────────────────────────────┐
│  当前架构 (14GB)                    新架构 (~2-3GB)         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐                   ┌─────────────┐          │
│  │  FastAPI    │                   │  FastAPI    │          │
│  │  Backend    │                   │  Backend    │          │
│  └──────┬──────┘                   └──────┬──────┘          │
│         │                                 │                  │
│         ▼                                 │ HTTP API         │
│  ┌─────────────┐                          │                  │
│  │ PaddleOCR   │  ← 移除                  ▼                  │
│  │ (本地 10G+) │                   ┌─────────────┐          │
│  └─────────────┘                   │ 智谱 GLM-OCR │          │
│                                    │ (云端服务)   │          │
│                                    └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## 模块设计

### 1. OCR 后端抽象

设计可扩展的 OCR 后端接口，方便后续切换其他服务。

**文件结构：**

```
backend/pageindex-lib/src/pageindex/pdf/ocr/
├── __init__.py          # 工厂函数 get_ocr_extractor()
├── base.py              # BaseOCRExtractor 抽象基类
├── zhipu_extractor.py   # 智谱 GLM-OCR 实现
├── detector.py          # (保留) PDF 类型检测
└── paddle_extractor.py  # (删除)
```

### 2. 抽象基类

```python
# ocr/base.py
from abc import ABC, abstractmethod
from typing import List, Optional

class BaseOCRExtractor(ABC):
    """OCR 提取器基类"""

    @abstractmethod
    def extract_from_pdf(
        self,
        pdf_path: str,
        dpi: int = 200,
        max_pages: Optional[int] = None
    ) -> List[str]:
        """从 PDF 提取文本，返回每页的文本列表"""
        pass

    @abstractmethod
    def extract_from_image(self, image_path: str) -> str:
        """从单张图片提取文本"""
        pass
```

### 3. 工厂函数

```python
# ocr/__init__.py
from .base import BaseOCRExtractor
from .zhipu_extractor import ZhipuOCRExtractor

def get_ocr_extractor(backend: str = "zhipu", **kwargs) -> BaseOCRExtractor:
    """获取 OCR 提取器实例"""
    if backend == "zhipu":
        return ZhipuOCRExtractor(**kwargs)
    raise ValueError(f"不支持的 OCR 后端: {backend}")
```

### 4. 智谱 GLM-OCR 实现

```python
# ocr/zhipu_extractor.py
class ZhipuOCRExtractor(BaseOCRExtractor):
    def __init__(self, api_key: str, timeout: int = 30, max_retries: int = 3):
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.endpoint = "https://open.bigmodel.cn/api/paas/v4/layout_parsing"

    def extract_from_pdf(self, pdf_path: str, dpi: int = 200,
                         max_pages: Optional[int] = None) -> List[str]:
        """
        1. 使用 PyMuPDF 将 PDF 每页转为 PNG
        2. 将 PNG 转为 Base64 Data URL
        3. 逐页调用智谱 GLM-OCR API
        4. 返回每页文本列表
        """
        pass

    def _call_api(self, image_base64: str) -> str:
        """
        调用智谱 OCR API
        POST https://open.bigmodel.cn/api/paas/v4/layout_parsing
        Body: { "model": "glm-ocr", "file": "data:image/png;base64,..." }
        """
        pass
```

### 5. 后续扩展示例

添加新 OCR 后端只需：
1. 创建 `xxx_extractor.py` 实现 `BaseOCRExtractor`
2. 在工厂函数中注册

## 配置变更

### config.py

```python
class Settings:
    # OCR 配置
    OCR_BACKEND: str = "zhipu"  # 预留扩展
    ZHIPU_API_KEY: str = ""     # 从环境变量读取
    OCR_TIMEOUT: int = 30       # API 超时时间（秒）
    OCR_MAX_RETRIES: int = 3    # 失败重试次数
```

### 环境变量 (.env)

```
ZHIPU_API_KEY=your_api_key_here
```

## 依赖变更

### 保留的依赖

- PyMuPDF - PDF 转图片
- PIL - 图片处理
- httpx 或 requests - API 调用（项目中已有）

### 移除的依赖

- paddleocr
- paddlepaddle

## Dockerfile 改造

基于现有的 `Dockerfile.slim`，但启用 OCR（通过智谱 API）：

```dockerfile
# 不再需要 sed 删除 paddle 依赖
# 不再需要 libgl1-mesa-glx 等 OpenCV 依赖
# 不再需要 DISABLE_OCR 环境变量

FROM python:3.11-slim-bookworm AS builder
# ... 保持原有结构

ENV ZHIPU_API_KEY=""  # 运行时通过 docker run -e 注入
```

## 实现步骤

1. **创建 OCR 抽象层**
   - 新建 `ocr/base.py`
   - 更新 `ocr/__init__.py` 添加工厂函数

2. **实现智谱 OCR**
   - 新建 `ocr/zhipu_extractor.py`
   - 实现 PDF 转图片 + API 调用逻辑

3. **更新配置**
   - 在 `config.py` 添加 OCR 相关配置
   - 更新 `.env.example`

4. **清理旧依赖**
   - 删除 `paddle_extractor.py`
   - 从 `pyproject.toml` 移除 paddleocr 依赖
   - 更新 `uv.lock`

5. **更新 Dockerfile**
   - 移除 OpenCV 相关系统依赖
   - 移除 DISABLE_OCR 环境变量

6. **测试验证**
   - 单元测试：OCR 提取器
   - 集成测试：完整索引流程
   - Docker 构建：验证镜像大小

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 智谱 API 不支持 Base64 Data URL | 回退到临时文件服务方案 |
| API 调用失败 | 重试机制 + 明确错误提示 |
| API 配额限制 | 可配置并发数，避免超限 |
| 网络延迟 | 异步调用，不阻塞主流程 |

## 参考资料

- [智谱 GLM-OCR 文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr)
- [智谱 API 调用示例](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr#调用示例)
