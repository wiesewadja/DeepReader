# 外部嵌入 API 集成设计

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将本地嵌入模型替换为硅基流动 Embedding API，减少 Docker 镜像约 1.5-2GB

**Architecture:** 使用抽象基类 + 工厂函数模式，与 OCR 改造保持一致。通过 httpx 调用硅基流动 API，支持配置切换。

**Tech Stack:** Python 3.10+, httpx, ChromaDB, 硅基流动 Embedding API

---

## 1. 架构概览

**当前架构**:
```
ChromaDB → ChineseEmbeddingFunction → HuggingFaceEmbeddings → 本地模型文件
```

**新架构**:
```
ChromaDB → SiliconFlowEmbeddingFunction → httpx → 硅基流动 API
```

---

## 2. 模块设计

**文件结构**:
```
backend/deeppdf-api/src/deeppdf/storage/
├── embeddings.py          # 重构为工厂函数入口
├── embeddings/            # 新建目录
│   ├── __init__.py        # 导出 + 工厂函数
│   ├── base.py            # 抽象基类 BaseEmbeddingFunction
│   └── siliconflow.py     # 硅基流动实现
└── chroma_store.py        # 微调（使用工厂函数）
```

---

## 3. 依赖变更

**移除依赖** (`deeppdf-api/pyproject.toml`):
```diff
- "sentence-transformers>=3.0.0",
- "langchain-huggingface>=0.1.0",
```

**保留依赖**:
- `chromadb>=0.5.0` - 向量数据库
- `httpx>=0.25.0` - HTTP 客户端（已有）

---

## 4. 配置新增

**config.py**:
```python
# 嵌入 API 配置
embedding_backend: str = "siliconflow"
siliconflow_api_key: Optional[str] = None
embedding_model: str = "BAAI/bge-large-zh-v1.5"
embedding_timeout: int = 30
embedding_max_retries: int = 3
```

**docker-compose.yml**:
```yaml
- EMBEDDING_BACKEND=${EMBEDDING_BACKEND:-siliconflow}
- SILICONFLOW_API_KEY=${SILICONFLOW_API_KEY:-}
- EMBEDDING_MODEL=${EMBEDDING_MODEL:-BAAI/bge-large-zh-v1.5}
- EMBEDDING_TIMEOUT=${EMBEDDING_TIMEOUT:-30}
- EMBEDDING_MAX_RETRIES=${EMBEDDING_MAX_RETRIES:-3}
```

**.env.example**:
```bash
# 硅基流动 API Key（从 https://cloud.siliconflow.cn 获取）
SILICONFLOW_API_KEY=your_siliconflow_api_key_here

# 嵌入模型配置
EMBEDDING_BACKEND=siliconflow
EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
```

---

## 5. 核心接口设计

**抽象基类** (`embeddings/base.py`):
```python
from abc import ABC, abstractmethod
from typing import List

class BaseEmbeddingFunction(ABC):
    """嵌入函数抽象基类，兼容 ChromaDB 接口"""

    @abstractmethod
    def __call__(self, input: List[str]) -> List[List[float]]:
        """批量嵌入（ChromaDB 调用入口）"""
        pass

    @abstractmethod
    def embed_query(self, text: str) -> List[float]:
        """单个查询嵌入"""
        pass

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """批量文档嵌入"""
        return self(texts)
```

**硅基流动实现** (`embeddings/siliconflow.py`):
- API 端点: `https://api.siliconflow.cn/v1/embeddings`
- 模型: `BAAI/bge-large-zh-v1.5` (1024 维)
- 认证: `Authorization: Bearer <token>`
- 批量限制: 最多 256 个文本/次
- 重试逻辑: 指数退避，最多 3 次

---

## 6. 错误处理

| HTTP 状态码 | 含义 | 处理方式 |
|------------|------|---------|
| 401 | API Key 无效 | 抛出 ValueError |
| 429 | 请求过快 | 指数退避重试 |
| 503 | 服务不可用 | 重试后抛出 RuntimeError |

---

## 7. 测试策略

- **单元测试**: Mock HTTP 响应，测试解析逻辑
- **集成测试**: 真实 API 调用（`@pytest.mark.integration`）
- **覆盖场景**: 单文本、批量、错误重试、空输入

---

## 8. 预期效果

**镜像大小**: 3.01GB → ~1.0-1.5GB

**移除的依赖**:
- sentence-transformers (~500MB)
- transformers (~500MB)
- torch (~1.5GB)
- langchain-huggingface (~50MB)

---

## 9. 实现任务

### Task 1: 创建嵌入模块基础结构
- 创建 `embeddings/` 目录
- 创建 `base.py` 抽象基类
- 创建 `__init__.py` 工厂函数

### Task 2: 实现硅基流动嵌入函数
- 实现 `SiliconFlowEmbeddingFunction` 类
- HTTP 客户端管理
- 错误处理和重试逻辑

### Task 3: 更新配置
- 更新 `config.py`
- 更新 `docker-compose.yml`
- 更新 `.env.example`

### Task 4: 重构 embeddings.py
- 移除 `ChineseEmbeddingFunction` 旧实现
- 保留 `get_model_dimension` 等工具函数
- 添加工厂函数入口

### Task 5: 更新 chroma_store.py
- 使用新的工厂函数获取嵌入函数

### Task 6: 更新依赖
- 移除 `sentence-transformers`
- 移除 `langchain-huggingface`
- 更新 `uv.lock`

### Task 7: 添加测试
- 单元测试（Mock）
- 集成测试（真实 API）

### Task 8: 验证 Docker 构建
- 构建新镜像
- 验证镜像大小
- 验证功能正常
