# 阅读入口功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建一个 Obsidian Base 表格入口文档，统一管理所有已索引的 PDF 书籍，追踪阅读进度，并提供快速启动对话阅读的功能。

**Architecture:** 前端使用 `registerObsidianProtocolHandler` 注册 URI 协议处理，实现从 Markdown 链接跳转到 DeepPDF 对话界面。后端扩展索引元数据，记录阅读页码和对话轮数。书籍笔记按需创建，包含 frontmatter 进度数据。

**Tech Stack:** TypeScript (Obsidian Plugin API), Python FastAPI, Obsidian Base

---

## Task 1: 后端 - 扩展索引元数据字段

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/indexer.py`
- Modify: `backend/deeppdf-api/src/deeppdf/services/manager.py`

**Step 1: 更新索引元数据结构**

在 `indexer.py` 的 `_store_to_chromadb` 函数中，扩展 `collection_metadata`：

```python
# 在 backend/deeppdf-api/src/deeppdf/services/indexer.py
# 找到 collection_metadata 定义（约 396-404 行），添加新字段：

collection_metadata = {
    "doc_type": doc_type,
    "pdf_name": pdf_path_obj.name,
    "pdf_path": str(pdf_path_obj.absolute()),
    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    "node_count": len(section_nodes),
    "indexing_method": "pageindex_tree",
    "llm_enabled": True,
    # 新增阅读进度字段
    "read_pages": [],  # 已阅读页码列表
    "chat_rounds": 0,  # 对话轮数
    "last_read_at": None,  # 最后阅读时间
}
```

**Step 2: 添加阅读进度更新函数**

在 `manager.py` 末尾添加：

```python
def _update_reading_progress_sync(
    index_id: str,
    storage_dir: str,
    pages: list[int],
) -> Dict[str, Any]:
    """
    同步更新阅读进度
    """
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            return {"status": "error", "error": f"Index {index_id} not found"}

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 合并已阅读页码（去重）
        existing_pages = set(metadata.get("read_pages", []))
        existing_pages.update(pages)
        metadata["read_pages"] = sorted(list(existing_pages))

        # 更新最后阅读时间
        metadata["last_read_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "read_pages": metadata["read_pages"],
            "progress": len(metadata["read_pages"]) / metadata.get("total_pages", 1) * 100,
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


async def update_reading_progress(
    index_id: str,
    storage_dir: str,
    pages: list[int],
) -> Dict[str, Any]:
    """异步更新阅读进度"""
    import time
    result = await asyncio.to_thread(
        _update_reading_progress_sync, index_id, storage_dir, pages
    )
    return result
```

**Step 3: 添加导入**

在 `manager.py` 顶部添加：

```python
import time
```

**Step 4: 验证代码**

```bash
cd backend/deeppdf-api && uv run ruff check src/deeppdf/services/manager.py src/deeppdf/services/indexer.py
```

**Step 5: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/manager.py backend/deeppdf-api/src/deeppdf/services/indexer.py
git commit -m "feat(backend): 扩展索引元数据支持阅读进度追踪"
```

---

## Task 2: 后端 - 添加阅读进度 API 端点

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/api/reading_routes.py`
- Modify: `backend/deeppdf-api/src/deeppdf/main.py`

**Step 1: 创建 reading_routes.py**

```python
"""
阅读进度 API 路由
"""

import logging
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pathlib import Path

from ..config import settings
from ..services.manager import (
    _load_index_metadata_sync,
    update_reading_progress,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reading", tags=["reading"])


class UpdateProgressRequest(BaseModel):
    """更新进度请求"""
    pages: List[int] = Field(..., description="新增的已阅读页码列表")


class ProgressResponse(BaseModel):
    """进度响应"""
    index_id: str
    read_pages: List[int]
    total_pages: int
    progress: float
    status: str
    last_read_at: str | None = None
    chat_rounds: int = 0


@router.post("/{index_id}/progress", response_model=ProgressResponse)
async def update_progress(index_id: str, request: UpdateProgressRequest):
    """
    更新阅读进度

    添加新阅读的页码到已阅读列表
    """
    storage_dir = str(Path(settings.base_dir))

    # 检查索引是否存在
    metadata_result = _load_index_metadata_sync(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(status_code=404, detail=f"索引不存在: {index_id}")

    # 更新进度
    result = await update_reading_progress(
        index_id=index_id,
        storage_dir=storage_dir,
        pages=request.pages,
    )

    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("error"))

    # 获取更新后的元数据
    metadata = _load_index_metadata_sync(index_id, storage_dir).get("metadata", {})

    return ProgressResponse(
        index_id=index_id,
        read_pages=metadata.get("read_pages", []),
        total_pages=metadata.get("total_pages", 1),
        progress=len(metadata.get("read_pages", [])) / max(metadata.get("total_pages", 1), 1) * 100,
        status=metadata.get("status", "active"),
        last_read_at=metadata.get("last_read_at"),
        chat_rounds=metadata.get("chat_rounds", 0),
    )


@router.get("/{index_id}/progress", response_model=ProgressResponse)
async def get_progress(index_id: str):
    """
    获取阅读进度
    """
    storage_dir = str(Path(settings.base_dir))

    metadata_result = _load_index_metadata_sync(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(status_code=404, detail=f"索引不存在: {index_id}")

    metadata = metadata_result.get("metadata", {})

    return ProgressResponse(
        index_id=index_id,
        read_pages=metadata.get("read_pages", []),
        total_pages=metadata.get("total_pages", 1),
        progress=len(metadata.get("read_pages", [])) / max(metadata.get("total_pages", 1), 1) * 100,
        status=metadata.get("status", "active"),
        last_read_at=metadata.get("last_read_at"),
        chat_rounds=metadata.get("chat_rounds", 0),
    )
```

**Step 2: 注册路由到 main.py**

在 `main.py` 中添加路由导入和注册：

```python
# 在导入区域添加
from deeppdf.api.reading_routes import router as reading_router

# 在 app.include_router 调用区域添加
app.include_router(reading_router)
```

**Step 3: 验证代码**

```bash
cd backend/deeppdf-api && uv run ruff check src/deeppdf/api/reading_routes.py src/deeppdf/main.py
```

**Step 4: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/api/reading_routes.py backend/deeppdf-api/src/deeppdf/main.py
git commit -m "feat(backend): 添加阅读进度 API 端点"
```

---

## Task 3: 后端 - 对话接口集成进度更新

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 在对话响应中提取页码并更新进度**

找到 `query_pdf_stream` 函数，在返回响应前更新阅读进度：

```python
# 在 backend/deeppdf-api/src/deeppdf/api/routes.py
# 在 query_pdf_stream 函数中，找到生成响应的位置

# 在 yield 最后一个 chunk 后，添加进度更新逻辑
# 需要从检索结果中提取页码

# 在 stream结束时收集所有引用的页码
referenced_pages = set()
# 从 citation 信息中提取页码
for citation in citations:
    if citation.get("page"):
        referenced_pages.add(citation.get("page"))

# 更新阅读进度
if referenced_pages:
    await update_reading_progress(
        index_id=index_id,
        storage_dir=str(Path(settings.base_dir)),
        pages=list(referenced_pages),
    )
```

**注意：** 由于流式响应的特殊性，这个任务可能需要根据实际的流式实现调整。建议先跳过此任务，在 P1 阶段完善。

**Step 2: 提交（如实现了）**

```bash
git add backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(backend): 对话接口集成阅读进度更新"
```

---

## Task 4: 前端 - 添加阅读进度 API 客户端

**Files:**
- Modify: `frontend/src/api/http-client.ts`
- Modify: `frontend/src/api/index.ts`

**Step 1: 添加类型定义和 API 方法**

在 `http-client.ts` 中添加：

```typescript
// ==================== 阅读进度相关类型 ====================

export interface ReadingProgress {
  index_id: string;
  read_pages: number[];
  total_pages: number;
  progress: number;
  status: string;
  last_read_at: string | null;
  chat_rounds: number;
}

export interface UpdateProgressRequest {
  pages: number[];
}

// 在 DeepPDFClient 类中添加方法

async updateReadingProgress(indexId: string, pages: number[]): Promise<ReadingProgress> {
  const response = await this.fetchWithTimeout(
    `${this.baseUrl}/api/reading/${indexId}/progress`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update reading progress: ${response.statusText}`);
  }

  return response.json();
}

async getReadingProgress(indexId: string): Promise<ReadingProgress> {
  const response = await this.fetchWithTimeout(
    `${this.baseUrl}/api/reading/${indexId}/progress`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Failed to get reading progress: ${response.statusText}`);
  }

  return response.json();
}
```

**Step 2: 在 index.ts 中导出**

```typescript
// 在 frontend/src/api/index.ts 中添加导出
export const readingAPI = {
  updateProgress: (client: DeepPDFClient, indexId: string, pages: number[]) =>
    client.updateReadingProgress(indexId, pages),
  getProgress: (client: DeepPDFClient, indexId: string) =>
    client.getReadingProgress(indexId),
};
```

**Step 3: 验证代码**

```bash
cd frontend && npm run build
```

**Step 4: 提交**

```bash
git add frontend/src/api/http-client.ts frontend/src/api/index.ts
git commit -m "feat(frontend): 添加阅读进度 API 客户端"
```

---

## Task 5: 前端 - 注册 URI 协议处理器

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 添加 URI 协议处理**

在 `DeepPDFPlugin` 类的 `onload` 方法中添加：

```typescript
// 在 onload() 方法中，this.addCommand 之后添加

// 注册 URI 协议处理器
this.registerObsidianProtocolHandler("deeppdf-chat", async (params) => {
  console.log("[DeepPDF] URI handler called with params:", params);

  const indexId = params.index_id;
  if (!indexId) {
    new Notice("DeepPDF: 缺少 index_id 参数");
    return;
  }

  // 打开侧边栏
  this.activateView();

  // 等待视图加载
  setTimeout(() => {
    // 通过事件通知侧边栏切换到指定索引
    this.app.workspace.trigger("deeppdf:select-index", indexId);
  }, 100);
});
```

**Step 2: 提交**

```bash
git add frontend/src/main.ts
git commit -m "feat(frontend): 注册 deeppdf-chat URI 协议处理器"
```

---

## Task 6: 前端 - 侧边栏监听索引切换事件

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 添加事件监听**

在 `SidebarView` 类的 `onOpen` 方法中添加：

```typescript
// 在 onOpen 方法中添加

// 监听 URI 协议触发的索引切换事件
this.registerEvent(
  this.app.workspace.on("deeppdf:select-index", (indexId: string) => {
    console.log("[DeepPDF] Received select-index event:", indexId);
    if (this.indexManager) {
      this.indexManager.selectIndex(indexId);
    }
  })
);
```

**Step 2: 提交**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(frontend): 侧边栏监听索引切换事件"
```

---

## Task 7: 前端 - 创建阅读入口管理服务

**Files:**
- Create: `frontend/src/services/reading-portal.ts`

**Step 1: 创建服务文件**

```typescript
/**
 * 阅读入口管理服务
 *
 * 管理 DeepPDF 阅读入口文档和书籍笔记
 */

import { App, Notice, TFile, normalizePath } from "obsidian";
import { DeepPDFClient, ReadingProgress } from "../api/http-client";

// 阅读入口目录名
const DEEPPDF_DIR = "DeepPDF";
const ENTRY_FILE = "📚 阅读入口.md";

// 书籍笔记 frontmatter 结构
interface BookFrontmatter {
  index_id: string;
  status: "unread" | "reading" | "completed";
  progress: number;
  total_pages: number;
  read_pages: string; // 逗号分隔的页码
  last_read: string | null;
  chat_rounds: number;
  tags: string[];
  created: string;
}

export class ReadingPortalService {
  private app: App;
  private client: DeepPDFClient;
  private vaultPath: string;

  constructor(app: App, client: DeepPDFClient) {
    this.app = app;
    this.client = client;
    this.vaultPath = (app.vault.adapter as any).basePath;
  }

  /**
   * 获取阅读入口文件路径
   */
  private getEntryPath(): string {
    return normalizePath(`${DEEPPDF_DIR}/${ENTRY_FILE}`);
  }

  /**
   * 获取书籍笔记路径
   */
  private getBookNotePath(bookName: string): string {
    // 清理文件名中的非法字符
    const safeName = bookName.replace(/[\\/:"*?<>|]/g, "_");
    return normalizePath(`${DEEPPDF_DIR}/${safeName}.md`);
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    const dirPath = normalizePath(DEEPPDF_DIR);
    const exists = await this.app.vault.adapter.exists(dirPath);
    if (!exists) {
      await this.app.vault.createFolder(dirPath);
    }
  }

  /**
   * 生成入口文档内容
   */
  private generateEntryContent(): string {
    return `---
deeppdf_entry: true
---

# 📚 阅读入口

管理所有已索引的 PDF 文档，追踪阅读进度。

> 💡 点击「开始对话」链接即可与 AI 讨论该书

\`\`\`base
file: DeepPDF
fields:
  - name: 书名
    type: text
  - name: 状态
    type: select
    options: [未开始, 阅读中, 已完成]
  - name: 进度
    type: number
  - name: 总页数
    type: number
  - name: 最后阅读
    type: date
  - name: 对话轮数
    type: number
  - name: 标签
    type: multiselect
  - name: 操作
    type: text
\`\`\`

---

## 使用说明

1. 点击任意书籍的「开始对话」链接，将打开 DeepPDF 侧边栏
2. 在对话过程中，系统会自动记录您阅读过的页面
3. 阅读进度 = 已覆盖页数 / 总页数

## 快速操作

- [打开 DeepPDF 侧边栏](obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&command=deeppdf:open-deeppdf-sidebar)
`;
  }

  /**
   * 生成书籍笔记内容
   */
  private generateBookNoteContent(
    bookName: string,
    indexId: string,
    totalPages: number
  ): string {
    const now = new Date().toISOString().split("T")[0];

    return `---
index_id: ${indexId}
status: unread
progress: 0
total_pages: ${totalPages}
read_pages: ""
last_read: null
chat_rounds: 0
tags: []
created: ${now}
---

# 📖 ${bookName}

## 📖 摘要

> [!note] AI 生成摘要
> 摘要生成中...（首次对话后将自动生成）

## 📑 章节目录

（待生成）

## 💭 阅读笔记

（在这里记录您的阅读心得）

## 🔗 相关链接

- [[📚 阅读入口]] - 返回书籍列表
- [开始对话](obsidian://deeppdf-chat?index_id=${indexId}) - 与 AI 讨论
`;
  }

  /**
   * 打开或创建阅读入口
   */
  async openReadingPortal(): Promise<void> {
    await this.ensureDir();
    const entryPath = this.getEntryPath();

    let file = this.app.vault.getAbstractFileByPath(entryPath);

    if (!file) {
      // 创建入口文件
      const content = this.generateEntryContent();
      file = await this.app.vault.create(entryPath, content);
      new Notice("已创建阅读入口文档");
    }

    // 在新标签页打开
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as TFile);
  }

  /**
   * 确保书籍笔记存在（首次阅读时调用）
   */
  async ensureBookNote(
    indexId: string,
    bookName: string,
    totalPages: number
  ): Promise<string> {
    await this.ensureDir();
    const notePath = this.getBookNotePath(bookName);

    let file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file) {
      // 创建书籍笔记
      const content = this.generateBookNoteContent(bookName, indexId, totalPages);
      file = await this.app.vault.create(notePath, content);
      console.log(`[DeepPDF] Created book note: ${notePath}`);
    }

    return notePath;
  }

  /**
   * 更新书籍笔记的阅读进度
   */
  async updateBookProgress(
    bookName: string,
    progress: ReadingProgress
  ): Promise<void> {
    const notePath = this.getBookNotePath(bookName);
    const file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file || !(file instanceof TFile)) {
      return; // 笔记不存在，跳过
    }

    // 读取当前内容
    const content = await this.app.vault.read(file);

    // 更新 frontmatter
    const frontmatter: BookFrontmatter = {
      index_id: progress.index_id,
      status: progress.progress === 0 ? "unread" :
              progress.progress >= 100 ? "completed" : "reading",
      progress: Math.round(progress.progress),
      total_pages: progress.total_pages,
      read_pages: progress.read_pages.join(","),
      last_read: progress.last_read_at,
      chat_rounds: progress.chat_rounds,
      tags: [],
      created: new Date().toISOString().split("T")[0],
    };

    // 使用 processFrontmatter 更新
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      Object.assign(fm, frontmatter);
    });
  }

  /**
   * 刷新入口文档（扫描所有书籍笔记）
   */
  async refreshEntry(): Promise<void> {
    // 入口文档使用 Base 插件自动扫描，无需手动刷新
    // 此方法保留用于未来扩展
  }
}
```

**Step 2: 提交**

```bash
git add frontend/src/services/reading-portal.ts
git commit -m "feat(frontend): 创建阅读入口管理服务"
```

---

## Task 8: 前端 - 在 IndexManager 添加阅读入口按钮

**Files:**
- Modify: `frontend/src/components/index-manager/index-manager.ts`
- Modify: `frontend/src/components/index-manager/index-manager.css`

**Step 1: 添加按钮到 IndexManager**

在 `IndexManagerOptions` 接口中添加回调：

```typescript
// 在 IndexManagerOptions 接口中添加
export interface IndexManagerOptions {
  // ... 现有字段
  onOpenReadingPortal?: () => void;
}
```

在 `renderHeader` 方法中添加按钮：

```typescript
// 在 renderHeader 方法中，创建按钮区域的位置添加

// 阅读入口按钮
if (this.options.onOpenReadingPortal) {
  const portalBtn = document.createElement("button");
  portalBtn.className = "deeppdf-btn deeppdf-index-create-btn deeppdf-portal-btn";
  portalBtn.textContent = "📚 阅读入口";
  portalBtn.title = "打开阅读入口";
  portalBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    this.options.onOpenReadingPortal?.();
  });
  actionsContainer.appendChild(portalBtn);
}
```

**Step 2: 添加样式**

在 `index-manager.css` 中添加：

```css
/* 阅读入口按钮样式 */
.deeppdf-portal-btn {
  background: linear-gradient(135deg, var(--interactive-accent), var(--interactive-accent-hover)) !important;
  color: white !important;
  border: none !important;
}

.deeppdf-portal-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--interactive-accent-rgb, 84, 109, 229), 0.3);
}
```

**Step 3: 提交**

```bash
git add frontend/src/components/index-manager/index-manager.ts frontend/src/components/index-manager/index-manager.css
git commit -m "feat(frontend): 在 IndexManager 添加阅读入口按钮"
```

---

## Task 9: 前端 - 集成阅读入口到侧边栏

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 导入服务**

```typescript
// 在文件顶部导入
import { ReadingPortalService } from "../services/reading-portal.js";
```

**Step 2: 初始化服务**

在 `SidebarView` 类中添加属性：

```typescript
// 在类属性区域添加
private readingPortal: ReadingPortalService | null = null;
```

在 `onOpen` 方法中初始化：

```typescript
// 在 onOpen 方法中，apiClient 初始化之后
if (this.apiClient) {
  this.readingPortal = new ReadingPortalService(this.app, this.apiClient);
}
```

**Step 3: 添加打开入口的方法**

```typescript
// 在 SidebarView 类中添加方法
private async openReadingPortal(): Promise<void> {
  if (!this.readingPortal) {
    new Notice("DeepPDF 服务未就绪");
    return;
  }

  try {
    await this.readingPortal.openReadingPortal();
  } catch (error) {
    console.error("[DeepPDF] Failed to open reading portal:", error);
    new Notice("打开阅读入口失败");
  }
}
```

**Step 4: 传递回调给 IndexManager**

在创建 IndexManager 时添加回调：

```typescript
// 在创建 IndexManager 的位置，options 对象中添加
this.indexManager = new IndexManager({
  // ... 现有选项
  onOpenReadingPortal: () => this.openReadingPortal(),
});
```

**Step 5: 首次阅读时创建笔记**

在 `handleSelectIndex` 或开始对话的方法中：

```typescript
// 在开始对话时，确保书籍笔记存在
if (this.readingPortal && this.currentIndexId && this.currentPdfName) {
  // 获取总页数（从 API 或元数据）
  const totalPages = 0; // TODO: 从索引元数据获取
  await this.readingPortal.ensureBookNote(
    this.currentIndexId,
    this.currentPdfName,
    totalPages
  );
}
```

**Step 6: 提交**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(frontend): 集成阅读入口到侧边栏"
```

---

## Task 10: 前端 - 构建和测试

**Step 1: 构建前端**

```bash
cd frontend && npm run build
```

**Step 2: 启动后端**

```bash
cd backend/deeppdf-api && uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio
```

**Step 3: 在 Obsidian 中测试**

1. 重新加载 Obsidian (Cmd+R)
2. 打开 DeepPDF 侧边栏
3. 点击"📚 阅读入口"按钮
4. 验证入口文档是否正确创建
5. 在入口文档中点击"开始对话"链接
6. 验证是否跳转到 DeepPDF 侧边栏

**Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: 完成阅读入口功能 P0 实现

- 后端扩展索引元数据支持阅读进度追踪
- 后端添加阅读进度 API 端点
- 前端注册 URI 协议处理器
- 前端创建阅读入口管理服务
- 前端集成阅读入口到侧边栏"
```

---

## P1 任务（后续迭代）

### Task 11: 后端 - 对话接口自动更新进度
- 在流式对话结束时提取引用页码
- 自动调用 `update_reading_progress`

### Task 12: 前端 - 对话后同步进度到笔记
- 对话完成后调用 `updateBookProgress`
- 更新 frontmatter 中的进度数据

### Task 13: 后端 - 摘要生成 API
- 添加 `POST /api/indexes/{index_id}/generate-summary` 端点
- 使用 LLM 生成书籍摘要

### Task 14: 前端 - 摘要生成集成
- 首次阅读时触发后台摘要生成
- 生成完成后更新笔记文件
