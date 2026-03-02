"""
书籍摘要服务

为书籍生成结构化摘要，支持检视阅读
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from openai import OpenAI

from deeppdf.config import settings
from deeppdf.services.manager import load_index_metadata, update_index_metadata

logger = logging.getLogger(__name__)


# ========== Prompt 模板 ==========

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


# ========== 工具函数 ==========


def _get_llm_client(
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> OpenAI:
    """
    获取 LLM 客户端

    Args:
        provider: LLM 提供商，默认使用 settings 中的配置
        api_key: API 密钥，默认从环境变量读取
        base_url: API 基础 URL

    Returns:
        OpenAI 客户端实例
    """
    provider = provider or settings.llm_provider

    # 确定 API Key
    if api_key is None:
        if provider == "deepseek":
            api_key = settings.deepseek_api_key
        elif provider == "openai":
            api_key = settings.openai_api_key
        else:
            api_key = settings.deepseek_api_key

    # 确定 base_url
    if base_url is None:
        if provider == "deepseek":
            base_url = "https://api.deepseek.com"
        elif provider == "openai":
            base_url = "https://api.openai.com/v1"
        else:
            base_url = settings.llm_base_url

    return OpenAI(api_key=api_key, base_url=base_url)


def _parse_json_response(response_text: str) -> Dict[str, Any]:
    """
    解析 LLM 返回的 JSON 响应

    Args:
        response_text: LLM 返回的文本

    Returns:
        解析后的字典
    """
    # 尝试直接解析
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON 块
    import re

    json_match = re.search(r"\{[\s\S]*\}", response_text)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    return {}


# ========== 核心函数 ==========


def generate_chapter_summary(
    client: OpenAI,
    title: str,
    content: str,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    生成单个章节的摘要

    Args:
        client: OpenAI 客户端
        title: 章节标题
        content: 章节内容
        model: 模型名称

    Returns:
        包含 summary 和 key_questions 的字典
    """
    prompt = CHAPTER_SUMMARY_PROMPT.format(
        title=title, content=content[:3000]  # 限制内容长度
    )

    model = model or settings.llm_model

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的书籍编辑，擅长生成简洁准确的摘要。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=500,
        )
        result = _parse_json_response(response.choices[0].message.content or "")
        return {
            "summary": result.get("summary", ""),
            "key_questions": result.get("key_questions", []),
        }
    except Exception as e:
        logger.error(f"生成章节摘要失败: {e}")
        return {"summary": "", "key_questions": []}


def generate_book_summary(
    client: OpenAI,
    book_name: str,
    chapter_summaries: List[Dict[str, Any]],
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    生成全书摘要

    Args:
        client: OpenAI 客户端
        book_name: 书名
        chapter_summaries: 章节摘要列表
        model: 模型名称

    Returns:
        包含 core_thesis, author_intents, book_type 的字典
    """
    # 格式化章节摘要
    summaries_text = "\n".join(
        [
            f"- {cs.get('title', '未知章节')}: {cs.get('summary', '')}"
            for cs in chapter_summaries
            if cs.get("summary")
        ]
    )

    if not summaries_text:
        return {
            "core_thesis": "",
            "author_intents": [],
            "book_type": "mixed",
        }

    prompt = BOOK_SUMMARY_PROMPT.format(
        book_name=book_name, chapter_summaries=summaries_text
    )

    model = model or settings.llm_model

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的书籍编辑，擅长生成结构化的书籍概览。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=800,
        )
        result = _parse_json_response(response.choices[0].message.content or "")
        return {
            "core_thesis": result.get("core_thesis", ""),
            "author_intents": result.get("author_intents", []),
            "book_type": result.get("book_type", "mixed"),
        }
    except Exception as e:
        logger.error(f"生成全书摘要失败: {e}")
        return {
            "core_thesis": "",
            "author_intents": [],
            "book_type": "mixed",
        }


async def generate_full_summary(
    index_id: str,
    storage_dir: str,
    force_regenerate: bool = False,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    为书籍生成完整摘要

    Args:
        index_id: 索引ID
        storage_dir: 存储目录
        force_regenerate: 是否强制重新生成
        provider: LLM 提供商
        model: 模型名称

    Returns:
        完整的书籍摘要
    """
    # 1. 加载索引元数据
    metadata_result = await load_index_metadata(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        return {
            "status": "error",
            "error": metadata_result.get("error", "加载索引元数据失败"),
        }

    metadata = metadata_result.get("metadata", {})
    book_name = metadata.get("pdf_name", "未知书籍")

    # 2. 检查是否已有摘要（除非强制重新生成）
    if not force_regenerate and metadata.get("book_summary"):
        logger.info(f"索引 {index_id} 已有摘要，跳过生成")
        return {
            "status": "success",
            "summary": metadata["book_summary"],
            "cached": True,
        }

    # 3. 获取树形结构
    tree_structure = metadata.get("tree_structure", {})
    if not tree_structure:
        return {
            "status": "error",
            "error": "索引没有树形结构数据",
        }

    # 4. 初始化 LLM 客户端
    client = _get_llm_client(provider=provider)

    # 5. 收集章节内容
    def collect_chapters(
        nodes: List[Dict], parent_title: str = ""
    ) -> List[Dict[str, Any]]:
        chapters = []
        for node in nodes:
            title = node.get("title", "未命名章节")
            node_id = node.get("node_id")
            content = node.get("content", "")
            children = node.get("children", [])

            # 如果有内容且足够长
            if content and len(content) > 100:
                chapters.append(
                    {
                        "node_id": node_id,
                        "title": title,
                        "content": content,
                    }
                )

            # 递归处理子章节
            if children:
                chapters.extend(collect_chapters(children, title))

        return chapters

    structure = tree_structure.get("structure", [])
    all_chapters = collect_chapters(structure)

    logger.info(f"收集到 {len(all_chapters)} 个章节")

    if not all_chapters:
        return {
            "status": "error",
            "error": "没有找到可用的章节内容",
        }

    # 6. 生成每个章节的摘要（限制最多20个章节）
    chapter_summaries = []
    for chapter in all_chapters[:20]:
        logger.info(f"正在生成章节摘要: {chapter['title']}")
        summary = generate_chapter_summary(
            client=client,
            title=chapter["title"],
            content=chapter["content"],
            model=model,
        )
        chapter_summaries.append(
            {
                "node_id": chapter["node_id"],
                "title": chapter["title"],
                **summary,
            }
        )

    # 7. 生成全书摘要
    logger.info("正在生成全书摘要...")
    book_summary = generate_book_summary(
        client=client,
        book_name=book_name,
        chapter_summaries=chapter_summaries,
        model=model,
    )

    # 8. 组装完整摘要
    full_summary = {
        "index_id": index_id,
        **book_summary,
        "chapter_summaries": chapter_summaries,
        "generated_at": datetime.now().isoformat(),
        "model_used": model or settings.llm_model,
    }

    # 9. 保存到元数据
    await update_index_metadata(index_id, storage_dir, {"book_summary": full_summary})

    logger.info(f"书籍摘要生成完成: {index_id}")

    return {
        "status": "success",
        "summary": full_summary,
        "cached": False,
    }


__all__ = [
    "generate_full_summary",
    "generate_chapter_summary",
    "generate_book_summary",
]
