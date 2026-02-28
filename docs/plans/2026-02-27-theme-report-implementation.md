# 主题整合报告功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现跨书籍主题整合报告功能，在跨书籍模式下自动为用户问题生成 Markdown 格式的主题调查报告。

**Architecture:**
1. 后端新增 `theme_report.py` 服务，复用 `cross_book_search.py` 的搜索逻辑
2. 使用 LLM 整合多本书的观点，生成结构化报告
3. 前端在跨书籍模式下调用新 API，自动保存报告到 `DeepPDF/主题调查/` 目录

**Tech Stack:** Python FastAPI, Pydantic, OpenAI API (DeepSeek), TypeScript, Obsidian Plugin API

---

## Task 1: 定义主题报告数据结构

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py`

**Step 1: 添加主题报告相关模型**

在文件末尾添加：

```python
# ========== 主题报告模型 ==========


class BookPerspective(BaseModel):
    """单本书的观点"""

    book_name: str = Field(..., description="书籍名称")
    book_link: str = Field(..., description="Obsidian wiki link")
    key_points: List[str] = Field(default_factory=list, description="核心观点列表")
    related_chapter: str = Field("", description="最相关的章节")
    related_chapter_link: str = Field("", description="章节的 wiki link")


class DifferencePosition(BaseModel):
    """单个立场"""

    book_name: str = Field(..., description="书籍名称")
    book_link: str = Field(..., description="Obsidian wiki link")
    position: str = Field(..., description="该书的立场")


class DifferencePoint(BaseModel):
    """分歧点"""

    topic: str = Field(..., description="分歧主题")
    positions: List[DifferencePosition] = Field(default_factory=list, description="各书立场")


class ThemeReportRequest(BaseModel):
    """主题报告请求"""

    theme: str = Field(..., description="主题/问题", min_length=1, max_length=500)
    index_ids: Optional[List[str]] = Field(None, description="指定索引 ID 列表，不传则搜索全部")
    top_k_per_book: int = Field(3, description="每本书取多少条结果", ge=1, le=10)


class ThemeReportResponse(BaseModel):
    """主题报告响应"""

    status: str = Field(..., description="状态: success 或 error")
    theme: str = Field(..., description="主题")
    unified_summary: str = Field(..., description="整合摘要")
    book_perspectives: List[BookPerspective] = Field(default_factory=list, description="各书观点")
    books_searched: int = Field(0, description="搜索的书籍数量")
    markdown_path: Optional[str] = Field(None, description="生成的 Markdown 文件路径")
    error: Optional[str] = Field(None, description="错误信息")
```

**Step 2: 验证模型定义**

Run: `cd backend/deeppdf-api && uv run python -c "from deeppdf.api.models import ThemeReportRequest, ThemeReportResponse; print('Models OK')"`

Expected: `Models OK`

**Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/models.py
git commit -m "feat(api): add theme report data models"
```

---

## Task 2: 创建主题报告服务

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/services/theme_report.py`

**Step 1: 创建服务文件**

```python
"""
主题整合报告服务

跨书籍搜索并整合观点，生成结构化的主题报告
"""

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

from ..config import settings
from .cross_book_search import cross_book_search, get_all_indexes

logger = logging.getLogger(__name__)

# Prompt 模板
EXTRACT_BOOK_PERSPECTIVE_PROMPT = """你是一位知识分析师。请基于以下来自《{book_name}》的内容，提取关于"{theme}"的核心观点。

相关内容：
{content}

请提取：
1. 2-3个核心观点（每个不超过30字）
2. 最相关的章节名称

以 JSON 格式返回：
{{"key_points": ["观点1", "观点2"], "related_chapter": "章节名"}}
"""

INTEGRATE_PERSPECTIVES_PROMPT = """你是一位知识整合专家。请基于以下各书观点，生成关于"{theme}"的整合分析。

各书观点：
{perspectives}

请生成：
1. 整合摘要（100-200字，综合回答主题问题）
2. 共识点（各书一致的观点，2-5个）
3. 分歧点（各书不一致的观点，0-3个，每个需说明各书立场）

以 JSON 格式返回：
{{
  "unified_summary": "...",
  "common_points": ["共识1", "共识2"],
  "differences": [
    {{
      "topic": "分歧主题",
      "positions": [
        {{"book": "书名1", "position": "观点1"}},
        {{"book": "书名2", "position": "观点2"}}
      ]
    }}
  ]
}}
"""


def _get_llm_client() -> OpenAI:
    """获取 LLM 客户端"""
    provider = settings.llm_provider.lower()
    base_url = settings.llm_base_url

    if provider == "deepseek":
        base_url = base_url or "https://api.deepseek.com"
        api_key = settings.deepseek_api_key
    elif provider == "openai":
        base_url = base_url or "https://api.openai.com/v1"
        api_key = settings.openai_api_key
    else:
        api_key = settings.openai_api_key

    return OpenAI(api_key=api_key, base_url=base_url)


def _clean_book_name(name: str) -> str:
    """清理书名，移除文件后缀"""
    return (
        name.removesuffix(".pdf")
        .removesuffix(".PDF")
        .removesuffix(".epub")
        .removesuffix(".EPUB")
    )


def _safe_filename(name: str) -> str:
    """将主题转换为安全的文件名"""
    # 移除或替换不安全的字符
    safe = re.sub(r'[<>:"/\\|?*]', "", name)
    safe = safe.replace(" ", "-")
    # 限制长度
    return safe[:100]


async def extract_book_perspective(
    theme: str,
    book_name: str,
    search_results: List[Dict[str, Any]],
    llm_client: OpenAI,
    model: str,
) -> Dict[str, Any]:
    """
    提取单本书的观点

    Args:
        theme: 主题
        book_name: 书名
        search_results: 该书的搜索结果
        llm_client: LLM 客户端
        model: 模型名称

    Returns:
        包含 key_points 和 related_chapter 的字典
    """
    # 合并搜索结果内容
    content = "\n\n".join([r.get("text", "")[:500] for r in search_results[:3]])

    if not content.strip():
        return {"key_points": [], "related_chapter": ""}

    prompt = EXTRACT_BOOK_PERSPECTIVE_PROMPT.format(
        book_name=book_name, theme=theme, content=content
    )

    try:
        response = llm_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=500,
        )

        result = json.loads(response.choices[0].message.content)
        return {
            "key_points": result.get("key_points", []),
            "related_chapter": result.get("related_chapter", ""),
        }
    except Exception as e:
        logger.warning(f"提取书籍观点失败: {book_name}, {e}")
        return {"key_points": [], "related_chapter": ""}


async def integrate_perspectives(
    theme: str,
    book_perspectives: List[Dict[str, Any]],
    llm_client: OpenAI,
    model: str,
) -> Dict[str, Any]:
    """
    整合各书观点

    Args:
        theme: 主题
        book_perspectives: 各书观点列表
        llm_client: LLM 客户端
        model: 模型名称

    Returns:
        包含 unified_summary, common_points, differences 的字典
    """
    # 格式化各书观点
    perspectives_text = ""
    for bp in book_perspectives:
        points = ", ".join(bp.get("key_points", []))
        perspectives_text += f"- 《{bp['book_name']}》: {points}\n"

    prompt = INTEGRATE_PERSPECTIVES_PROMPT.format(
        theme=theme, perspectives=perspectives_text
    )

    try:
        response = llm_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=1000,
        )

        result = json.loads(response.choices[0].message.content)
        return {
            "unified_summary": result.get("unified_summary", ""),
            "common_points": result.get("common_points", []),
            "differences": result.get("differences", []),
        }
    except Exception as e:
        logger.error(f"整合观点失败: {e}")
        return {
            "unified_summary": f"关于「{theme}」的跨书籍分析暂无法生成，请稍后重试。",
            "common_points": [],
            "differences": [],
        }


def generate_theme_report_markdown(
    theme: str,
    unified_summary: str,
    book_perspectives: List[Dict[str, Any]],
    common_points: List[str],
    differences: List[Dict[str, Any]],
    generated_at: datetime,
) -> str:
    """
    生成主题报告的 Markdown 内容

    Args:
        theme: 主题
        unified_summary: 整合摘要
        book_perspectives: 各书观点
        common_points: 共识点
        differences: 分歧点
        generated_at: 生成时间

    Returns:
        Markdown 内容
    """
    md = f"""# 主题报告：{theme}

> 🤖 由 DeepPDF AI 生成
> ⏰ 生成时间：{generated_at.strftime('%Y-%m-%d %H:%M')}
> 📚 参考书籍：{len(book_perspectives)} 本

---

## 📌 整合摘要

{unified_summary}

---

## 📚 各书观点

"""

    # 各书观点
    for bp in book_perspectives:
        book_link = bp.get("book_link", bp["book_name"])
        md += f"""### [[{book_link}]]

**核心观点**：
"""
        for point in bp.get("key_points", []):
            md += f"- {point}\n"

        related_chapter = bp.get("related_chapter", "")
        if related_chapter:
            md += f"\n> 📍 相关章节：{related_chapter}\n"

        md += "\n"

    # 共识点
    if common_points:
        md += """---

## ✅ 共识点

| 观点 |
|------|
"""
        for point in common_points:
            md += f"| {point} |\n"

    # 分歧点
    if differences:
        md += "\n---\n\n## ⚡ 分歧点\n\n"
        for diff in differences:
            md += f"### {diff.get('topic', '未知主题')}\n\n"
            md += "| 书籍 | 观点 |\n|------|------|\n"
            for pos in diff.get("positions", []):
                book = pos.get("book", "未知")
                position = pos.get("position", "")
                md += f"| [[{book}]] | {position} |\n"
            md += "\n"

    # 页脚
    md += """---

> 🤖 本报告由 DeepPDF AI 生成，内容仅供参考。
> 建议结合原文进行验证和深入阅读。
"""
    return md


async def generate_theme_report(
    theme: str,
    storage_dir: str,
    vault_path: str,
    output_dir: str = "DeepPDF/主题调查",
    index_ids: Optional[List[str]] = None,
    top_k_per_book: int = 3,
) -> Dict[str, Any]:
    """
    生成主题整合报告

    Args:
        theme: 主题/问题
        storage_dir: 后端存储目录
        vault_path: Obsidian vault 路径
        output_dir: 输出目录（相对于 vault 根目录）
        index_ids: 要搜索的书籍 ID（可选，默认全部）
        top_k_per_book: 每本书取多少条结果

    Returns:
        包含报告信息的字典
    """
    logger.info(f"[ThemeReport] 开始生成主题报告: {theme}")

    # Step 1: 跨书籍搜索
    search_result = await cross_book_search(
        query=theme,
        storage_dir=storage_dir,
        index_ids=index_ids,
        top_k=top_k_per_book,
    )

    if search_result.get("status") != "success":
        return {
            "status": "error",
            "error": search_result.get("error", "搜索失败"),
        }

    results = search_result.get("results", [])
    if not results:
        return {
            "status": "error",
            "error": "未找到相关内容",
        }

    # Step 2: 按书籍分组
    books_content: Dict[str, Dict[str, Any]] = {}
    for result in results:
        book_name = result.get("book_name", "未知书籍")
        if book_name not in books_content:
            books_content[book_name] = {
                "results": [],
                "index_id": result.get("index_id", ""),
            }
        books_content[book_name]["results"].append(result)

    logger.info(f"[ThemeReport] 搜索到 {len(books_content)} 本书")

    # Step 3: 获取 LLM 客户端
    llm_client = _get_llm_client()
    model = settings.llm_model

    # Step 4: 提取各书观点
    book_perspectives = []
    for book_name, data in books_content.items():
        perspective = await extract_book_perspective(
            theme=theme,
            book_name=book_name,
            search_results=data["results"],
            llm_client=llm_client,
            model=model,
        )

        # 获取第一个结果的章节信息作为相关章节
        related_chapter = data["results"][0].get("section", "") if data["results"] else ""
        related_chapter_link = data["results"][0].get("obsidian_link", "") if data["results"] else ""

        book_perspectives.append({
            "book_name": _clean_book_name(book_name),
            "book_link": _clean_book_name(book_name),
            "key_points": perspective.get("key_points", []),
            "related_chapter": perspective.get("related_chapter") or related_chapter,
            "related_chapter_link": related_chapter_link,
        })

    # Step 5: 整合分析
    integration = await integrate_perspectives(
        theme=theme,
        book_perspectives=book_perspectives,
        llm_client=llm_client,
        model=model,
    )

    unified_summary = integration.get("unified_summary", "")
    common_points = integration.get("common_points", [])
    differences = integration.get("differences", [])

    # Step 6: 生成 Markdown
    generated_at = datetime.now()
    markdown_content = generate_theme_report_markdown(
        theme=theme,
        unified_summary=unified_summary,
        book_perspectives=book_perspectives,
        common_points=common_points,
        differences=differences,
        generated_at=generated_at,
    )

    # Step 7: 保存到文件
    markdown_path = None
    if vault_path:
        try:
            output_path = Path(vault_path) / output_dir
            output_path.mkdir(parents=True, exist_ok=True)

            filename = _safe_filename(theme)
            file_path = output_path / f"{filename}.md"

            # 如果文件已存在，添加时间戳
            if file_path.exists():
                timestamp = generated_at.strftime("%H%M%S")
                file_path = output_path / f"{filename}-{timestamp}.md"

            file_path.write_text(markdown_content, encoding="utf-8")
            markdown_path = str(file_path.relative_to(vault_path))
            logger.info(f"[ThemeReport] 报告已保存: {markdown_path}")

        except Exception as e:
            logger.error(f"[ThemeReport] 保存文件失败: {e}")

    return {
        "status": "success",
        "theme": theme,
        "unified_summary": unified_summary,
        "book_perspectives": book_perspectives,
        "books_searched": len(books_content),
        "markdown_path": markdown_path,
    }
```

**Step 2: 验证服务可以导入**

Run: `cd backend/deeppdf-api && uv run python -c "from deeppdf.services.theme_report import generate_theme_report; print('Service OK')"`

Expected: `Service OK`

**Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/services/theme_report.py
git commit -m "feat(service): add theme report generation service"
```

---

## Task 3: 添加主题报告 API 端点

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 添加导入和新路由**

在文件中找到 `cross_book_search` 相关部分，在其后添加主题报告路由：

```python
# 在文件顶部的导入区域添加
from ..services.theme_report import generate_theme_report

# 在 cross_book_search 路由后添加

@router.post("/theme/report", response_model=ThemeReportResponse)
async def create_theme_report(request: ThemeReportRequest):
    """
    生成主题整合报告

    在所有已索引书籍中搜索相关内容，整合观点并生成 Markdown 报告

    Args:
        request: 主题报告请求

    Returns:
        主题报告响应，包含整合摘要和 Markdown 文件路径
    """
    storage_dir = str(Path(settings.base_dir))

    # 从环境变量或配置获取 vault 路径
    vault_path = os.environ.get("OBSIDIAN_VAULT_PATH", "")

    result = await generate_theme_report(
        theme=request.theme,
        storage_dir=storage_dir,
        vault_path=vault_path,
        output_dir="DeepPDF/主题调查",
        index_ids=request.index_ids,
        top_k_per_book=request.top_k_per_book,
    )

    if result.get("status") != "success":
        return ThemeReportResponse(
            status="error",
            theme=request.theme,
            unified_summary="",
            error=result.get("error"),
        )

    return ThemeReportResponse(
        status="success",
        theme=result["theme"],
        unified_summary=result["unified_summary"],
        book_perspectives=[
            BookPerspective(
                book_name=bp["book_name"],
                book_link=bp["book_link"],
                key_points=bp["key_points"],
                related_chapter=bp.get("related_chapter", ""),
                related_chapter_link=bp.get("related_chapter_link", ""),
            )
            for bp in result["book_perspectives"]
        ],
        books_searched=result["books_searched"],
        markdown_path=result.get("markdown_path"),
    )
```

**Step 2: 添加必要的导入**

确保文件顶部有：
```python
import os
from pathlib import Path
from .models import (
    # ... 现有导入 ...
    ThemeReportRequest,
    ThemeReportResponse,
    BookPerspective,
)
```

**Step 3: 验证 API 端点**

Run: `cd backend/deeppdf-api && uv run python -c "from deeppdf.api.routes import router; print('Routes OK')"`

Expected: `Routes OK`

**Step 4: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(api): add theme report endpoint POST /api/theme/report"
```

---

## Task 4: 前端 API 客户端添加主题报告方法

**Files:**
- Modify: `frontend/src/api/http-client.ts`

**Step 1: 添加类型定义**

在文件末尾（`export class DeepPDFClient` 之前）添加类型：

```typescript
// ==================== 主题报告类型 ====================

export interface BookPerspective {
  book_name: string;
  book_link: string;
  key_points: string[];
  related_chapter: string;
  related_chapter_link: string;
}

export interface ThemeReportRequest {
  theme: string;
  index_ids?: string[];
  top_k_per_book?: number;
}

export interface ThemeReportResponse {
  status: string;
  theme: string;
  unified_summary: string;
  book_perspectives: BookPerspective[];
  books_searched: number;
  markdown_path?: string;
  error?: string;
}
```

**Step 2: 添加 API 方法**

在 `DeepPDFClient` 类中添加方法（在 `crossBookSearch` 方法后）：

```typescript
  /**
   * 生成主题整合报告
   * 跨书籍搜索并整合观点，生成 Markdown 报告
   */
  async generateThemeReport(
    theme: string,
    options?: {
      indexIds?: string[];
      topKPerBook?: number;
    }
  ): Promise<ThemeReportResponse> {
    return this.request<ThemeReportResponse>('/api/theme/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        index_ids: options?.indexIds,
        top_k_per_book: options?.topKPerBook || 3,
      }),
    });
  }
```

**Step 3: 导出新类型**

确保在文件末尾的导出中包含新类型：

```typescript
export type {
  // ... 现有导出 ...
  BookPerspective,
  ThemeReportRequest,
  ThemeReportResponse,
};
```

**Step 4: 验证 TypeScript 编译**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: 编译成功，无类型错误

**Step 5: Commit**

```bash
git add frontend/src/api/http-client.ts
git commit -m "feat(api): add generateThemeReport method to client"
```

---

## Task 5: 前端集成主题报告到跨书籍模式

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 修改跨书籍搜索处理逻辑**

找到 `handleCrossBookSearch` 方法，修改为调用主题报告 API：

```typescript
  /**
   * 处理跨书籍搜索（生成主题报告）
   */
  private async handleCrossBookSearch(query: string, aiMessageId: string): Promise<void> {
    if (!this.apiClient) {
      this.messageList?.updateMessage(aiMessageId, {
        content: "API 客户端未连接",
        isStreaming: false
      });
      this.isProcessing = false;
      this.isAiStreaming = false;
      this.chatInput?.setDisabled(false);
      this.restoreInputSection();
      return;
    }

    try {
      // 调用主题报告 API
      const result = await this.apiClient.generateThemeReport(query);

      if (result.status !== "success") {
        this.messageList?.updateMessage(aiMessageId, {
          content: `生成报告失败: ${result.error || "未知错误"}`,
          isStreaming: false
        });
        return;
      }

      // 构建显示内容
      let displayContent = `## 📌 ${result.theme}\n\n${result.unified_summary}\n\n`;

      // 添加各书观点摘要
      displayContent += `### 📚 各书观点 (${result.books_searched} 本书)\n\n`;
      for (const bp of result.book_perspectives) {
        displayContent += `**[[${bp.book_name}]]**: ${bp.key_points.join("；")}\n\n`;
      }

      // 如果生成了 Markdown 文件，添加提示
      if (result.markdown_path) {
        displayContent += `\n---\n\n> 📄 完整报告已保存到: [[${result.markdown_path}]]`;
      }

      this.messageList?.updateMessage(aiMessageId, {
        content: displayContent,
        isStreaming: false
      });

      // 保存到会话缓存
      this.saveToCache();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.messageList?.updateMessage(aiMessageId, {
        content: `生成报告失败: ${errorMessage}`,
        isStreaming: false
      });
    } finally {
      this.isProcessing = false;
      this.isAiStreaming = false;
      this.chatInput?.setDisabled(false);
      this.restoreInputSection();
      this.chatInput?.focus();
    }
  }
```

**Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npm run build 2>&1 | head -20`

Expected: 编译成功

**Step 3: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(frontend): integrate theme report in cross-book mode"
```

---

## Task 6: 添加 Vault 路径配置支持

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/config.py`
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 添加配置项**

在 `Settings` 类中添加：

```python
    # Obsidian Vault 配置
    obsidian_vault_path: Optional[str] = None
```

**Step 2: 更新路由使用配置**

在 `routes.py` 的主题报告端点中，修改 vault_path 获取方式：

```python
    # 优先使用配置，其次使用环境变量
    vault_path = settings.obsidian_vault_path or os.environ.get("OBSIDIAN_VAULT_PATH", "")
```

**Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/config.py backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(config): add obsidian_vault_path configuration"
```

---

## Task 7: 测试和验证

**Files:**
- 测试后端服务

**Step 1: 启动后端服务**

Run: `cd backend/deeppdf-api && uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio`

**Step 2: 测试 API 端点**

```bash
curl -X POST http://localhost:6088/api/theme/report \
  -H "Content-Type: application/json" \
  -d '{"theme": "如何提高阅读效率", "top_k_per_book": 2}'
```

Expected: 返回包含 `unified_summary`、`book_perspectives` 的 JSON 响应

**Step 3: 测试前端**

1. 在 Obsidian 中重新加载插件
2. 点击跨书籍模式按钮（小圆按钮）
3. 输入一个问题
4. 验证生成了主题报告并显示在聊天界面
5. 验证 Markdown 文件保存到了 `DeepPDF/主题调查/` 目录

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete theme report implementation"
```

---

## 验收标准

1. **后端 API**: `POST /api/theme/report` 正常工作，返回结构化响应
2. **跨书籍模式**: 用户在跨书籍模式下提问，自动生成主题报告
3. **Markdown 输出**: 报告保存到 `DeepPDF/主题调查/` 目录
4. **UI 显示**: 聊天界面显示报告摘要和文件链接
5. **小圆按钮**: 跨书籍模式切换按钮为小圆按钮样式，高亮表示开启

---

## 后续优化（不在本次范围）

- [ ] 添加报告重新生成功能
- [ ] 支持自定义输出目录
- [ ] 添加书籍分类识别（P2）
- [ ] 添加书籍摘要生成（P0）
