"""
PageIndex 配置管理模块

本模块提供配置加载、验证和管理功能。

主要功能:
    - 从 YAML 文件加载默认配置
    - 合并用户配置
    - 配置验证
    - LLM 客户端创建

使用示例:
    >>> from pageindex.core.config import ConfigLoader, load_config
    >>>
    >>> # 方式1: 使用 ConfigLoader
    >>> loader = ConfigLoader()
    >>> config = loader.load({"model": "gpt-4"})
    >>>
    >>> # 方式2: 使用便捷函数
    >>> config = load_config({"model": "gpt-4"})
    >>>
    >>> # 方式3: 创建 LLM 客户端
    >>> loader = ConfigLoader()
    >>> llm_client = loader.get_llm_client({"model": "gpt-4"})

配置文件格式:
    模型: model, llm_provider
    PDF: toc_check_page_num, max_page_num_each_node, max_token_num_each_node
    节点: if_add_node_id, if_add_node_summary, if_add_doc_description, if_add_node_text

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
from pathlib import Path
from types import SimpleNamespace as config
from typing import Union, Dict, Any, Optional

try:
    import yaml
except ImportError:
    yaml = None

from .exceptions import ValidationError


logger = logging.getLogger(__name__)


class ConfigLoader:
    """
    配置加载器

    负责加载默认配置，合并用户配置，并提供配置验证功能。

    属性:
        _default_dict: 默认配置字典（从 config.yaml 加载）
        _config_path: 配置文件路径

    配置合并规则:
        1. 用户配置覆盖默认配置
        2. 嵌套配置递归合并
        3. 未知配置键会抛出 ValidationError

    使用示例:
        >>> loader = ConfigLoader()
        >>> # 加载默认配置
        >>> default_config = loader.load()
        >>>
        >>> # 合并用户配置
        >>> user_config = loader.load({"model": "gpt-4"})
        >>>
        >>> # 创建 LLM 客户端
        >>> llm_client = loader.get_llm_client({"model": "gpt-4"})
    """

    def __init__(self, default_path: Optional[str] = None):
        """
        初始化配置加载器

        参数:
            default_path: 默认配置文件路径（可选）
                         默认为 pageindex/config.yaml

        异常:
            FileNotFoundError: 如果配置文件不存在且未提供 default_path
            yaml.YAMLError: 如果 YAML 格式错误
        """
        if default_path is None:
            # 默认使用 pageindex 模块目录下的 config.yaml
            default_path = Path(__file__).parent.parent / "config.yaml"

        self._config_path = Path(default_path)
        self._default_dict = self._load_yaml(self._config_path)

        logger.debug(f"配置加载器初始化: 配置文件={self._config_path}")

    @staticmethod
    def _load_yaml(path: Path) -> Dict[str, Any]:
        """
        加载 YAML 配置文件

        参数:
            path: YAML 文件路径

        返回:
            配置字典，如果文件为空则返回空字典

        异常:
            FileNotFoundError: 如果文件不存在
            yaml.YAMLError: 如果 YAML 格式错误
        """
        if yaml is None:
            raise ImportError(
                "PyYAML 未安装，请运行: pip install pyyaml"
            )

        logger.debug(f"加载配置文件: {path}")

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                # 确保返回字典
                return data if isinstance(data, dict) else {}
        except FileNotFoundError:
            logger.error(f"配置文件不存在: {path}")
            raise
        except yaml.YAMLError as e:
            logger.error(f"YAML 格式错误: {e}")
            raise

    def _validate_keys(self, user_dict: Dict[str, Any]) -> None:
        """
        验证用户配置的键名是否合法

        检查用户提供的配置键是否在默认配置中存在，防止拼写错误或无效配置。

        参数:
            user_dict: 用户配置字典

        异常:
            ValidationError: 如果包含未知的配置键

        示例:
            >>> loader = ConfigLoader()
            >>> loader._validate_keys({"model": "gpt-4"})  # ✓
            >>> loader._validate_keys{"unknown_key": "value"})  # ✗ 抛出异常
        """
        unknown_keys = set(user_dict.keys()) - set(self._default_dict.keys())

        if unknown_keys:
            raise ValidationError(
                f"未知的配置键: {unknown_keys}",
                parameter="config_keys",
                value=list(unknown_keys),
            )

        logger.debug("配置键验证通过")

    def _dict_to_config(self, data: Any) -> Any:
        """
        递归将字典转换为 SimpleNamespace

        SimpleNamespace 提供点号访问属性的功能 (config.key 而非 config["key"])

        参数:
            data: 要转换的数据（字典、列表或其他类型）

        返回:
            转换后的数据结构

        示例:
            >>> input_data = {"model": "gpt-4", "llm_provider": {"type": "openai"}}
            >>> config = self._dict_to_config(input_data)
            >>> config.model  # "gpt-4"
            >>> config.llm_provider.type  # "openai"
        """
        if isinstance(data, dict):
            # 递归转换字典
            return config(**{k: self._dict_to_config(v) for k, v in data.items()})
        elif isinstance(data, list):
            # 递归转换列表
            return [self._dict_to_config(item) for item in data]
        else:
            # 基础类型直接返回
            return data

    def load(
        self, user_opt: Union[Dict[str, Any], config, None] = None
    ) -> config:
        """
        加载配置，合并用户选项与默认值

        这是配置加载的主要入口点，支持多种输入格式。

        参数:
            user_opt: 用户配置，支持以下格式:
                - None: 只使用默认配置
                - dict: 配置字典
                - config(SimpleNamespace): 配置对象

        返回:
            合并后的配置对象 (SimpleNamespace)

        异常:
            ValidationError: 如果包含未知的配置键
            TypeError: 如果 user_opt 类型不正确

        使用示例:
            >>> loader = ConfigLoader()
            >>>
            >>> # 只使用默认配置
            >>> config = loader.load()
            >>>
            >>> # 使用字典配置
            >>> config = loader.load({"model": "gpt-4"})
            >>> print(config.model)  # "gpt-4"
            >>>
            >>> # 使用 config 对象
            >>> user_config = config(model="gpt-4")
            >>> config = loader.load(user_config)
        """
        # ============================================================
        # 步骤1: 处理输入格式
        # ============================================================
        if user_opt is None:
            user_dict = {}
        elif isinstance(user_opt, config):
            # SimpleNamespace 转字典
            user_dict = vars(user_opt)
        elif isinstance(user_opt, dict):
            user_dict = user_opt
        else:
            raise TypeError(
                f"user_opt 必须是 dict, config(SimpleNamespace) 或 None，"
                f"实际类型: {type(user_opt).__name__}"
            )

        # ============================================================
        # 步骤2: 验证配置键
        # ============================================================
        self._validate_keys(user_dict)

        # ============================================================
        # 步骤3: 合并配置
        # ============================================================
        # 用户配置覆盖默认配置
        merged = {**self._default_dict, **user_dict}

        logger.debug(f"配置合并完成: 用户键={list(user_dict.keys())}")

        # ============================================================
        # 步骤4: 转换为 SimpleNamespace
        # ============================================================
        return self._dict_to_config(merged)

    def get_llm_client(
        self, user_opt: Union[Dict[str, Any], config, None] = None
    ):
        """
        创建 LLM 客户端实例

        根据配置创建相应的 LLM provider 和 UnifiedLLM 实例。
        支持单 Provider 和多 Provider 两种模式。

        参数:
            user_opt: 用户配置（可选）。格式同 load() 方法

        返回:
            UnifiedLLM 客户端实例

        异常:
            ImportError: 如果 llm_provider 模块无法导入
            ValidationError: 如果 llm_provider 配置无效

        使用示例:
            >>> loader = ConfigLoader()
            >>>
            >>> # 使用默认配置（单 Provider）
            >>> llm_client = loader.get_llm_client()
            >>>
            >>> # 使用自定义配置
            >>> llm_client = loader.get_llm_client({
            ...     "model": "gpt-4",
            ...     "llm_provider": {"type": "openai", "api_key": "..."}
            ... })
            >>>
            >>> # 使用多 Provider 并行模式
            >>> llm_client = loader.get_llm_client({
            ...     "model": "deepseek-chat",
            ...     "llm_providers": [
            ...         {"type": "deepseek", "weight": 1},
            ...         {"type": "siliconflow", "weight": 1}
            ...     ]
            ... })
        """
        # 延迟导入，避免循环依赖
        from ..llm import get_provider, get_multi_provider, UnifiedLLM

        # ============================================================
        # 步骤1: 加载配置
        # ============================================================
        cfg = self.load(user_opt)

        # ============================================================
        # 步骤2: 获取多 Provider 配置
        # ============================================================
        providers_config = getattr(cfg, "llm_providers", None)

        if not providers_config:
            raise ValidationError(
                "缺少 llm_providers 配置，请在 config.yaml 中配置 llm_providers",
                parameter="llm_providers",
            )

        # 多 Provider 模式
        logger.debug(f"使用多 Provider 模式: {len(providers_config)} 个 Provider")
        try:
            provider = get_multi_provider(providers_config)
        except Exception as e:
            raise ValidationError(
                f"MultiProvider 创建失败: {e}",
                parameter="llm_providers",
                value=providers_config,
                original_error=e,
            )

        # ============================================================
        # 步骤3: 创建 UnifiedLLM 实例
        # ============================================================
        # model 是必需配置项，不应该有默认值
        if not hasattr(cfg, "model") or not cfg.model:
            raise ValidationError(
                "缺少必需的 model 配置",
                parameter="model"
            )

        model = cfg.model
        llm_client = UnifiedLLM(provider=provider, model=model)

        provider_info = f"MultiProvider({len(providers_config)} 个)"
        logger.info(f"LLM 客户端创建成功: model={model}, provider={provider_info}")

        return llm_client


def load_config(
    user_opt: Union[Dict[str, Any], config, None] = None,
    config_path: Optional[str] = None,
) -> config:
    """
    便捷函数：加载配置

    这是一个简化的配置加载接口，适合快速使用。

    参数:
        user_opt: 用户配置（可选）
        config_path: 配置文件路径（可选）

    返回:
        配置对象 (SimpleNamespace)

    使用示例:
        >>> from pageindex.core.config import load_config
        >>>
        >>> # 加载默认配置
        >>> config = load_config()
        >>>
        >>> # 加载并覆盖配置
        >>> config = load_config({"model": "gpt-4"})
        >>> print(config.model)  # "gpt-4"
    """
    loader = ConfigLoader(config_path)
    return loader.load(user_opt)
