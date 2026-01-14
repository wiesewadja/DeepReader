import os
import tempfile
from pathlib import Path
from deeppdf.config import Config

def test_config_default_values():
    """测试默认配置值"""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = Config(base_dir=tmpdir)
        assert config.index_path == Path(tmpdir) / "indexes"
        assert config.chroma_path == Path(tmpdir) / "chroma"
        assert config.max_results == 5

def test_config_from_env():
    """测试从环境变量加载配置"""
    os.environ["DEEPPDF_MAX_RESULTS"] = "10"
    try:
        config = Config()
        assert config.max_results == 10
    finally:
        del os.environ["DEEPPDF_MAX_RESULTS"]
