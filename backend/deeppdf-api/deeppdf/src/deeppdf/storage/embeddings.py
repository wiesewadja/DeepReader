"""
中文文本嵌入函数
使用 HuggingFaceEmbeddings 加载本地中文向量模型
"""
from typing import List, Optional
from pathlib import Path
try:
    from langchain_huggingface import HuggingFaceEmbeddings
except ImportError:
    from langchain_community.embeddings import HuggingFaceEmbeddings


# 默认中文模型 - BAAI bge-small-zh-v1.5 (更小更快，性能优秀)
DEFAULT_CHINESE_MODEL = "BAAI/bge-small-zh-v1.5"

# 模型缓存目录
MODEL_CACHE_DIR = Path.home() / ".cache" / "deeppdf" / "models"


class ChineseEmbeddingFunction:
    """
    中文文本嵌入函数
    用于 ChromaDB 的文本向量化
    使用 HuggingFaceEmbeddings 加载模型
    """

    def __init__(
        self,
        model_name: str = DEFAULT_CHINESE_MODEL,
        cache_dir: Optional[Path] = None,
        device: Optional[str] = None,
        encode_kwargs: Optional[dict] = None
    ):
        """
        初始化中文嵌入函数

        Args:
            model_name: 模型名称，默认使用 BAAI/bge-small-zh-v1.5
            cache_dir: 模型缓存目录
            device: 运行设备 ("cpu", "cuda", "mps" 等)，None 表示自动检测
            encode_kwargs: 编码参数
        """
        self.model_name = model_name
        self.cache_dir = cache_dir or MODEL_CACHE_DIR
        self.device = device
        self.encode_kwargs = encode_kwargs or {
            "normalize_embeddings": True  # 归一化嵌入向量
        }
        self._embedding_model: Optional[HuggingFaceEmbeddings] = None

    @property
    def embedding_model(self) -> HuggingFaceEmbeddings:
        """延迟加载模型"""
        if self._embedding_model is None:
            # 配置 HuggingFaceEmbeddings
            model_kwargs = {}
            if self.device:
                model_kwargs["device"] = self.device

            self._embedding_model = HuggingFaceEmbeddings(
                model_name=self.model_name,
                cache_folder=str(self.cache_dir),
                model_kwargs=model_kwargs,
                encode_kwargs=self.encode_kwargs
            )
        return self._embedding_model

    def __call__(self, input: List[str]) -> List[List[float]]:
        """
        生成文本嵌入向量

        Args:
            input: 文本列表

        Returns:
            嵌入向量列表
        """
        embeddings = self.embedding_model.embed_documents(input)
        return embeddings

    def embed_query(self, text: str) -> List[float]:
        """
        嵌入单个查询文本

        Args:
            text: 查询文本

        Returns:
            嵌入向量
        """
        return self.embedding_model.embed_query(text)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        嵌入文档列表

        Args:
            texts: 文本列表

        Returns:
            嵌入向量列表
        """
        return self.embedding_model.embed_documents(texts)


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
    # BAAI BGE 系列 - 推荐
    "bge-small-zh": "BAAI/bge-small-zh-v1.5",
    "bge-base-zh": "BAAI/bge-base-zh-v1.5",
    "bge-large-zh": "BAAI/bge-large-zh-v1.5",
    # M3E 系列
    "m3e-small": "moka-ai/m3e-small",
    "m3e-base": "moka-ai/m3e-base",
    "m3e-large": "moka-ai/m3e-large",
    # Text2vec 系列
    "text2vec": "shibing624/text2vec-base-chinese",
    "text2vec-large": "shibing624/text2vec-base-chinese-paraphrase",
    # Multilingual
    "multilingual-e5": "intfloat/multilingual-e5-large",
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


def get_model_dimension(model_name: str) -> int:
    """
    获取模型的向量维度

    Args:
        model_name: 模型名称

    Returns:
        向量维度
    """
    dimensions = {
        "BAAI/bge-small-zh-v1.5": 512,
        "BAAI/bge-base-zh-v1.5": 768,
        "BAAI/bge-large-zh-v1.5": 1024,
        "moka-ai/m3e-small": 512,
        "moka-ai/m3e-base": 768,
        "moka-ai/m3e-large": 1024,
        "shibing624/text2vec-base-chinese": 768,
    }
    return dimensions.get(model_name, 768)  # 默认 768
