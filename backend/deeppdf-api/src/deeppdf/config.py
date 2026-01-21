"""
DeepPDF 配置管理
"""

import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置"""

    # 基础配置
    base_dir: Path = Path(__file__).parent.parent.parent / "data"
    max_results: int = 10

    # LLM API 配置
    deepseek_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    llm_provider: str = "deepseek"
    llm_model: str = "deepseek-chat"
    llm_base_url: Optional[str] = None

    # PDF 索引配置
    pdf_index_llm_provider: str = "deepseek"
    pdf_index_model: str = "deepseek-chat"
    pdf_index_toc_check_pages: int = 20
    pdf_index_max_pages_per_node: int = 10
    pdf_index_max_tokens_per_node: int = 20000
    pdf_index_if_add_node_summary: bool = True

    # 并发配置
    cpu_workers: int = 2
    max_concurrent_requests: int = 10
    llm_concurrent_limit: int = 3

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # 忽略额外的环境变量


# 全局配置实例
settings = Settings()
