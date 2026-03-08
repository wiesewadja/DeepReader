# LLM 树搜索功能设计

## 概述

为 DeepReader 添加 "深度思考" 检索模式，使用 LLM 在 PageIndex 生成的树结构上进行推理检索，替代默认的向量/BM25 混合检索。

## 背景

### PageIndex 官方设计理念

PageIndex 的核心理念是 **Vectorless RAG**：
- 不依赖向量数据库
- 使用 LLM 直接在树结构上推理
- 模拟人类专家"查目录"的检索方式
- 返回推理过程，可解释性强

### DeepReader 现有实现

当前 DeepReader 使用混合检索：
- ChromaDB 向量检索
- BM25 关键词检索
- 标题匹配 + 层级传播
- 混合评分排序

### 目标

将 LLM 树搜索作为**可选功能**，用户通过前端 "深度思考" 按钮手动启用。

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 触发时机 | 前端按钮手动触发 | 用户主动选择，成本可控 |
| 检索策略 | 完全替代 | 符合 Vectorless RAG 理念，逻辑清晰 |
| 实现位置 | 新建独立模块 | 职责分离，便于维护和扩展 |
| Prompt 策略 | 带层级路径 | 平衡效率与准确性 |
| 内容获取 | 从 tree_structure 提取 | 不依赖向量库，数据完整 |
| API 设计 | 扩展现有 QueryRequest | 向后兼容，API 简洁 |
| 返回格式 | 增加 thinking 字段 | 展示推理过程，增强信任 |
| 失败处理 | 静默降级 | 用户体验优先 |
| 超时策略 | 15秒超时 + 2次重试 | 平衡响应速度和成功率 |

---

## 架构设计

### 整体流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Obsidian)                          │
│  [普通搜索]  ←───────────────────→  [深度思考] 按钮              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Layer (routes.py)                      │
│                                                                 │
│  POST /query                                                    │
│  {                                                              │
│    "query": "...",                                              │
│    "index_id": "...",                                           │
│    "use_llm_tree_search": true  ← 新增字段                      │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐    ┌─────────────────────────────────┐
│  现有流程                │    │  新增流程                        │
│  querier.py              │    │  llm_tree_search.py (新建)       │
│  ├─ ChromaDB 向量检索    │    │  ├─ 构建层级 Prompt              │
│  ├─ smart_search.py      │    │  ├─ LLM 推理 → node_list         │
│  └─ 混合评分             │    │  ├─ 从 tree_structure 提取内容   │
│                          │    │  └─ 失败时降级到现有流程         │
└──────────────────────────┘    └─────────────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        响应格式                                 │
│                                                                 │
│  {                                                              │
│    "status": "success",                                         │
│    "results": [...],                                            │
│    "search_method": "llm_tree_search",  // 或 "hybrid_..."      │
│    "thinking": "LLM 推理过程...",        // 仅 LLM 模式有       │
│    "fallback": true,                    // 仅降级时有           │
│    "fallback_reason": "..."             // 仅降级时有           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `services/llm_tree_search.py` | 新建 | LLM 树搜索核心实现 |
| `api/models.py` | 修改 | 扩展 QueryRequest 和 QueryResponse |
| `api/routes.py` | 修改 | 透传新参数 |
| `services/querier.py` | 修改 | 增加分支逻辑和降级处理 |

---

## 详细设计

### 1. LLM 树搜索模块 (llm_tree_search.py)

#### 核心函数签名

```python
from dataclasses import dataclass
from typing import Dict, Any, List, Optional

@dataclass
class LLMTreeSearchResult:
    """LLM 树搜索结果"""
    node_ids: List[str]       # LLM 选中的节点 ID
    thinking: str             # LLM 推理过程
    success: bool             # 是否成功
    error: Optional[str] = None  # 失败原因


async def llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    llm_client,
    doc_name: str = "",
    max_results: int = 5,
    timeout: int = 15,
    max_retries: int = 2,
) -> LLMTreeSearchResult:
    """
    使用 LLM 在文档树结构上进行推理检索

    Args:
        query: 用户查询
        tree_structure: PageIndex 生成的树结构
        llm_client: LLM 客户端
        doc_name: 文档名称
        max_results: 最大返回节点数
        timeout: 单次调用超时（秒）
        max_retries: 最大重试次数

    Returns:
        LLMTreeSearchResult
    """
    pass


def extract_nodes_by_ids(
    tree_structure: Dict[str, Any],
    node_ids: List[str],
) -> List[Dict[str, Any]]:
    """
    根据 node_id 列表从 tree_structure 中提取节点内容

    Returns:
        List of {node_id, title, text, summary, path, start_index, end_index}
    """
    pass


def build_tree_prompt(
    tree_structure: Dict[str, Any],
    query: str,
    doc_name: str = "",
    max_results: int = 5,
) -> str:
    """
    构建带层级路径的 Prompt
    """
    pass


def format_tree_structure(
    tree_structure: Dict[str, Any],
    indent: int = 0,
    max_text_length: int = 100,
) -> str:
    """
    将树结构格式化为可读的文本格式

    输出示例:
    ├── 第一章 投资入门 (node_id: 0001)
    │   摘要: 介绍投资的基本概念...
    │   ├── 1.1 什么是投资 (node_id: 0002)
    │   │   摘要: 投资的定义和分类...
    """
    pass
```

#### Prompt 模板

```python
TREE_SEARCH_PROMPT = """你是一个专业的文档检索助手。你的任务是根据用户的问题，在文档目录结构中找到最相关的章节。

## 文档信息
文档名称: {doc_name}

## 目录结构
{tree_structure_text}

## 用户问题
{query}

## 你的任务
1. 仔细分析用户问题，理解其核心需求
2. 在目录结构中找到最可能包含答案的章节
3. 返回最相关的章节 ID 列表（最多 {max_results} 个）

## 响应格式
请严格按照以下 JSON 格式返回，不要添加任何其他内容：
```json
{{
  "thinking": "你的推理过程：分析问题的关键词，说明为什么选择这些章节...",
  "node_list": ["0001", "0003", "0005"]
}}
```

## 注意事项
- 优先选择叶子节点（最具体的章节）
- 如果问题涉及多个主题，可以跨章节选择
- 如果父章节的摘要已经涵盖了问题内容，也可以选择父章节
- node_id 必须是目录结构中存在的值
"""
```

### 2. API 模型扩展 (models.py)

```python
class QueryRequest(BaseModel):
    """查询请求"""
    query: str = Field(..., description="查询文本")
    index_id: str = Field(..., description="索引 ID")
    max_results: Optional[int] = Field(10, description="最大结果数")
    use_llm_tree_search: bool = Field(
        False,
        description="是否使用 LLM 树搜索（深度思考模式）"
    )


class QueryResponse(BaseModel):
    """查询响应"""
    status: str
    results: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None
    index_info: Optional[Dict[str, Any]] = None
    search_method: Optional[str] = None      # 新增: "llm_tree_search" 或 "hybrid_..."
    thinking: Optional[str] = None           # 新增: LLM 推理过程
    fallback: Optional[bool] = None          # 新增: 是否发生降级
    fallback_reason: Optional[str] = None    # 新增: 降级原因
```

### 3. 查询服务改动 (querier.py)

```python
class LLMTreeSearchError(Exception):
    """LLM 树搜索错误"""
    def __init__(self, message: str, error_type: str = "unknown"):
        self.message = message
        self.error_type = error_type  # timeout, parse_error, invalid_node, no_api_key
        super().__init__(message)


async def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 10,
    use_llm_tree_search: bool = False,
) -> Dict[str, Any]:
    """
    异步 PDF 查询

    支持两种检索模式:
    1. 混合检索（默认）: 向量 + BM25 + 标题匹配
    2. LLM 树搜索: 使用 LLM 推理定位章节
    """
    storage_dir_path = Path(storage_dir)
    index_metadata = get_index_metadata(storage_dir_path, index_id)
    tree_structure = index_metadata.get("tree_structure", {})

    # LLM 树搜索模式
    if use_llm_tree_search and tree_structure:
        try:
            result = await _query_with_llm_tree_search(
                query=query,
                tree_structure=tree_structure,
                index_metadata=index_metadata,
                max_results=max_results,
            )
            return result
        except LLMTreeSearchError as e:
            # 静默降级到混合检索
            logger.warning(f"[LLM树搜索] 失败，降级到混合检索: {e}")
            fallback_result = await _query_with_hybrid_search(
                query=query,
                index_id=index_id,
                storage_dir=storage_dir,
                max_results=max_results,
                index_metadata=index_metadata,
            )
            fallback_result["fallback"] = True
            fallback_result["fallback_reason"] = str(e)
            return fallback_result

    # 默认：混合检索
    return await _query_with_hybrid_search(...)


async def _query_with_llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    index_metadata: Dict[str, Any],
    max_results: int,
) -> Dict[str, Any]:
    """LLM 树搜索实现"""
    from .llm_tree_search import llm_tree_search, extract_nodes_by_ids
    from pageindex.llm import UnifiedLLM, get_provider
    from deeppdf.config import settings

    # 1. 获取 LLM 客户端
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("CHATGPT_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )
    if not api_key:
        raise LLMTreeSearchError("LLM API key not configured", "no_api_key")

    provider_config = {
        "type": settings.llm_provider,
        "api_key": api_key,
        "base_url": settings.llm_base_url,
    }
    provider = get_provider(provider_config)
    llm_client = UnifiedLLM(provider=provider, model=settings.llm_model)

    # 2. 执行 LLM 树搜索
    search_result = await llm_tree_search(
        query=query,
        tree_structure=tree_structure,
        llm_client=llm_client,
        doc_name=index_metadata.get("pdf_name", ""),
        max_results=max_results,
        timeout=15,
        max_retries=2,
    )

    if not search_result.success:
        raise LLMTreeSearchError(search_result.error, "llm_error")

    # 3. 提取节点内容
    nodes = extract_nodes_by_ids(tree_structure, search_result.node_ids)

    # 4. 格式化返回结果
    results = []
    for node in nodes:
        content = node.get("text") or node.get("summary", "")
        results.append({
            "text": content,
            "metadata": {
                "section": node.get("path", ""),
                "node_id": node.get("node_id"),
                "node_name": node.get("title"),
                "page": node.get("start_index"),
                "start_index": node.get("start_index"),
                "end_index": node.get("end_index"),
            }
        })

    return {
        "status": "success",
        "results": results,
        "search_method": "llm_tree_search",
        "thinking": search_result.thinking,
        "index_info": {
            "pdf_name": index_metadata.get("pdf_name", ""),
            "pdf_path": index_metadata.get("pdf_path", ""),
            "node_count": index_metadata.get("node_count", 0),
            "created_at": index_metadata.get("created_at", ""),
        },
    }
```

---

## 降级与错误处理

### 降级触发条件

| 场景 | 处理方式 |
|------|---------|
| LLM API 超时（>15秒） | 重试，2次后降级 |
| LLM 返回非 JSON 格式 | 重试，2次后降级 |
| LLM 返回的 node_id 不存在 | 重试，2次后降级 |
| tree_structure 为空 | 直接使用混合检索 |
| LLM API 密钥未配置 | 直接使用混合检索 |

### 降级响应示例

```json
{
  "status": "success",
  "results": [...],
  "search_method": "hybrid_title_bm25_vector",
  "thinking": null,
  "fallback": true,
  "fallback_reason": "LLM API timeout after 2 retries (30s total)",
  "index_info": {...}
}
```

---

## 前端集成要点

### 按钮设计

- 按钮文案: "深度思考" 或 "Deep Search"
- 图标: 可使用灯泡或大脑图标
- 状态: 加载中显示 spinner

### 交互流程

1. 用户输入查询
2. 点击 "深度思考" 按钮
3. 前端发送请求，`use_llm_tree_search: true`
4. 显示加载状态（可能需要 10-30 秒）
5. 展示结果 + LLM 推理过程（thinking）
6. 如果降级，可显示提示 "已自动切换到普通搜索"

---

## 测试计划

### 单元测试

- [ ] `format_tree_structure()` 格式化正确性
- [ ] `build_tree_prompt()` Prompt 生成正确性
- [ ] `extract_nodes_by_ids()` 节点提取正确性
- [ ] LLM 返回解析（正常 JSON、格式错误、空响应）

### 集成测试

- [ ] LLM 树搜索正常流程
- [ ] 降级流程（超时、API 错误）
- [ ] 与现有混合检索的切换

### 端到端测试

- [ ] 前端按钮触发 LLM 树搜索
- [ ] thinking 内容正确展示
- [ ] 降级提示正确展示

---

## 实现步骤

1. **创建 llm_tree_search.py**
   - 实现 `format_tree_structure()`
   - 实现 `build_tree_prompt()`
   - 实现 `llm_tree_search()`
   - 实现 `extract_nodes_by_ids()`

2. **修改 API 层**
   - 扩展 `QueryRequest`
   - 扩展 `QueryResponse`
   - 修改路由逻辑

3. **修改 querier.py**
   - 添加 `LLMTreeSearchError`
   - 添加 `_query_with_llm_tree_search()`
   - 修改 `query_pdf()` 分支逻辑

4. **前端集成**
   - 添加 "深度思考" 按钮
   - 处理新响应字段
   - 展示 thinking 内容

---

## 参考资源

- [PageIndex 官方文档](https://docs.pageindex.ai)
- [PageIndex Tree Search Tutorial](https://github.com/VectifyAI/PageIndex/tree/main/tutorials/tree-search)
- [Vectorless RAG Notebook](https://github.com/VectifyAI/PageIndex/blob/main/cookbook/pageindex_RAG_simple.ipynb)

---

## 实现状态

- [x] Task 1: 创建 LLM 树搜索核心模块
- [x] Task 2: 实现树结构格式化函数
- [x] Task 3: 实现 Prompt 构建函数
- [x] Task 4: 实现 LLM 响应解析函数
- [x] Task 5: 实现节点提取函数
- [x] Task 6: 实现核心 LLM 树搜索函数
- [x] Task 7: 扩展 API 模型
- [x] Task 8: 修改 querier.py 添加 LLM 树搜索支持
- [x] Task 9: 修改 API 路由
- [x] Task 10: 集成测试
- [x] Task 11: 最终验证和文档

**实现完成日期**: 2026-03-08

### 测试覆盖

- 单元测试: 15 个测试 (`tests/test_llm_tree_search.py`)
- 集成测试: 3 个测试 (`tests/test_llm_tree_search_integration.py`)
- 总计: 18 个测试全部通过

### 文件改动

| 文件 | 类型 | 说明 |
|------|------|------|
| `services/llm_tree_search.py` | 新建 | LLM 树搜索核心模块 |
| `services/querier.py` | 修改 | 添加 LLM 树搜索支持和降级逻辑 |
| `api/models.py` | 修改 | 扩展 QueryRequest 和 QueryResponse |
| `api/routes.py` | 修改 | 透传 use_llm_tree_search 参数 |
| `tests/test_llm_tree_search.py` | 新建 | 单元测试 |
| `tests/test_llm_tree_search_integration.py` | 新建 | 集成测试 |
