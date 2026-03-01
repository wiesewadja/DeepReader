"""
主题报告服务

根据用户提供的主题/问题，跨书籍搜索并生成结构化的主题调查报告
"""

import logging
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

from deeppdf.config import settings
from deeppdf.services.cross_book_search import cross_book_search

logger = logging.getLogger(__name__)


# ========== Prompt 模板 ==========

EXTRACT_BOOK_PERSPECTIVE_PROMPT = """你是一位专业的知识分析师。请从以下书籍片段中提取与主题「{theme}」相关的核心观点和关键见解。

书籍名称：《{book_name}》

相关片段：
{excerpts}

请提取并整理：
1. **核心观点**：这本书对这个主题的主要观点是什么？
2. **关键论据**：支持核心观点的主要论据或证据
3. **独特视角**：这本书与其他书籍可能不同的独特视角或侧重点

请用简洁、学术化的语言回答，每个要点控制在 2-3 句话以内。
"""

INTEGRATE_PERSPECTIVES_PROMPT = """你是一位专业的知识整合专家。请根据以下多本书籍对主题「{theme}」的不同观点，撰写一份综合性的主题调查报告。

书籍观点汇总：
{book_perspectives}

请撰写一份结构化的主题调查报告，包含以下部分：

## 1. 主题概述
简要介绍这个主题的背景和重要性（100-150字）

## 2. 核心观点对比
对比不同书籍在这个主题上的核心观点，找出共同点和分歧点

## 3. 关键见解
提取所有书籍中最重要的见解和发现

## 4. 实践启示
这个主题对实践有什么指导意义？

## 5. 延伸思考
基于这些观点，还有哪些值得进一步探讨的问题？

请使用 Markdown 格式，语言简洁、专业、学术化。
"""


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
            api_key = settings.deepseek_api_key  # 默认使用 deepseek

    # 确定 base_url
    if base_url is None:
        if provider == "deepseek":
            base_url = "https://api.deepseek.com"
        elif provider == "openai":
            base_url = "https://api.openai.com/v1"
        else:
            base_url = settings.llm_base_url

    return OpenAI(api_key=api_key, base_url=base_url)


def _clean_book_name(book_name: str) -> str:
    """
    清理书籍名称，移除文件后缀和特殊字符

    Args:
        book_name: 原始书籍名称

    Returns:
        清理后的书籍名称
    """
    # 移除常见文件后缀
    name = book_name
    for ext in [".pdf", ".PDF", ".epub", ".EPUB", ".mobi", ".MOBI"]:
        name = name.removesuffix(ext)

    # 移除路径分隔符
    name = name.replace("/", "-").replace("\\", "-")

    return name.strip()


def _safe_filename(name: str) -> str:
    """
    将字符串转换为安全的文件名

    Args:
        name: 原始名称

    Returns:
        安全的文件名
    """
    # 移除或替换不安全的字符
    safe_name = re.sub(r'[<>:"/\\|?*]', "-", name)
    # 移除连续的空格和横线
    safe_name = re.sub(r"[\s\-]+", "-", safe_name)
    # 移除首尾的横线和空格
    safe_name = safe_name.strip("- ")

    return safe_name or "untitled"


# ========== 核心函数 ==========


def extract_book_perspective(
    client: OpenAI,
    theme: str,
    book_name: str,
    excerpts: List[Dict[str, Any]],
    model: Optional[str] = None,
) -> str:
    """
    从单本书籍中提取与主题相关的核心观点

    Args:
        client: OpenAI 客户端
        theme: 主题/问题
        book_name: 书籍名称
        excerpts: 相关片段列表，每个元素包含 text, section, page 等
        model: 模型名称

    Returns:
        提取的观点摘要
    """
    if not excerpts:
        return f"《{book_name}》中未找到与主题「{theme}」直接相关的内容。"

    # 格式化片段
    formatted_excerpts = []
    for i, excerpt in enumerate(excerpts, 1):
        text = excerpt.get("text", "")
        section = excerpt.get("section", "未知章节")
        page = excerpt.get("page", "未知页码")
        # 截断过长的文本
        if len(text) > 500:
            text = text[:500] + "..."
        formatted_excerpts.append(f"### 片段 {i}（{section}，第 {page} 页）\n{text}")

    excerpts_text = "\n\n".join(formatted_excerpts)

    # 构建 prompt
    prompt = EXTRACT_BOOK_PERSPECTIVE_PROMPT.format(
        theme=theme, book_name=book_name, excerpts=excerpts_text
    )

    # 调用 LLM
    model = model or settings.llm_model
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的知识分析师，擅长从文本中提取关键观点并进行结构化总结。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=1500,
        )
        return response.choices[0].message.content or "无法提取观点"
    except Exception as e:
        logger.error(f"提取书籍观点失败: {book_name}, 错误: {e}")
        return f"《{book_name}》观点提取失败: {str(e)}"


def integrate_perspectives(
    client: OpenAI,
    theme: str,
    book_perspectives: Dict[str, str],
    model: Optional[str] = None,
) -> str:
    """
    整合多本书籍的观点，生成综合报告

    Args:
        client: OpenAI 客户端
        theme: 主题/问题
        book_perspectives: 书籍名称到观点摘要的映射
        model: 模型名称

    Returns:
        综合报告内容（Markdown 格式）
    """
    if not book_perspectives:
        return f"# 主题调查报告：{theme}\n\n未找到相关书籍内容。"

    # 格式化书籍观点
    perspectives_text = []
    for book_name, perspective in book_perspectives.items():
        perspectives_text.append(f"## 《{book_name}》\n\n{perspective}")

    all_perspectives = "\n\n---\n\n".join(perspectives_text)

    # 构建 prompt
    prompt = INTEGRATE_PERSPECTIVES_PROMPT.format(
        theme=theme, book_perspectives=all_perspectives
    )

    # 调用 LLM
    model = model or settings.llm_model
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的知识整合专家，擅长综合多来源信息并撰写结构化的学术报告。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=3000,
        )
        return response.choices[0].message.content or "无法生成报告"
    except Exception as e:
        logger.error(f"整合观点失败: {e}")
        raise RuntimeError(f"整合观点失败: {str(e)}")


def generate_theme_report_markdown(
    theme: str,
    integrated_content: str,
    search_results: List[Dict[str, Any]],
    book_perspectives: Dict[str, str],
) -> str:
    """
    生成完整的主题报告 Markdown 内容

    Args:
        theme: 主题/问题
        integrated_content: LLM 生成的综合内容
        search_results: 原始搜索结果
        book_perspectives: 各书籍的观点摘要

    Returns:
        完整的 Markdown 报告
    """
    # 报告头部
    header = f"""# 主题调查报告：{theme}

> 生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}
> 搜索书籍：{len(book_perspectives)} 本
> 相关片段：{len(search_results)} 处

---

"""

    # 参考文献部分
    references = "\n\n---\n\n## 参考文献\n\n"
    for i, result in enumerate(search_results[:20], 1):  # 最多列出 20 条
        book_name = result.get("book_name", "未知书籍")
        section = result.get("section", "未知章节")
        page = result.get("page", "未知页码")
        obsidian_link = result.get("obsidian_link", "")
        if obsidian_link:
            references += (
                f"{i}. [[{obsidian_link}|《{book_name}》- {section}（第 {page} 页）]]\n"
            )
        else:
            references += f"{i}. 《{book_name}》- {section}（第 {page} 页）\n"

    return header + integrated_content + references


async def generate_theme_report(
    theme: str,
    storage_dir: str,
    index_ids: Optional[List[str]] = None,
    top_k_per_book: int = 3,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    生成主题调查报告的主入口函数

    Args:
        theme: 主题/问题
        storage_dir: 存储目录路径
        index_ids: 可选，指定要搜索的索引 ID 列表
        top_k_per_book: 每本书返回的结果数量
        provider: LLM 提供商
        model: 模型名称

    Returns:
        {
            "status": "success" | "error",
            "theme": "主题",
            "unified_summary": "整合摘要",
            "book_perspectives": [...],
            "books_searched": 搜索的书籍数量,
            "markdown_content": "完整 Markdown 内容",
            "suggested_filename": "建议的文件名",
            "error": "错误信息（如果失败）"
        }
    """
    logger.info(f"开始生成主题报告: {theme}")

    try:
        # 1. 初始化 LLM 客户端
        client = _get_llm_client(provider=provider)

        # 2. 跨书籍搜索
        logger.info("正在搜索相关内容...")
        search_result = cross_book_search(
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
                "books_searched": search_result.get("books_searched", 0),
            }

        logger.info(f"找到 {len(results)} 条相关内容")

        # 3. 按书籍分组
        books_excerpts: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for result in results:
            book_name = result.get("book_name", "未知书籍")
            books_excerpts[book_name].append(result)

        logger.info(f"涉及 {len(books_excerpts)} 本书")

        # 4. 为每本书提取观点
        book_perspectives: Dict[str, str] = {}
        for book_name, excerpts in books_excerpts.items():
            logger.info(f"正在分析《{book_name}》...")
            perspective = extract_book_perspective(
                client=client,
                theme=theme,
                book_name=book_name,
                excerpts=excerpts,
                model=model,
            )
            book_perspectives[book_name] = perspective

        # 5. 整合所有观点
        logger.info("正在整合观点...")
        integrated_content = integrate_perspectives(
            client=client,
            theme=theme,
            book_perspectives=book_perspectives,
            model=model,
        )

        # 6. 生成完整报告
        markdown_content = generate_theme_report_markdown(
            theme=theme,
            integrated_content=integrated_content,
            search_results=results,
            book_perspectives=book_perspectives,
        )

        # 7. 生成建议的文件名
        safe_theme = _safe_filename(theme)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suggested_filename = f"{safe_theme}_{timestamp}.md"

        logger.info(f"报告生成完成: {suggested_filename}")

        return {
            "status": "success",
            "theme": theme,
            "unified_summary": integrated_content.split("\n\n")[0] if integrated_content else "",
            "book_perspectives": [
                {
                    "book_name": _clean_book_name(name),
                    "book_link": _clean_book_name(name),
                    "key_points": [],  # 可以后续从 perspective 中解析
                    "related_chapter": excerpts[0].get("section", "") if excerpts else "",
                    "related_chapter_link": excerpts[0].get("obsidian_link", "") if excerpts else "",
                }
                for name, excerpts in books_excerpts.items()
            ],
            "books_searched": len(books_excerpts),
            "markdown_content": markdown_content,
            "suggested_filename": suggested_filename,
        }

    except Exception as e:
        logger.error(f"生成主题报告失败: {e}", exc_info=True)
        return {
            "status": "error",
            "error": str(e),
        }


__all__ = [
    "generate_theme_report",
    "extract_book_perspective",
    "integrate_perspectives",
    "generate_theme_report_markdown",
]
