"""
PageIndex 集成层
封装 PageIndex 源码功能，提供统一的 PDF 索引接口
"""
from pathlib import Path
from typing import Dict, Any, Optional, List
import sys

# 添加 pageindex 源码路径
_pageindex_path = Path(__file__).parent.parent.parent.parent / "pageindex"
if str(_pageindex_path.parent) not in sys.path:
    sys.path.insert(0, str(_pageindex_path.parent))

# 导入 PageIndex 核心功能
from pageindex import page_index
from pageindex.utils import (
    get_page_tokens,
    get_pdf_name,
    get_pdf_title,
    extract_text_from_pdf,
    get_number_of_pages,
    ConfigLoader,
)


class PageIndexWrapper:
    """
    PageIndex 包装器
    提供简化的接口来使用 PageIndex 功能
    """

    def __init__(
        self,
        model: Optional[str] = None,
        toc_check_page_num: Optional[int] = None,
        max_page_num_each_node: Optional[int] = None,
        max_token_num_each_node: Optional[int] = None,
        if_add_node_id: Optional[str] = None,
        if_add_node_summary: Optional[str] = None,
        if_add_doc_description: Optional[str] = None,
        if_add_node_text: Optional[str] = None,
    ):
        """
        初始化 PageIndex 包装器

        Args:
            model: LLM 模型名称
            toc_check_page_num: TOC 检查页数
            max_page_num_each_node: 每节点最大页数
            max_token_num_each_node: 每节点最大 token 数
            if_add_node_id: 是否添加节点 ID
            if_add_node_summary: 是否添加节点摘要
            if_add_doc_description: 是否添加文档描述
            if_add_node_text: 是否添加节点文本
        """
        # 加载配置
        user_config = {}
        if model is not None:
            user_config["model"] = model
        if toc_check_page_num is not None:
            user_config["toc_check_page_num"] = toc_check_page_num
        if max_page_num_each_node is not None:
            user_config["max_page_num_each_node"] = max_page_num_each_node
        if max_token_num_each_node is not None:
            user_config["max_token_num_each_node"] = max_token_num_each_node
        if if_add_node_id is not None:
            user_config["if_add_node_id"] = if_add_node_id
        if if_add_node_summary is not None:
            user_config["if_add_node_summary"] = if_add_node_summary
        if if_add_doc_description is not None:
            user_config["if_add_doc_description"] = if_add_doc_description
        if if_add_node_text is not None:
            user_config["if_add_node_text"] = if_add_node_text

        loader = ConfigLoader()
        self.config = loader.load(user_config)

    def parse_pdf(
        self,
        pdf_path: str,
        enable_summary: bool = False
    ) -> Dict[str, Any]:
        """
        使用 PageIndex 解析 PDF 并生成树状索引

        Args:
            pdf_path: PDF 文件路径
            enable_summary: 是否启用摘要生成（需要 LLM API）

        Returns:
            包含文档名和结构的字典
        """
        # 如果需要摘要，获取 LLM 客户端
        llm_client = None
        if enable_summary:
            llm_client = loader.get_llm_client()

        # 调用 PageIndex 核心函数
        result = page_index(
            pdf_path,
            model=self.config.model,
            toc_check_page_num=self.config.toc_check_page_num,
            max_page_num_each_node=self.config.max_page_num_each_node,
            max_token_num_each_node=self.config.max_token_num_each_node,
            if_add_node_id=self.config.if_add_node_id,
            if_add_node_summary=self.config.if_add_node_summary,
            if_add_doc_description=self.config.if_add_doc_description,
            if_add_node_text=self.config.if_add_node_text,
        )

        return result

    def get_page_content(
        self,
        pdf_path: str,
        page_numbers: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        获取 PDF 页面内容

        Args:
            pdf_path: PDF 文件路径
            page_numbers: 要获取的页码列表，None 表示获取所有页

        Returns:
            页面内容列表
        """
        page_tokens = get_page_tokens(pdf_path, model=self.config.model)

        if page_numbers is None:
            page_numbers = range(1, len(page_tokens) + 1)

        pages = []
        for i, page_num in enumerate(page_numbers):
            if 1 <= page_num <= len(page_tokens):
                text, token_count = page_tokens[page_num - 1]
                pages.append({
                    "page_number": page_num,
                    "text": text,
                    "token_count": token_count
                })

        return pages

    def get_pdf_info(self, pdf_path: str) -> Dict[str, Any]:
        """
        获取 PDF 基本信息

        Args:
            pdf_path: PDF 文件路径

        Returns:
            PDF 信息字典
        """
        return {
            "name": get_pdf_name(pdf_path),
            "title": get_pdf_title(pdf_path),
            "page_count": get_number_of_pages(pdf_path),
        }

    def extract_full_text(self, pdf_path: str) -> str:
        """
        提取 PDF 全部文本

        Args:
            pdf_path: PDF 文件路径

        Returns:
            PDF 全部文本
        """
        return extract_text_from_pdf(pdf_path)


# 便捷函数
def parse_pdf(
    pdf_path: str,
    model: str = "gpt-4o-2024-11-20",
    enable_summary: bool = False
) -> Dict[str, Any]:
    """
    便捷函数：解析 PDF 并生成索引

    Args:
        pdf_path: PDF 文件路径
        model: LLM 模型名称
        enable_summary: 是否启用摘要生成

    Returns:
        解析结果
    """
    wrapper = PageIndexWrapper(model=model)
    return wrapper.parse_pdf(pdf_path, enable_summary=enable_summary)


def get_pdf_page_tokens(pdf_path: str, model: str = "gpt-4o-2024-11-20") -> List[tuple]:
    """
    便捷函数：获取 PDF 页面 token 信息

    Args:
        pdf_path: PDF 文件路径
        model: 模型名称（用于 token 计算）

    Returns:
        (文本, token数) 元组列表
    """
    return get_page_tokens(pdf_path, model=model)
