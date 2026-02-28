# 跨书籍联合阅读功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现跨书籍联合阅读功能，允许用户在所有已索引书籍中搜索相关内容

**Architecture:** 模式切换开关 + 新增跨书籍搜索工具。前端添加切换开关，后端新增跨书籍搜索服务和 API 端点，Agent 根据模式选择不同工具集。

**Tech Stack:** Python FastAPI, ChromaDB, TypeScript, Obsidian Plugin API

---

## Task 1: 后端 - 跨书籍搜索服务

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/services/cross_book_search.py`
- Test: `backend/deeppdf-api/tests/test_cross_book_search.py`

**Step 1: Write the failing test**

```python
# tests/test_cross_book_search.py
import pytest
from deeppdf.services.cross_book_search import cross_book_search, get_all_indexes


class TestCrossBookSearch:
    def test_get_all_indexes(self):
        """测试获取所有索引列表"""
        indexes = get_all_indexes(storage_dir="data")
        assert isinstance(indexes, list)
        # 每个索引应该包含 id 和 book_name
        for idx in indexes:
            assert "id" in idx
            assert "book_name" in idx

    def test_cross_book_search_basic(self):
        """测试基本跨书籍搜索"""
        result = cross_book_search(
            query="阅读方法",
            storage_dir="data",
            top_k=5
        )
        assert result["status"] == "success"
        assert "results" in result
        assert "books_searched" in result

    def test_cross_book_search_with_index_ids(self):
        """测试指定索引 ID 的跨书籍搜索"""
        # 先获取所有索引
        indexes = get_all_indexes(storage_dir="data")
        if len(indexes) < 2:
            pytest.skip("需要至少 2 个索引")

        index_ids = [idx["id"] for idx in indexes[:2]]
        result = cross_book_search(
            query="思考",
            storage_dir="data",
            index_ids=index_ids,
            top_k=3
        )
        assert result["status"] == "success"
        assert result["books_searched"] == 2
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_cross_book_search.py -v`
Expected: FAIL with "ModuleNotFoundError" or "ImportError"

**Step 3: Write minimal implementation**

```python
# src/deeppdf/services/cross_book_search.py
"""
跨书籍搜索服务

在所有已索引的书籍中搜索相关内容
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

from deeppdf.storage.chroma_store import ChromaStore

logger = logging.getLogger(__name__)


def get_all_indexes(storage_dir: str) -> List[Dict[str, Any]]:
    """
    获取所有已索引的书籍列表

    Args:
        storage_dir: 存储目录路径

    Returns:
        索引列表，每个元素包含 id, book_name, doc_type 等
    """
    storage_path = Path(storage_dir)
    indexes_dir = storage_path / "indexes"

    if not indexes_dir.exists():
        return []

    indexes = []
    for index_file in indexes_dir.glob("*.json"):
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                metadata = json.load(f)
                indexes.append({
                    "id": metadata.get("id"),
                    "book_name": metadata.get("pdf_name", "Unknown"),
                    "doc_type": metadata.get("doc_type", "pdf"),
                    "node_count": metadata.get("node_count", 0),
                })
        except Exception as e:
            logger.warning(f"读取索引文件失败: {index_file}, 错误: {e}")

    return indexes


def cross_book_search(
    query: str,
    storage_dir: str,
    index_ids: Optional[List[str]] = None,
    top_k: int = 5
) -> Dict[str, Any]:
    """
    在多本书籍中搜索相关内容

    Args:
        query: 搜索关键词
        storage_dir: 存储目录路径
        index_ids: 可选，指定要搜索的索引 ID 列表。不传则搜索全部
        top_k: 每本书返回的结果数量

    Returns:
        {
            "status": "success" | "error",
            "results": [
                {
                    "text": "...",
                    "book_name": "书名",
                    "index_id": "idx_xxx",
                    "section": "章节名",
                    "page": 页码,
                    "obsidian_link": "DeepPDF/书名/章节.md#^page-N"
                }
            ],
            "books_searched": 搜索的书籍数量,
            "total_results": 总结果数量
        }
    """
    if not query or query.strip() == "":
        return {"status": "error", "error": "Query cannot be empty"}

    storage_path = Path(storage_dir)
    chroma_dir = storage_path / "chroma"

    # 获取所有索引
    all_indexes = get_all_indexes(storage_dir)

    # 过滤要搜索的索引
    if index_ids:
        target_indexes = [idx for idx in all_indexes if idx["id"] in index_ids]
    else:
        target_indexes = all_indexes

    if not target_indexes:
        return {
            "status": "success",
            "results": [],
            "books_searched": 0,
            "total_results": 0
        }

    # 初始化 ChromaStore
    store = ChromaStore(persist_directory=str(chroma_dir))

    all_results = []
    books_searched = 0

    for idx_info in target_indexes:
        index_id = idx_info["id"]
        book_name = idx_info["book_name"]

        try:
            # 在该索引中搜索
            results = store.query(
                collection_name=index_id,
                query_texts=[query],
                n_results=top_k
            )

            if results["ids"] and results["ids"][0]:
                books_searched += 1
                for i, doc_id in enumerate(results["ids"][0]):
                    text = results["documents"][0][i] if results["documents"] else ""
                    metadata = results["metadatas"][0][i] if results["metadatas"] else {}

                    section = metadata.get("section", "Unknown")
                    page = metadata.get("page", metadata.get("start_index", 0))

                    # 构建 Obsidian 链接
                    safe_book_name = book_name.replace("/", "-")
                    safe_section = section.replace("/", "-").replace(">", "-").strip()
                    obsidian_link = f"DeepPDF/{safe_book_name}/{safe_section}.md#^page-{page}"

                    all_results.append({
                        "text": text,
                        "book_name": book_name,
                        "index_id": index_id,
                        "section": section,
                        "page": page,
                        "obsidian_link": obsidian_link,
                        "distance": results.get("distances", [[]])[0][i] if results.get("distances") else None
                    })
        except Exception as e:
            logger.warning(f"搜索索引 {index_id} 失败: {e}")
            continue

    # 按距离排序，取前 top_k * len(target_indexes) 个结果
    all_results.sort(key=lambda x: x.get("distance", 1) or 1)
    max_results = top_k * len(target_indexes)
    all_results = all_results[:max_results]

    return {
        "status": "success",
        "results": all_results,
        "books_searched": books_searched,
        "total_results": len(all_results)
    }
```

**Step 4: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_cross_book_search.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deeppdf/services/cross_book_search.py tests/test_cross_book_search.py
git commit -m "feat(backend): 添加跨书籍搜索服务

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 后端 - API 端点

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py` (添加新端点)
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py` (添加请求/响应模型)
- Test: `backend/deeppdf-api/tests/test_cross_book_api.py`

**Step 1: Write the failing test**

```python
# tests/test_cross_book_api.py
import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app


client = TestClient(app)


class TestCrossBookAPI:
    def test_cross_book_search_endpoint(self):
        """测试跨书籍搜索 API 端点"""
        response = client.post(
            "/api/cross-book/search",
            json={
                "query": "阅读",
                "top_k": 3
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "results" in data
        assert "books_searched" in data

    def test_cross_book_search_with_index_ids(self):
        """测试指定索引 ID 的跨书籍搜索"""
        # 先获取索引列表
        list_response = client.get("/api/indexes")
        assert list_response.status_code == 200
        indexes = list_response.json().get("indexes", [])

        if len(indexes) < 1:
            pytest.skip("需要至少 1 个索引")

        index_ids = [idx["id"] for idx in indexes[:1]]
        response = client.post(
            "/api/cross-book/search",
            json={
                "query": "思考",
                "index_ids": index_ids,
                "top_k": 2
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    def test_cross_book_search_empty_query(self):
        """测试空查询"""
        response = client.post(
            "/api/cross-book/search",
            json={
                "query": "",
                "top_k": 3
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "error"
```

**Step 2: Run test to verify it fails**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_cross_book_api.py -v`
Expected: FAIL with "404 Not Found"

**Step 3: Add request/response models**

在 `src/deeppdf/api/models.py` 末尾添加：

```python
# ============================================================
# 跨书籍搜索模型
# ============================================================

class CrossBookSearchRequest(BaseModel):
    """跨书籍搜索请求"""
    query: str = Field(..., description="搜索关键词", min_length=1)
    index_ids: Optional[List[str]] = Field(None, description="指定索引 ID 列表，不传则搜索全部")
    top_k: int = Field(5, description="每本书返回的结果数量", ge=1, le=20)


class CrossBookSearchResult(BaseModel):
    """跨书籍搜索结果项"""
    text: str = Field(..., description="匹配的文本内容")
    book_name: str = Field(..., description="来源书籍名称")
    index_id: str = Field(..., description="索引 ID")
    section: str = Field(..., description="章节名称")
    page: int = Field(..., description="页码")
    obsidian_link: str = Field(..., description="Obsidian wiki 链接")


class CrossBookSearchResponse(BaseModel):
    """跨书籍搜索响应"""
    status: str = Field(..., description="状态: success 或 error")
    results: List[CrossBookSearchResult] = Field(default_factory=list, description="搜索结果列表")
    books_searched: int = Field(0, description="搜索的书籍数量")
    total_results: int = Field(0, description="总结果数量")
    error: Optional[str] = Field(None, description="错误信息")
```

**Step 4: Add API endpoint**

在 `src/deeppdf/api/routes.py` 末尾添加：

```python
# ============================================================
# 跨书籍搜索 API
# ============================================================

@router.post("/cross-book/search", response_model=CrossBookSearchResponse)
async def cross_book_search(body: CrossBookSearchRequest):
    """
    跨书籍搜索

    在所有已索引的书籍中搜索相关内容

    Args:
        body: 搜索请求

    Returns:
        搜索结果，包含来源书籍信息
    """
    logger.info(f"[跨书籍搜索] query='{body.query}', index_ids={body.index_ids}, top_k={body.top_k}")

    from ..services.cross_book_search import cross_book_search

    try:
        result = await asyncio.to_thread(
            cross_book_search,
            query=body.query,
            storage_dir=str(settings.base_dir),
            index_ids=body.index_ids,
            top_k=body.top_k
        )

        logger.info(f"[跨书籍搜索] 完成: 搜索了 {result['books_searched']} 本书, 找到 {result['total_results']} 条结果")

        return CrossBookSearchResponse(**result)

    except Exception as e:
        logger.error(f"[跨书籍搜索] 失败: {e}")
        return CrossBookSearchResponse(
            status="error",
            error=str(e)
        )
```

**Step 5: Run test to verify it passes**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_cross_book_api.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add src/deeppdf/api/routes.py src/deeppdf/api/models.py tests/test_cross_book_api.py
git commit -m "feat(api): 添加跨书籍搜索 API 端点

POST /api/cross-book/search
- 支持全库搜索或指定索引搜索
- 返回来源书籍信息和 Obsidian 链接

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Agent - 新增工具类

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py` (添加 CrossBookSearchTool 和 ListBooksTool)
- Modify: `backend/deeppdf-api/src/deeppdf/agent/executor.py` (注册新工具)

**Step 1: Add CrossBookSearchTool**

在 `src/deeppdf/agent/tools.py` 的工具类列表后添加：

```python
# ============================================================
# 跨书籍模式工具
# ============================================================

class CrossBookSearchTool:
    """跨书籍搜索工具 - 在所有已索引书籍中搜索"""

    name: str = "cross_book_search"
    description: str = (
        "在所有已索引的书籍中搜索相关内容。"
        "适用于：主题研究（如'认知偏差在哪些书中提到'）、观点对比、跨书籍知识串联。"
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 每本书返回结果数，默认5\n\n"
        "**返回格式：** JSON 数组，每个元素包含：\n"
        "- text: 文档片段内容\n"
        "- book_name: 来源书籍名称\n"
        "- section: 章节名\n"
        "- page: 页码\n"
        "- obsidian_link: Obsidian wiki 链接\n\n"
        "**使用方法：** 在回答中引用来源书籍，格式：【《书名》章节名】"
    )

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir

    def __call__(self, query: str, top_k: int = 5) -> str:
        from ..services.cross_book_search import cross_book_search
        import json

        result = cross_book_search(
            query=query,
            storage_dir=self.storage_dir,
            top_k=top_k
        )

        if result["status"] != "success":
            return f"搜索失败: {result.get('error', 'Unknown error')}"

        if not result["results"]:
            return "未找到相关内容"

        # 格式化输出
        output_lines = [f"在 {result['books_searched']} 本书中找到 {result['total_results']} 条相关内容:\n"]

        for i, r in enumerate(result["results"], 1):
            output_lines.append(
                f"{i}. 【《{r['book_name']}》{r['section']}】(第{r['page']}页)\n"
                f"   {r['text'][:200]}...\n"
            )

        return "\n".join(output_lines)


class ListAvailableBooksTool:
    """列出所有可搜索的书籍"""

    name: str = "list_available_books"
    description: str = (
        "列出当前所有已索引的可搜索书籍。"
        "在开始跨书籍研究前，建议先调用此工具了解可用的书籍范围。"
        "无需任何参数。"
    )

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self._cache: Optional[str] = None

    def __call__(self, **kwargs) -> str:
        if self._cache is not None:
            return self._cache

        from ..services.cross_book_search import get_all_indexes

        indexes = get_all_indexes(self.storage_dir)

        if not indexes:
            return "当前没有已索引的书籍"

        lines = [f"当前共有 {len(indexes)} 本已索引的书籍:\n"]

        for i, idx in enumerate(indexes, 1):
            doc_type_icon = "📘" if idx.get("doc_type") == "epub" else "📕"
            lines.append(
                f"{i}. {doc_type_icon} 《{idx['book_name']}》 "
                f"(节点数: {idx.get('node_count', 'N/A')})"
            )

        self._cache = "\n".join(lines)
        return self._cache
```

**Step 2: Commit**

```bash
git add src/deeppdf/agent/tools.py
git commit -m "feat(agent): 添加跨书籍搜索工具

- CrossBookSearchTool: 在所有书籍中搜索
- ListAvailableBooksTool: 列出可搜索的书籍

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Agent - 模式切换逻辑

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/core.py` (添加 cross_book_mode 参数)
- Modify: `backend/deeppdf-api/src/deeppdf/agent/prompts.py` (添加跨书籍模式 prompt)
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py` (修改 chat 端点)

**Step 1: Modify Agent initialization**

在 `src/deeppdf/agent/core.py` 的 `DeepPDFAgent.__init__` 方法中添加参数：

```python
def __init__(
    self,
    index_id: str,
    index_metadata: Dict[str, Any],
    llm_client: LLMClient,
    storage_dir: str,
    cross_book_mode: bool = False,  # 新增：跨书籍模式
):
    # ... existing code ...

    self.cross_book_mode = cross_book_mode

    # 根据模式选择工具
    if cross_book_mode:
        self.tools = self._init_cross_book_tools()
    else:
        self.tools = self._init_single_book_tools()

def _init_single_book_tools(self) -> List[Tool]:
    """初始化单书籍模式工具"""
    from .tools import (
        InspectTocTool,
        ReadPageTool,
        SmartSearchTool,
    )

    return [
        InspectTocTool(self.tree_structure),
        ReadPageTool(
            pdf_path=self.pdf_path,
            markdown_files=self.markdown_files,
            total_pages=self.total_pages,
        ),
        SmartSearchTool(
            index_id=self.index_id,
            storage_dir=self.storage_dir,
            index_metadata=self.index_metadata,
        ),
    ]

def _init_cross_book_tools(self) -> List[Tool]:
    """初始化跨书籍模式工具"""
    from .tools import (
        CrossBookSearchTool,
        ListAvailableBooksTool,
    )

    return [
        CrossBookSearchTool(storage_dir=self.storage_dir),
        ListAvailableBooksTool(storage_dir=self.storage_dir),
    ]
```

**Step 2: Add cross-book system prompt**

在 `src/deeppdf/agent/prompts.py` 中添加：

```python
CROSS_BOOK_SYSTEM_PROMPT = """你是 DeepPDF 跨书籍研究助手。用户正在研究一个主题，你可以在所有已索引的书籍中搜索相关内容。

## 可用工具

- **cross_book_search**: 在所有书籍中搜索关键词
- **list_available_books**: 列出当前可搜索的所有书籍

## 回答规范

1. **标注来源**：引用内容时标注来源书籍，格式：【《书名》章节名】
2. **对比呈现**：多本书籍有相关内容时，对比呈现不同观点
3. **深入建议**：如果某本书特别相关，建议用户深入阅读该书

## 示例回答

关于"系统思考"，我在以下书籍中找到相关内容：

【《如何阅读一本书》第一篇】提到阅读是一种系统性的活动，需要...

【《第五项修炼》第一章】定义系统思考为...

【《思考快与慢》】则从认知心理学角度...

综合来看，系统思考包含三个层面：...
"""
```

**Step 3: Modify chat endpoint**

在 `src/deeppdf/api/routes.py` 的 `/chat` 端点中添加 `cross_book_mode` 参数：

```python
class ChatRequest(BaseModel):
    # ... existing fields ...
    cross_book_mode: bool = Field(False, description="是否启用跨书籍模式")

@router.post("/chat")
async def chat(body: ChatRequest):
    # ... existing code ...

    # 创建 Agent 时传入 cross_book_mode
    agent = DeepPDFAgent(
        index_id=body.index_id,
        index_metadata=index_metadata,
        llm_client=llm_client,
        storage_dir=str(settings.base_dir),
        cross_book_mode=body.cross_book_mode,  # 新增
    )
```

**Step 4: Commit**

```bash
git add src/deeppdf/agent/core.py src/deeppdf/agent/prompts.py src/deeppdf/api/routes.py
git commit -m "feat(agent): 支持 cross_book_mode 模式切换

- Agent 根据模式选择不同工具集
- 跨书籍模式使用专用 system prompt

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 前端 - API 客户端

**Files:**
- Modify: `frontend/src/api/http-client.ts`

**Step 1: Add crossBookSearch method**

在 `DeepPDFClient` 类中添加：

```typescript
/**
 * 跨书籍搜索
 */
async crossBookSearch(
  query: string,
  indexIds?: string[],
  topK: number = 5
): Promise<CrossBookSearchResponse> {
  const response = await fetch(`${this.baseUrl}/api/cross-book/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      index_ids: indexIds,
      top_k: topK,
    }),
  });

  if (!response.ok) {
    throw new Error(`Cross-book search failed: ${response.statusText}`);
  }

  return response.json();
}
```

在文件顶部添加类型定义：

```typescript
// 跨书籍搜索类型
export interface CrossBookSearchResult {
  text: string;
  book_name: string;
  index_id: string;
  section: string;
  page: number;
  obsidian_link: string;
}

export interface CrossBookSearchResponse {
  status: string;
  results: CrossBookSearchResult[];
  books_searched: number;
  total_results: number;
  error?: string;
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/http-client.ts
git commit -m "feat(frontend): 添加跨书籍搜索 API 客户端

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: 前端 - 模式切换 UI

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`
- Create: `frontend/src/components/mode-switch/mode-switch.ts`
- Create: `frontend/src/components/mode-switch/styles.css`

**Step 1: Create ModeSwitch component**

```typescript
// frontend/src/components/mode-switch/mode-switch.ts
import { setIcon } from "obsidian";

export type ReadingMode = "single" | "cross";

export class ModeSwitch {
  private container: HTMLElement;
  private currentMode: ReadingMode;
  private onModeChange: (mode: ReadingMode) => void;

  constructor(parent: HTMLElement, onModeChange: (mode: ReadingMode) => void) {
    this.currentMode = "single";
    this.onModeChange = onModeChange;
    this.container = this.createUI();
    parent.appendChild(this.container);
  }

  private createUI(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "deeppdf-mode-switch";

    const singleBtn = document.createElement("button");
    singleBtn.className = "mode-btn active";
    singleBtn.textContent = "📖 单书籍";
    singleBtn.onclick = () => this.setMode("single");

    const crossBtn = document.createElement("button");
    crossBtn.className = "mode-btn";
    crossBtn.textContent = "📚 跨书籍";
    crossBtn.onclick = () => this.setMode("cross");

    wrapper.appendChild(singleBtn);
    wrapper.appendChild(crossBtn);

    this.singleBtn = singleBtn;
    this.crossBtn = crossBtn;

    return wrapper;
  }

  private setMode(mode: ReadingMode): void {
    this.currentMode = mode;

    // 更新按钮状态
    this.singleBtn.classList.toggle("active", mode === "single");
    this.crossBtn.classList.toggle("active", mode === "cross");

    // 触发回调
    this.onModeChange(mode);
  }

  getMode(): ReadingMode {
    return this.currentMode;
  }

  destroy(): void {
    this.container.remove();
  }
}
```

**Step 2: Add styles**

```css
/* frontend/src/components/mode-switch/styles.css */
.deeppdf-mode-switch {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--background-secondary);
  border-radius: 6px;
  margin-bottom: 8px;
}

.deeppdf-mode-switch .mode-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.deeppdf-mode-switch .mode-btn:hover {
  background: var(--background-modifier-hover);
}

.deeppdf-mode-switch .mode-btn.active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}
```

**Step 3: Integrate into sidebar-view.ts**

在 `sidebar-view.ts` 中：

```typescript
// 在类顶部添加属性
private crossBookMode: boolean = false;
private modeSwitch: ModeSwitch | null = null;

// 在渲染聊天面板时添加模式切换
private renderChatPanel(): void {
  // ... existing code ...

  // 在消息列表上方添加模式切换
  const modeSwitchContainer = contentEl.createDiv({ cls: "deeppdf-chat-mode-switch" });
  this.modeSwitch = new ModeSwitch(modeSwitchContainer, (mode) => {
    this.crossBookMode = mode === "cross";
    // 可选：显示提示
    new Notice(mode === "cross" ? "已切换到跨书籍模式" : "已切换到单书籍模式");
  });

  // ... rest of the code ...
}

// 修改 sendMessage 方法，传递 crossBookMode
private async sendMessage(): Promise<void> {
  // ... existing code ...

  const response = await this.apiClient.chat({
    index_id: this.currentIndexId,
    message: userMessage,
    session_id: this.sessionId,
    cross_book_mode: this.crossBookMode,  // 新增
  });

  // ... rest of the code ...
}
```

**Step 4: Commit**

```bash
git add frontend/src/components/mode-switch/ frontend/src/views/sidebar-view.ts
git commit -m "feat(frontend): 添加单书籍/跨书籍模式切换开关

- 新增 ModeSwitch 组件
- 集成到对话面板

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 集成测试与文档

**Files:**
- Test: `backend/deeppdf-api/tests/integration/test_cross_book_e2e.py`
- Modify: `docs/plans/2026-02-26-cross-book-reading-design.md`

**Step 1: Write integration test**

```python
# tests/integration/test_cross_book_e2e.py
"""
跨书籍联合阅读功能端到端测试
"""
import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app


client = TestClient(app)


class TestCrossBookE2E:
    def test_full_cross_book_flow(self):
        """测试完整的跨书籍对话流程"""
        # 1. 获取索引列表
        list_response = client.get("/api/indexes")
        assert list_response.status_code == 200
        indexes = list_response.json().get("indexes", [])

        if len(indexes) < 1:
            pytest.skip("需要至少 1 个索引")

        index_id = indexes[0]["id"]

        # 2. 跨书籍搜索
        search_response = client.post(
            "/api/cross-book/search",
            json={
                "query": "阅读方法",
                "top_k": 3
            }
        )
        assert search_response.status_code == 200
        search_data = search_response.json()
        assert search_data["status"] == "success"

        # 3. 使用跨书籍模式对话
        chat_response = client.post(
            "/api/chat",
            json={
                "index_id": index_id,
                "message": "有哪些书提到了阅读方法？",
                "cross_book_mode": True,
            }
        )
        # 流式响应，检查是否成功开始
        assert chat_response.status_code == 200
```

**Step 2: Run integration test**

Run: `cd backend/deeppdf-api && uv run pytest tests/integration/test_cross_book_e2e.py -v`
Expected: PASS

**Step 3: Final commit**

```bash
git add tests/integration/test_cross_book_e2e.py
git commit -m "test: 添加跨书籍联合阅读功能端到端测试

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] 跨书籍搜索 API 返回正确结果，包含来源书籍信息
- [ ] 前端模式切换开关正常工作
- [ ] 单书籍模式行为不变
- [ ] 跨书籍模式下 AI 回答包含来源标注
- [ ] 所有测试通过

---

## 完成后操作

运行 `git log --oneline -10` 确认所有提交，然后可以启动服务进行手动测试：

```bash
# 后端
cd backend/deeppdf-api
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio

# 前端
cd frontend
npm run dev
```
