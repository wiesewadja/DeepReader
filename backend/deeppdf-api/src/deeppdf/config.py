"""
DeepPDF 配置管理
"""

from pathlib import Path
from typing import Optional
from pydantic import ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置"""

    # 基础配置
    # base_dir 指向 backend/data/ 目录（从 deeppdf-api/src/deeppdf/ 出发向上 4 级）
    base_dir: Path = Path(__file__).parent.parent.parent.parent / "data"
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
    pdf_index_if_add_node_summary: bool = False  # 是否生成章节摘要（默认关闭，耗时较长）
    pdf_index_if_add_node_text: bool = True
    pdf_index_if_add_doc_description: bool = True  # 是否生成全书摘要（默认开启，用于宏观检索）
    pdf_index_format_text_with_llm: bool = False  # 是否用 LLM 格式化文本（默认关闭，耗时较长）

    # 并发配置
    cpu_workers: int = 2
    max_concurrent_requests: int = 10
    llm_concurrent_limit: int = 3

    # Agent 配置
    agent_max_iterations: int = 10
    agent_temperature: float = 0.7
    agent_top_p: float = 0.95
    agent_max_query_length: int = (
        8000  # 用户查询最大字符长度（启发式，约等于 4K-6K tokens）
    )

    # Agent 历史记录配置
    agent_max_history_turns: int = 15  # 保留完整对话的最大轮数
    agent_history_compress_threshold: int = 5  # 超过 max_history_turns 后累积多少轮触发摘要压缩

    # DeepSeek OCR 配置
    deepseek_ocr_api_key: Optional[str] = None
    deepseek_ocr_base_url: str = "https://api.siliconflow.cn/v1"
    deepseek_ocr_model: str = "deepseek-ai/DeepSeek-OCR"
    deepseek_ocr_max_tokens: int = 4096

    # PDF 转图片配置
    pdf_image_dpi: int = 200
    pdf_image_format: str = "png"

    # PDF 视觉检测阈值（与 pageindex-lib 对齐）
    visual_detect_sample_pages: int = 10
    visual_density_threshold: float = 0.3
    visual_text_threshold: int = 50

    # Skills 配置
    enable_skills: bool = False  # 是否启用 Skills 功能
    user_skills_dir: Optional[str] = None  # 用户自定义 Skills 目录路径

    # Pydantic V2 配置
    model_config = ConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore"  # 忽略额外的环境变量
    )


# 全局配置实例
settings = Settings()
