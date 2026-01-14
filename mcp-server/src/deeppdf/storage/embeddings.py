"""
中文文本嵌入函数
使用 sentence-transformers 加载本地中文向量模型
"""
from typing import List, Optional
from pathlib import Path
import hashlib
from sentence_transformers import SentenceTransformer


# 默认中文模型
DEFAULT_CHINESE_MODEL = "shibing624/text2vec-base-chinese"

# 模型缓存目录
MODEL_CACHE_DIR = Path.home() / ".cache" / "deeppdf" / "models"


class ChineseEmbeddingFunction:
    """
    中文文本嵌入函数
    用于 ChromaDB 的文本向量化
    """

    def __init__(
        self,
        model_name: str = DEFAULT_CHINESE_MODEL,
        cache_dir: Optional[Path] = None,
        device: Optional[str] = None
    ):
        """
        初始化中文嵌入函数

        Args:
            model_name: 模型名称，默认使用 text2vec-base-chinese
            cache_dir: 模型缓存目录
            device: 运行设备 ("cpu", "cuda", "mps" 等)，None 表示自动检测
        """
        self.model_name = model_name
        self.cache_dir = cache_dir or MODEL_CACHE_DIR
        self._model: Optional[SentenceTransformer] = None
        self.device = device

    @property
    def model(self) -> SentenceTransformer:
        """延迟加载模型"""
        if self._model is None:
            self._model = SentenceTransformer(
                self.model_name,
                cache_folder=str(self.cache_dir)
            )
            # 如果指定了设备，移动模型到该设备
            if self.device:
                self._model.to(self.device)
        return self._model

    def __call__(self, input: List[str]) -> List[List[float]]:
        """
        生成文本嵌入向量

        Args:
            input: 文本列表

        Returns:
            嵌入向量列表
        """
        embeddings = self.model.encode(
            input,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False
        )
        return embeddings.tolist()

    def embed_query(self, text: str) -> List[float]:
        """
        嵌入单个查询文本

        Args:
            text: 查询文本

        Returns:
            嵌入向量
        """
        return self([text])[0]

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        嵌入文档列表

        Args:
            texts: 文本列表

        Returns:
            嵌入向量列表
        """
        return self(texts)


def create_chinese_embedding_function(
    model_name: str = DEFAULT_CHINESE_MODEL,
    cache_dir: Optional[Path] = None
) -> ChineseEmbeddingFunction:
    """
    创建中文嵌入函数的便捷函数

    Args:
        model_name: 模型名称
        cache_dir: 模型缓存目录

    Returns:
        中文嵌入函数实例
    """
    return ChineseEmbeddingFunction(
        model_name=model_name,
        cache_dir=cache_dir
    )


# 可用的中文模型列表
AVAILABLE_CHINESE_MODELS = {
    "text2vec-base-chinese": "shibing624/text2vec-base-chinese",
    "text2vec-base-chinese-paraphrase": "shibing624/text2vec-base-chinese-paraphrase",
    "m3e-base": "moka-ai/m3e-base",
    "m3e-large": "moka-ai/m3e-large",
    "bge-small-zh-v1.5": "BAAI/bge-small-zh-v1.5",
    "bge-base-zh-v1.5": "BAAI/bge-base-zh-v1.5",
    "bge-large-zh-v1.5": "BAAI/bge-large-zh-v1.5",
}


def get_model_info(model_key: str) -> str:
    """
    获取模型的完整 HuggingFace 名称

    Args:
        model_key: 模型简称

    Returns:
        完整模型名称
    """
    return AVAILABLE_CHINESE_MODELS.get(model_key, model_key)
