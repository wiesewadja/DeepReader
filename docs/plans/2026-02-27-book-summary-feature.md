# 书籍摘要功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为已索引的书籍生成结构化摘要，包括核心主旨、作者意图、书籍分类，帮助用户快速了解书籍内容（检视阅读）。

**Architecture:**
1. 在索引时自动生成摘要（可配置）
2. 分层摘要：章节摘要 → 全书摘要
3. 缓存到 index_metadata，避免重复生成

**Tech Stack:** Python FastAPI, Pydantic, DeepSeek/OpenAI LLM

---

## Task 1: 定义数据结构

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/schemas.py`

**Step 1: 添加摘要相关的 Schema**

```python
# 在 schemas.py 中添加

from typing import List, Optional, Literal
from datetime import datetime
from pydantic import BaseModel

class ChapterSummary(BaseModel):
    """章节摘要"""
    node_id: str
    title: str
    summary: str                        # 一句话摘要
    key_questions: List[str] = []      # 该章节要解决的问题

class BookSummary(BaseModel):
    """书籍摘要"""
    index_id: str
    core_thesis: str                    # 核心主旨（1-2句话）
    author_intents: List[str]           # 作者意图（3-5个问题）
    book_type: Literal["theoretical", "practical", "fiction", "mixed"] = "mixed"
    chapter_summaries: List[ChapterSummary] = []
    generated_at: Optional[datetime] = None
    model_used: Optional[str] = None
```

**Step 2: 鷻加到 index_metadata 结构**

```python
# index_metadata 将包含 book_summary 字段
{
    "id": "idx_xxx",
    "pdf_name": "...",
    "book_summary": {  # 可选字段
        "core_thesis": "...",
        "author_intents": [...],
        "book_type": "practical",
        ...
    }
}
```

---

## Task 2: 创建摘要服务

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/services/book_summary.py`

**Step 1: 创建服务文件**

```python
"""
书籍摘要服务

为书籍生成结构化摘要，支持检视阅读
"""

import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from deeppdf.llm import get_llm_client
from deeppdf.storage.chroma_store import ChromaStore

logger = logging.getLogger(__name__)

# Prompt 模板
CHAPTER_SUMMARY_PROMPT = """你是一位专业的书籍编辑。请阅读以下章节内容，生成摘要。

章节标题：{title}

章节内容（前3000字）：
{content}

请生成：
1. 一句话摘要：这个章节在讲什么？（不超过50字）
2. 核心问题：作者在这个章节想解决什么问题？（1-3个，每个不超过20字）

请严格以以下 JSON 格式返回，不要包含其他内容：
{{"summary": "章节摘要内容", "key_questions": ["问题1", "问题2"]}}"""

BOOK_SUMMARY_PROMPT = """你是一位专业的书籍编辑。基于以下章节摘要，生成全书概览。

书名：{book_name}

章节摘要列表：
{chapter_summaries}

请生成：
1. 核心主旨：这本书整体在谈什么？（1-2句话，不超过100字）
2. 作者意图: 作者想解决什么核心问题？（3-5个问题，每个不超过30字）
3. 书籍分类: theoretical（理论性，说明"是什么"）/ practical（实用性，说明"怎么做"）/ fiction（虚构）/ mixed（混合）

请严格以以下 JSON 格式返回，不要包含其他内容：
{{"core_thesis": "核心主旨", "author_intents": ["问题1", "问题2"], "book_type": "practical"}}"""


class BookSummaryService:
    """书籍摘要服务"""

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self.llm = get_llm_client()

    async def generate_chapter_summary(
        self,
        title: str,
        content: str
    ) -> Dict[str, Any]:
        """生成单个章节的摘要"""
        prompt = CHAPTER_SUMMARY_PROMPT.format(
            title=title,
            content=content[:3000]  # 限制内容长度
        )

        try:
            response = await self.llm.ainvoke(prompt)
            result = json.loads(response)
            return {
                "summary": result.get("summary", ""),
                "key_questions": result.get("key_questions", [])
            }
        except Exception as e:
            logger.error(f"生成章节摘要失败: {e}")
            return {"summary": "", "key_questions": []}

    async def generate_book_summary(
        self,
        book_name: str,
        chapter_summaries: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """生成全书摘要"""
        # 格式化章节摘要
        summaries_text = "\n".join([
            f"- {cs['title']}: {cs['summary']}"
            for cs in chapter_summaries
            if cs.get("summary")
        ])

        prompt = BOOK_SUMMARY_PROMPT.format(
            book_name=book_name,
            chapter_summaries=summaries_text
        )

        try:
            response = await self.llm.ainvoke(prompt)
            result = json.loads(response)
            return {
                "core_thesis": result.get("core_thesis", ""),
                "author_intents": result.get("author_intents", []),
                "book_type": result.get("book_type", "mixed")
            }
        except Exception as e:
            logger.error(f"生成全书摘要失败: {e}")
            return {
                "core_thesis": "",
                "author_intents": [],
                "book_type": "mixed"
            }

    async def generate_full_summary(
        self,
        index_id: str,
        book_name: str,
        tree_structure: Dict[str, Any],
        chroma_store: ChromaStore,
        force_regenerate: bool = False
    ) -> Dict[str, Any]:
        """
        为书籍生成完整摘要

        Args:
            index_id: 索引ID
            book_name: 书名
            tree_structure: 书籍的树形结构
            chroma_store: ChromaDB 存储
            force_regenerate: 是否强制重新生成

        Returns:
            完整的书籍摘要
        """
        chapter_summaries = []

        # 遍历树结构，获取章节内容
        def collect_chapters(nodes: List[Dict], parent_title: str = "") -> List[Dict]:
            chapters = []
            for node in nodes:
                title = node.get("title", "未命名章节")
                node_id = node.get("node_id")
                children = node.get("children", [])

                # 如果有 node_id，尝试从 ChromaDB 获取内容
                if node_id:
                    try:
                        results = chroma_store.get(
                            collection_name=index_id,
                            ids=[node_id],
                            include=["documents"]
                        )
                        if results.get("documents") and results["documents"]:
                            content = results["documents"][0] if results["documents"] else ""
                            if content and len(content) > 100:  # 忽略太短的内容
                                chapters.append({
                                    "node_id": node_id,
                                    "title": title,
                                    "content": content
                                })
                    except Exception as e:
                        logger.warning(f"获取章节 {node_id} 内容失败: {e}")

                # 递归处理子章节
                if children:
                    chapters.extend(collect_chapters(children, title))

            return chapters

        # 收集所有章节
        structure = tree_structure.get("structure", [])
        all_chapters = collect_chapters(structure)

        logger.info(f"收集到 {len(all_chapters)} 个章节")

        # 生成每个章节的摘要
        for chapter in all_chapters[:20]:  # 限制最多处理20个章节
            summary = await self.generate_chapter_summary(
                title=chapter["title"],
                content=chapter["content"]
            )
            chapter_summaries.append({
                "node_id": chapter["node_id"],
                "title": chapter["title"],
                **summary
            })

        # 生成全书摘要
        book_summary = await self.generate_book_summary(
            book_name=book_name,
            chapter_summaries=chapter_summaries
        )

        return {
            "index_id": index_id,
            **book_summary,
            "chapter_summaries": chapter_summaries,
            "generated_at": datetime.now().isoformat(),
            "model_used": "deepseek"
        }
```

**Step 2: 鷻加类型导入**

在文件顶部添加必要的导入。

