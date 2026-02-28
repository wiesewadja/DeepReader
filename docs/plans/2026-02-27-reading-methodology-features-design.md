# 阅读方法论功能设计文档

> 基于《如何阅读一本书》的阅读层次理论，设计 DeepPDF 的增强功能

**核心理念**：**以 Markdown 为核心** - 所有生成的内容都直接写入 Obsidian 笔记，而非软件 UI 组件。用户可以自由编辑、链接、搜索这些内容。

**目标**：将经典阅读方法论内化到产品中，提升用户的阅读效率和深度

**设计日期**：2026-02-27

---

## 一、核心设计理念

### 1.1 从"软件功能"到"Markdown 增强"

| 传统思路 | 新思路（Markdown 为中心） |
|---------|------------------------|
| 前端 UI 组件展示摘要 | 在书籍首页 Markdown 中嵌入摘要 |
| 软件内主题报告视图 | 生成独立的主题报告 Markdown 文件 |
| 观点对比矩阵表格 | 生成 Markdown 表格，直接写入笔记 |
| 软件内分类标签 | 在书籍首页显示分类徽章 |

### 1.2 功能概述与优先级

| 优先级 | 功能 | 阅读层次 | 输出形式 |
|-------|------|---------|---------|
| P0 | 书籍摘要生成 | 检视阅读 | 更新书籍首页 Markdown |
| P1 | 主题整合报告 | 主题阅读 | 生成独立 Markdown 文件（DeepPDF/主题调查/）|
| P1 | 观点对比矩阵 | 主题阅读 | 嵌入主题报告（Markdown 表格）|
| P2 | 书籍分类识别 | 检视阅读 | 更新书籍首页（元数据 + 阅读建议）|

---

## 二、P0：书籍摘要生成

### 2.1 功能描述

用户点击"生成摘要"后，**自动更新书籍首页的 Markdown 文件**，在目录之前插入结构化摘要。

### 2.2 输出效果（Markdown）

**原始书籍首页**（如 `如何阅读一本书.md`）：

```markdown
# 如何阅读一本书

## 目录

- [[01-译 序]]
- [[02-序 言]]
- ...
```

**生成摘要后的书籍首页**：

```markdown
# 如何阅读一本书

> 📖 **分类**: 实用性作品 > 自我提升
> ⏱️ **预计阅读**: 约 8 小时
> 📊 **章节**: 21 章

---

## 📋 核心主旨

本书系统阐述了阅读的四个层次（基础、检视、分析、主题），
帮助读者通过主动阅读提升理解能力。

## 🎯 作者意图

1. 为什么现代人需要主动阅读？
2. 如何进行有效的检视阅读？
3. 分析阅读的规则是什么？
4. 主题阅读如何整合多本书？

---

## 目录

- [[01-译 序]]
- [[02-序 言]]
- ...
```

### 2.3 操作流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        书籍摘要生成流程                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 1: 用户触发                                                              │
│                                                                              │
│   方式1: 在书籍首页点击"生成摘要"按钮                                           │
│   方式2: 通过 Command Palette 执行"DeepPDF: 生成书籍摘要"命令                   │
│   参数: force_regenerate (是否强制重新生成)                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 2: 检查缓存                                                              │
│                                                                              │
│   - 读取 index_metadata 中的 book_summary 字段                                │
│   - 如果存在且 force_regenerate=false，直接返回缓存结果                         │
│   - 否则继续生成                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 3: 查找 PageIndex 结果文件                                               │
│                                                                              │
│   - 从 index_metadata 获取 pdf_name                                          │
│   - 在 backend/results/ 目录查找匹配的文件                                     │
│   - 如果有多个，选择最新的（按时间戳）                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 4: 遍历章节，生成摘要                                                     │
│                                                                              │
│   for chapter in pageindex_file.structure:                                   │
│       if len(chapter.text) > 100:  # 跳过太短的章节                            │
│           summary = await generate_chapter_summary(                          │
│               title=chapter.title,                                           │
│               content=chapter.text[:3000]  # 限制长度                         │
│           )                                                                  │
│           chapter_summaries.append(summary)                                  │
│                                                                              │
│   限制: 最多处理 20 个章节（避免 token 消耗过大）                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 5: 生成全书摘要 (LLM)                                                     │
│                                                                              │
│   Prompt: "基于以下章节摘要，生成全书概览:                                       │
│            书名: {book_name}                                                  │
│            章节摘要: {chapter_summaries}                                       │
│            请生成: 1. 核心主旨 2. 作者意图 3. 书籍分类"                          │
│                                                                              │
│   输出: core_thesis, author_intents, book_type                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 6: 保存到 index_metadata (缓存)                                          │
│                                                                              │
│   - 将 BookSummary 存储到 index_metadata.book_summary                         │
│   - 写入 JSON 文件                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 7: 更新书籍首页 Markdown                                                  │
│                                                                              │
│   - 读取现有的书籍首页 Markdown                                                │
│   - 检测是否已有摘要（通过标记注释）                                             │
│   - 在 ## 目录 之前插入摘要内容                                                │
│   - 如果已存在摘要，替换而非追加                                                │
│   - 写入文件                                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 8: 返回结果                                                              │
│                                                                              │
│   - 返回 BookSummary 对象                                                     │
│   - 返回 markdown_updated 状态                                                │
│   - 返回 markdown_path                                                        │
│   - 前端显示成功通知，可选自动打开文件                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.5 数据源：PageIndex 结果文件

摘要生成使用 `backend/results/` 目录下的 PageIndex 结果文件作为数据源。

**文件位置**：`backend/results/{book_name}_{timestamp}.json`

**文件结构**：
```json
{
  "doc_name": "如何阅读一本书",
  "structure": [
    {
      "title": "译 序",
      "text": "# 译 序\n\n我是在1999年春节期间...",
      "start_index": 3,
      "end_index": 4,
      "node_id": "0001"
    },
    {
      "title": "序 言",
      "text": "# 序 言\n\n《如何阅读一本书》的第一版...",
      "start_index": 4,
      "end_index": 5,
      "node_id": "0002"
    }
  ],
  "doc_description": "文档描述（可选）"
}
```

**使用方式**：
1. 根据 `index_id` 查找对应的 PageIndex 结果文件
2. 遍历 `structure` 数组，获取每个章节的 `title` 和 `text`
3. 使用 LLM 为每个章节生成摘要
4. 汇总所有章节摘要，生成全书摘要

**查找 PageIndex 文件的逻辑**：
```python
def find_pageindex_file(storage_dir: str, index_id: str) -> Optional[str]:
    """
    根据 index_id 查找对应的 PageIndex 结果文件

    策略：
    1. 从 index_metadata 中获取 pdf_name
    2. 在 results 目录中查找匹配的文件（按书名前缀匹配）
    3. 如果有多个，选择最新的（按时间戳排序）
    """
    results_dir = Path(storage_dir) / "results"
    if not results_dir.exists():
        return None

    # 从 metadata 获取书名
    metadata_path = Path(storage_dir) / "indexes" / f"{index_id}.json"
    with open(metadata_path) as f:
        metadata = json.load(f)
    pdf_name = metadata.get("pdf_name", "")

    # 查找匹配的文件
    matching_files = list(results_dir.glob(f"{pdf_name}*.json"))
    if not matching_files:
        return None

    # 按修改时间排序，返回最新的
    matching_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return str(matching_files[0])
```

### 2.6 实现要点

1. **读取 PageIndex 结果文件** - 从 `backend/results/` 获取结构化内容
2. **读取现有 Markdown** - 保留用户的自定义内容
3. **智能插入位置** - 在 `## 目录` 之前插入摘要
4. **去重** - 如果已存在摘要，替换而非追加
5. **格式化** - 使用 Obsidian 友好的 Markdown 格式

```python
# Markdown 模板
BOOK_SUMMARY_MD_TEMPLATE = """# {book_name}

> 📖 **分类**: {book_type_display}
> ⏱️ **预计阅读**: 约 {reading_time} 分钟
> 📊 **章节**: {chapter_count} 章

---

## 📋 核心主旨

{core_thesis}

## 🎯 作者意图

{author_intents}

---

"""
```

---

## 三、P1：主题整合报告

### 3.1 功能描述

用户输入一个主题/问题，系统：
1. 在所有已索引书籍中搜索相关内容
2. 整合不同书籍的观点
3. **生成一份独立的 Markdown 文件**到用户指定的目录

### 3.2 与 AI 问答的区别

| 维度 | AI 问答（当前功能） | 主题整合报告（本功能） |
|------|-------------------|---------------------|
| **场景** | 快速提问，即时获得答案 | 深度研究，需要沉淀 |
| **范围** | 单本书 | **强制跨多本书** |
| **输出** | 聊天界面，对话式 | Markdown 文件，可编辑 |
| **持久性** | 保存在插件缓存中 | 保存在 Obsidian 笔记中 |
| **交互** | 多轮对话 | 一次性生成报告 |
| **触发** | 单书籍模式下的提问 | **跨书籍模式下的任何提问** |

**关键区别**：跨书籍模式下，所有问题都会生成主题整合报告，而非聊天回复。

**使用场景对比**：

```
AI 问答（单书籍模式）:
├── "这个概念是什么意思？" → 即时回答
├── "总结这一章内容" → 即时回答
├── "作者为什么这样说？" → 即时回答
└── 多轮追问，逐步深入

主题报告（跨书籍模式）:
├── "比较不同书籍对'效率'的定义" → 生成报告文件
├── "整理关于'学习'的核心观点" → 生成报告文件
├── "生成关于'AI 影响'的跨书籍分析" → 生成报告文件
└── 用于写作素材、知识整理、深度研究
```

### 3.3 触发方式

**跨书籍模式下的所有提问都会自动生成主题整合报告**：

1. **跨书籍模式按钮**: 点击输入框左侧的小圆按钮切换跨书籍模式（高亮表示开启）
2. **输入问题**: 在跨书籍模式下输入任何问题
3. **自动生成**: 系统自动搜索所有书籍并生成主题报告到 `DeepPDF/主题调查/` 目录

### 3.4 操作流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        主题整合报告生成流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 1: 用户输入主题（跨书籍模式）                                              │
│                                                                              │
│   输入: "如何提高阅读效率"                                                     │
│   触发: 跨书籍模式下发送任何问题                                                │
│   输出目录: DeepPDF/主题调查/                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 2: 跨书籍搜索 (复用 cross_book_search)                                   │
│                                                                              │
│   - 调用 cross_book_search(theme, storage_dir, top_k_per_book=3)            │
│   - 获取每本书最相关的 3 个段落                                                 │
│   - 返回结果包含: text, book_name, section, page, obsidian_link              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 3: 按书籍分组                                                            │
│                                                                              │
│   输入: 15 条搜索结果（5 本书 × 3 条/书）                                       │
│   输出: 按书名分组的字典                                                       │
│   {                                                                          │
│     "如何阅读一本书": [结果1, 结果2, 结果3],                                    │
│     "纳瓦尔宝典": [结果4, 结果5, 结果6],                                        │
│     ...                                                                      │
│   }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 4: 提取各书观点 (LLM)                                                    │
│                                                                              │
│   对每本书调用 LLM:                                                           │
│   Prompt: "基于以下关于'{theme}'的内容，提取这本书的核心观点（2-3个）:           │
│           {该书的搜索结果}"                                                    │
│                                                                              │
│   输出: BookPerspective[] (每本书一个)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 5: 整合分析 (LLM)                                                        │
│                                                                              │
│   Prompt: "基于以下各书观点，生成关于'{theme}'的整合报告:                       │
│           1. 整合摘要（综合回答主题问题）                                       │
│           2. 共识点（各书一致的观点）                                          │
│           3. 分歧点（各书不一致的观点）                                        │
│           {所有 BookPerspective}"                                            │
│                                                                              │
│   输出: unified_summary, common_points, differences                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 6: 生成 Markdown 文件                                                    │
│                                                                              │
│   - 检查输出目录是否存在，不存在则创建                                           │
│   - 文件名: {主题}.md（特殊字符替换）                                           │
│   - 写入 Markdown 内容                                                        │
│   - 返回文件路径给前端                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 7: 前端打开文件                                                          │
│                                                                              │
│   - 显示成功通知                                                              │
│   - 自动在 Obsidian 中打开生成的文件                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 核心代码逻辑

```python
async def generate_theme_report(
    theme: str,
    storage_dir: str,
    vault_path: str,
    output_dir: str = "DeepPDF/主题调查",
    index_ids: Optional[List[str]] = None,
    top_k_per_book: int = 3
) -> ThemeReport:
    """
    生成主题整合报告

    Args:
        theme: 主题/问题
        storage_dir: 后端存储目录
        vault_path: Obsidian vault 路径
        output_dir: 输出目录（相对于 vault 根目录）
        index_ids: 要搜索的书籍 ID（可选，默认全部）
        top_k_per_book: 每本书取多少条结果
    """
    from deeppdf.services.cross_book_search import cross_book_search

    # Step 2: 跨书籍搜索
    search_result = await cross_book_search(
        query=theme,
        storage_dir=storage_dir,
        index_ids=index_ids,
        top_k=top_k_per_book
    )

    if not search_result.get("results"):
        raise ValueError("未找到相关内容")

    # Step 3: 按书籍分组
    books_content = {}
    for result in search_result["results"]:
        book_name = result["book_name"]
        if book_name not in books_content:
            books_content[book_name] = {
                "results": [],
                "index_id": result["index_id"]
            }
        books_content[book_name]["results"].append(result)

    # Step 4: 提取各书观点
    book_perspectives = []
    for book_name, data in books_content.items():
        perspective = await extract_book_perspective(
            theme=theme,
            book_name=book_name,
            search_results=data["results"]
        )
        book_perspectives.append(perspective)

    # Step 5: 整合分析
    unified_summary, common_points, differences = await integrate_perspectives(
        theme=theme,
        perspectives=book_perspectives
    )

    # 构建 ThemeReport
    report = ThemeReport(
        theme=theme,
        unified_summary=unified_summary,
        book_perspectives=book_perspectives,
        common_points=common_points,
        differences=differences,
        generated_at=datetime.now()
    )

    # Step 6: 生成 Markdown 文件
    markdown_path = await save_theme_report_markdown(
        report=report,
        vault_path=vault_path,
        output_dir=output_dir
    )
    report.markdown_path = markdown_path

    return report
```

### 3.4 Prompt 模板

```python
# Step 4: 提取单书观点
EXTRACT_BOOK_PERSPECTIVE_PROMPT = """你是一位知识分析师。请基于以下来自《{book_name}》的内容，
提取关于"{theme}"的核心观点。

相关内容：
{content}

请提取：
1. 2-3个核心观点（每个不超过30字）
2. 最相关的章节名称

以 JSON 格式返回：
{{"key_points": ["观点1", "观点2"], "related_chapter": "章节名"}}
"""

# Step 5: 整合分析
INTEGRATE_PERSPECTIVES_PROMPT = """你是一位知识整合专家。请基于以下各书观点，
生成关于"{theme}"的整合分析。

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
```

### 3.5 输出效果（Markdown）

**生成的文件**：`DeepPDF/主题调查/如何提高阅读效率.md`

```markdown
# 主题报告：如何提高阅读效率

> 🤖 由 DeepPDF AI 生成
> ⏰ 生成时间：2026-02-27 14:30
> 📚 参考书籍：3 本

---

## 📌 整合摘要

提高阅读效率的核心在于"主动阅读"——带着问题去读，
而非被动接收信息。《如何阅读一本书》强调检视阅读
先建立整体框架；《纳瓦尔宝典》建议专注于经典，
深度阅读而非广泛涉猎。

综合三本书的观点，最有效的阅读策略是：
1. 先进行检视阅读，建立整体框架
2. 带着明确的问题深入阅读
3. 通过输出（写作、笔记）检验理解

---

## 📚 各书观点

### [[如何阅读一本书]]

**核心观点**：
- 检视阅读：先快速浏览，建立整体框架
- 带着问题阅读：主动寻找答案
- 分析阅读：理解作者的论证结构

> 📍 相关章节：[[11-第七章 透视一本书]]

### [[纳瓦尔宝典]]

**核心观点**：
- 重读经典：读100本好书胜过读10000本普通书
- 输出倒逼输入：通过写作检验理解
- 灵感易逝，行动应当时

> 📍 相关章节：[[73-灵感本易逝，行动应当时。]]

### [[开窍 (所长林超)]]

**核心观点**：
- 脑科学视角：理解大脑如何学习
- 跨学科思维模型：100个关键知识点
- 实践出真知

> 📍 相关章节：[[15-不受控制的底层脑区]]

---

## ✅ 共识点

| 观点 | 支持书籍 |
|------|---------|
| 主动阅读比被动阅读更有效 | 全部 3 本 |
| 带着目的去读 | 全部 3 本 |
| 输出是检验理解的最佳方式 | 《如何阅读一本书》《纳瓦尔宝典》 |

---

## ⚡ 分歧点

### 广泛涉猎 vs 深度重读

| 书籍 | 观点 |
|------|------|
| [[如何阅读一本书]] | 先广泛检视，再选择重点深度阅读 |
| [[纳瓦尔宝典]] | 重读经典，而非广泛涉猎 |

### 阅读速度

| 书籍 | 观点 |
|------|------|
| [[如何阅读一本书]] | 不同阅读层次需要不同速度，检视阅读要快 |
| [[纳瓦尔宝典]] | 速度不重要，理解深度才是关键 |

---

## 💭 延伸思考

基于以上分析，你可能还想了解：
- [[主题报告：如何做读书笔记]]
- [[主题报告：经典书籍的选择标准]]

---

> 🤖 本报告由 DeepPDF AI 生成，内容仅供参考。
> 建议结合原文进行验证和深入阅读。
```

### 3.3 数据结构

```python
class ThemeReport(BaseModel):
    """主题整合报告"""
    theme: str
    unified_summary: str
    book_perspectives: List[BookPerspective]
    common_points: List[CommonPoint]
    differences: List[DifferencePoint]
    generated_at: datetime
    markdown_path: Optional[str]  # 生成的 Markdown 文件路径

class BookPerspective(BaseModel):
    """单本书的观点"""
    book_name: str
    book_link: str              # Obsidian wiki link
    key_points: List[str]
    related_chapter: str        # 最相关的章节
    related_chapter_link: str   # 章节的 wiki link

class CommonPoint(BaseModel):
    """共识点"""
    point: str
    supporting_books: List[str]  # 支持的书籍名称列表

class DifferencePoint(BaseModel):
    """分歧点"""
    topic: str
    positions: List[Position]

class Position(BaseModel):
    """单个立场"""
    book_name: str
    book_link: str
    position: str
```

### 3.4 API 设计

```python
POST /api/theme/report
{
    "theme": "如何提高阅读效率",
    "index_ids": ["idx_xxx", "idx_yyy"],  # 可选
    "top_k_per_book": 3,
    "output_path": "DeepPDF/主题调查"    # 输出目录
}

# 响应
{
    "status": "success",
    "report": ThemeReport,
    "markdown_created": true,
    "markdown_path": "DeepPDF/主题调查/如何提高阅读效率.md"
}
```

### 3.5 Markdown 生成逻辑

```python
def generate_theme_report_markdown(report: ThemeReport) -> str:
    """生成主题报告的 Markdown 内容"""

    md = f"""# 主题报告：{report.theme}

> 🤖 由 DeepPDF AI 生成
> ⏰ 生成时间：{report.generated_at.strftime('%Y-%m-%d %H:%M')}
> 📚 参考书籍：{len(report.book_perspectives)} 本

---

## 📌 整合摘要

{report.unified_summary}

---

## 📚 各书观点

"""

    # 各书观点
    for bp in report.book_perspectives:
        md += f"""### [[{bp.book_name}]]

**核心观点**：
"""
        for point in bp.key_points:
            md += f"- {point}\n"

        md += f"""
> 📍 相关章节：[[{bp.related_chapter}]]

"""

    # 共识点（表格形式）
    md += """---

## ✅ 共识点

| 观点 | 支持书籍 |
|------|---------|
"""
    for cp in report.common_points:
        books_str = ", ".join(cp.supporting_books)
        md += f"| {cp.point} | {books_str} |\n"

    # 分歧点
    if report.differences:
        md += "\n---\n\n## ⚡ 分歧点\n\n"
        for diff in report.differences:
            md += f"### {diff.topic}\n\n"
            md += "| 书籍 | 观点 |\n|------|------|\n"
            for pos in diff.positions:
                md += f"| [[{pos.book_name}]] | {pos.position} |\n"
            md += "\n"

    # 页脚
    md += """---

> 🤖 本报告由 DeepPDF AI 生成，内容仅供参考。
> 建议结合原文进行验证和深入阅读。
"""
    return md
```

---

## 四、P1：观点对比矩阵

### 4.1 功能描述

观点对比是主题报告的一个**子模块**，以 **Markdown 表格**形式嵌入报告中。

### 4.2 输出效果

已在主题报告中体现，使用 Markdown 表格：

```markdown
## ⚡ 分歧点

### 广泛涉猎 vs 深度重读

| 书籍 | 观点 |
|------|------|
| [[如何阅读一本书]] | 先广泛检视，再选择重点深度阅读 |
| [[纳瓦尔宝典]] | 重读经典，而非广泛涉猎 |
```

### 4.3 实现要点

- 作为 `ThemeReport` 的一部分，不单独生成文件
- 使用标准 Markdown 表格语法
- 书籍名称使用 Obsidian wiki link 格式

---

## 五、P2：书籍分类识别

### 5.1 功能描述

在索引完成后**自动识别**书籍类型，并将分类信息写入书籍首页 Markdown。

### 5.2 分类体系与阅读建议

```python
BOOK_TYPE_CONFIG = {
    "theoretical": {
        "display": "理论性作品",
        "subtypes": {
            "philosophy": "哲学",
            "science": "科学",
            "history": "历史"
        },
        "reading_tips": [
            "关注作者的论证逻辑",
            "找出核心概念和定义",
            "思考理论如何解释现实"
        ]
    },
    "practical": {
        "display": "实用性作品",
        "subtypes": {
            "guide": "指南/手册",
            "business": "商业/管理",
            "self-help": "自我提升"
        },
        "reading_tips": [
            "关注作者的"建议"和"方法"",
            "思考如何将原则应用到实际生活",
            "阅读后制定行动清单"
        ]
    },
    "fiction": {
        "display": "虚构类作品",
        "subtypes": {
            "novel": "小说",
            "poetry": "诗歌",
            "drama": "戏剧"
        },
        "reading_tips": [
            "沉浸式阅读，体验故事",
            "关注人物和情节发展",
            "思考作品传达的主题"
        ]
    }
}
```

### 5.3 输出效果

书籍首页顶部增加分类徽章和阅读建议：

```markdown
# 如何阅读一本书

> 📖 **分类**: 实用性作品 > 自我提升
> 💡 **阅读建议**: 关注作者的"建议"和"方法" | 思考如何将原则应用到实际生活

---

### 5.4 跨书籍模式 UI 设计

跨书籍模式通过**小圆按钮**切换，位于输入框左侧：

**按钮状态**：
- **关闭状态**：灰色小圆按钮（空心或淡色）
- **开启状态**：蓝色高亮小圆按钮（实心或亮色）

**交互逻辑**：
1. 点击小圆按钮切换跨书籍模式
2. 高亮表示跨书籍模式已开启
3. 跨书籍模式下，所有问题都会生成主题整合报告（Markdown 文件）
4. 报告保存到 `DeepPDF/主题调查/` 目录

**CSS 样式参考**：
```css
/* 跨书籍模式小圆按钮 */
.deeppdf-cross-book-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    background: transparent;
    cursor: pointer;
    transition: all 0.2s ease;
}

.deeppdf-cross-book-btn:hover {
    border-color: var(--interactive-accent);
}

/* 跨书籍模式开启状态 */
.deeppdf-cross-book-btn.active {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
}

.deeppdf-cross-book-btn.active::after {
    content: '';
    display: block;
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    margin: 6px;
}
```

---

## 目录
...
```

---

## 六、技术架构

### 6.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Obsidian Vault (Markdown 文件)             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ 书籍首页.md     │  │ 主题报告.md     │  │ 其他笔记.md  │ │
│  │ (嵌入摘要)      │  │ (独立文件)      │  │              │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                   DeepPDF Plugin (触发器)                     │
│  [生成摘要] 按钮    [生成主题报告] 命令                        │
├─────────────────────────────────────────────────────────────┤
│                         API Layer                            │
│  /api/summary      │  /api/theme/report                     │
├─────────────────────────────────────────────────────────────┤
│                       Service Layer                          │
│  BookSummaryService │ ThemeReportService                     │
│  (生成 + 写入 Markdown)                                       │
├─────────────────────────────────────────────────────────────┤
│                       Data Layer                             │
│  ChromaDB (向量)  │  Index Metadata  │  LLM API             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 新增文件

```
backend/deeppdf-api/src/deeppdf/
├── api/
│   └── reading_routes.py          # 新增：阅读增强 API 路由
├── services/
│   ├── book_summary.py            # 新增：书籍摘要服务
│   ├── theme_report.py            # 新增：主题报告服务
│   └── markdown_writer.py         # 新增：Markdown 写入服务

frontend/src/
├── commands/
│   └── reading-commands.ts        # 新增：阅读相关命令（生成摘要、主题报告）
├── services/
│   └── markdown-service.ts        # 新增：Markdown 文件操作服务
```

### 6.3 关键服务：Markdown 写入

```python
# backend/deeppdf-api/src/deeppdf/services/markdown_writer.py

class MarkdownWriter:
    """Markdown 文件写入服务"""

    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)

    async def update_book_index(
        self,
        book_path: str,
        summary: BookSummary,
        classification: BookClassification
    ) -> str:
        """
        更新书籍首页，插入摘要

        策略：
        1. 读取现有内容
        2. 检测是否已有摘要（通过标记注释）
        3. 替换或插入摘要
        4. 保留用户自定义内容
        """
        pass

    async def create_theme_report(
        self,
        output_path: str,
        report: ThemeReport
    ) -> str:
        """
        创建主题报告 Markdown 文件

        策略：
        1. 确保目录存在
        2. 生成 Markdown 内容
        3. 写入文件（如果已存在，添加时间戳后缀）
        """
        pass
```

---

## 七、实施计划

### Phase 1: P0 书籍摘要（预计 2-3 天）

**后端**
- [ ] 创建 `book_summary.py` 服务
- [ ] 创建 `markdown_writer.py` 服务
- [ ] 添加 `/api/index/{index_id}/summary` 端点
- [ ] 实现分层摘要逻辑 + Markdown 写入

**前端**
- [ ] 添加"生成摘要"命令（Command Palette）
- [ ] 调用 API 并刷新文件视图
- [ ] 显示成功/失败通知

### Phase 2: P1 主题报告（预计 3-4 天）

**后端**
- [ ] 创建 `theme_report.py` 服务
- [ ] 添加 `/api/theme/report` 端点
- [ ] 复用 `cross_book_search` 搜索逻辑
- [ ] 实现 LLM 整合 + Markdown 生成

**前端**
- [ ] 添加"生成主题报告"命令
- [ ] 弹出输入框让用户输入主题
- [ ] 显示进度并打开生成的文件

### Phase 3: P2 书籍分类（预计 1-2 天）

**后端**
- [ ] 在索引流程中集成分类逻辑
- [ ] 存储分类到 metadata
- [ ] 更新书籍首页 Markdown

**前端**
- [ ] 在索引完成时自动更新书籍首页

---

## 八、Prompt 模板库

### 8.1 书籍摘要

```python
CHAPTER_SUMMARY_PROMPT = """你是一位专业的书籍编辑。请阅读以下章节内容，生成摘要。

章节标题：{title}
章节内容：
{content}

请生成：
1. 一句话摘要（不超过50字）
2. 该章节想解决的1-3个核心问题

以 JSON 格式返回：{{"summary": "...", "key_questions": ["...", "..."]}}
"""

BOOK_SUMMARY_PROMPT = """基于以下章节摘要，生成全书概览。

书名：{book_name}
章节摘要：
{chapter_summaries}

请生成：
1. 核心主旨（1-2句话，不超过100字）
2. 作者想解决的3-5个核心问题（每个不超过30字）
3. 书籍分类：theoretical（理论性）/ practical（实用性）/ fiction（虚构）

以 JSON 格式返回。
"""
```

### 8.2 主题报告

```python
THEME_REPORT_PROMPT = """你是一位知识整合专家。请基于以下来自不同书籍的内容，
生成关于"{theme}"的主题报告。

来源内容：
{sources}

请生成：
1. 整合摘要（200-300字）：综合所有来源，连贯地回答主题问题
2. 各书观点：列出每本书的2-3个核心观点
3. 共识点：各来源一致的观点（2-3个）
4. 分歧点：各来源不一致的地方（如有）

以 JSON 格式返回：
{{
  "unified_summary": "...",
  "book_perspectives": [
    {{"book_name": "...", "key_points": [...], "related_chapter": "..."}}
  ],
  "common_points": [...],
  "differences": [
    {{"topic": "...", "positions": [{{"book_name": "...", "position": "..."}}]}}
  ]
}}
"""
```

### 8.3 书籍分类

```python
CLASSIFICATION_PROMPT = """分析以下书籍信息，判断其类型。

书名：{title}
目录：{toc}
样章内容：{sample_content}

请判断：
1. 主要分类：theoretical（理论性，说明"是什么"）/ practical（实用性，说明"怎么做"）/ fiction（虚构）
2. 细分类型（如 practical 下的 guide/business/self-help）
3. 阅读策略建议（3条，每条不超过20字）

以 JSON 格式返回。
"""
```

---

## 九、总结

本设计将《如何阅读一本书》的阅读方法论内化为四个核心功能，**以 Markdown 为核心输出形式**：

| 功能 | 对应阅读层次 | 输出形式 | 核心价值 |
|------|-------------|---------|---------|
| 书籍摘要 | 检视阅读 | 更新书籍首页 | 快速判断书是否值得深读 |
| 主题报告 | 主题阅读 | 独立 Markdown 文件 | 跨书整合知识，形成体系 |
| 观点对比 | 主题阅读 | Markdown 表格 | 理解不同视角，培养批判性思维 |
| 书籍分类 | 检视阅读 | 书籍首页元数据 | 选择正确的阅读策略 |

**设计优势**：
1. **用户可控** - 所有生成的内容都是 Markdown，用户可以自由编辑
2. **Obsidian 原生** - wiki link、标签、搜索都能正常工作
3. **持久保存** - 不依赖软件状态，内容永远在笔记中
4. **二次加工** - 用户可以基于生成的内容继续扩展

**功能闭环**：
1. **分类** → 知道怎么读
2. **摘要** → 快速了解内容
3. **主题报告** → 跨书整合
4. **观点对比** → 深度理解

最终目标是帮助用户不仅"读懂"一本书，更能"读透"并"应用"书中的知识。
