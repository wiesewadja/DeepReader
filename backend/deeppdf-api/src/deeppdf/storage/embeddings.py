"""
中文文本嵌入函数
使用 HuggingFaceEmbeddings 加载本地中文向量模型
"""

from typing import List, Optional, Dict
from pathlib import Path
from threading import Lock

try:
    from langchain_huggingface import HuggingFaceEmbeddings
except ImportError:
    from langchain_community.embeddings import HuggingFaceEmbeddings


# 默认中文模型 - BAAI bge-small-zh-v1.5 (更小更快，性能优秀)
DEFAULT_CHINESE_MODEL = "BAAI/bge-small-zh-v1.5"

# 模型缓存目录
MODEL_CACHE_DIR = Path.home() / ".cache" / "deeppdf" / "models"


class EmbeddingModelCache:
    """
    嵌入模型缓存（单例模式）
    确保相同配置的模型只加载一次，避免内存浪费
    """

    _instance = None
    _lock = Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._models: Dict[str, HuggingFaceEmbeddings] = {}
                    cls._instance._refs: Dict[str, int] = {}
        return cls._instance

    def get_model(
        self,
        model_name: str,
        cache_dir: Path,
        device: Optional[str] = None,
        encode_kwargs: Optional[dict] = None,
    ) -> HuggingFaceEmbeddings:
        """
        获取或创建嵌入模型实例

        Args:
            model_name: 模型名称
            cache_dir: 模型缓存目录
            device: 运行设备
            encode_kwargs: 编码参数

        Returns:
            HuggingFaceEmbeddings 模型实例
        """
        # 生成缓存键
        cache_key = f"{model_name}_{cache_dir}_{device}_{encode_kwargs}"

        with self._lock:
            if cache_key not in self._models:
                # 创建新模型
                model_kwargs = {}
                if device:
                    model_kwargs["device"] = device

                self._models[cache_key] = HuggingFaceEmbeddings(
                    model_name=model_name,
                    cache_folder=str(cache_dir),
                    model_kwargs=model_kwargs,
                    encode_kwargs=encode_kwargs or {"normalize_embeddings": True},
                )
                self._refs[cache_key] = 1
            else:
                # 增加引用计数
                self._refs[cache_key] += 1

            return self._models[cache_key]

    def release_model(self, cache_key: str) -> None:
        """
        释放模型引用（减少引用计数）

        Args:
            cache_key: 模型缓存键
        """
        with self._lock:
            if cache_key in self._refs:
                self._refs[cache_key] -= 1
                # 可选：当引用计数为 0 时清理模型
                # if self._refs[cache_key] <= 0:
                #     del self._models[cache_key]
                #     del self._refs[cache_key]

    def clear_cache(self) -> None:
        """清空所有缓存的模型"""
        with self._lock:
            self._models.clear()
            self._refs.clear()


# 全局模型缓存实例
_model_cache = EmbeddingModelCache()


class ChineseEmbeddingFunction:
    """
    中文文本嵌入函数
    用于 ChromaDB 的文本向量化
    使用 HuggingFaceEmbeddings 加载模型（带缓存）
    """

    def __init__(
        self,
        model_name: str = DEFAULT_CHINESE_MODEL,
        cache_dir: Optional[Path] = None,
        device: Optional[str] = None,
        encode_kwargs: Optional[dict] = None,
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
        self._cache_key: Optional[str] = None

    @property
    def embedding_model(self) -> HuggingFaceEmbeddings:
        """延迟加载模型（使用全局缓存）"""
        if self._embedding_model is None:
            # 生成缓存键
            self._cache_key = (
                f"{self.model_name}_{self.cache_dir}_{self.device}_{self.encode_kwargs}"
            )

            # 从全局缓存获取模型
            self._embedding_model = _model_cache.get_model(
                model_name=self.model_name,
                cache_dir=self.cache_dir,
                device=self.device,
                encode_kwargs=self.encode_kwargs,
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

    def __del__(self):
        """析构函数，释放模型引用"""
        if self._cache_key and hasattr(self, "_model_cache"):
            _model_cache.release_model(self._cache_key)


def create_chinese_embedding_function(
    model_name: str = DEFAULT_CHINESE_MODEL, cache_dir: Optional[Path] = None
) -> ChineseEmbeddingFunction:
    """
    创建中文嵌入函数的便捷函数

    Args:
        model_name: 模型名称
        cache_dir: 模型缓存目录

    Returns:
        中文嵌入函数实例
    """
    return ChineseEmbeddingFunction(model_name=model_name, cache_dir=cache_dir)


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
