"""
Pytest 配置文件
"""

import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app


@pytest.fixture(autouse=True)
def clean_test_configs():
    """
    自动清理测试配置的 fixture

    在每个测试前清理配置目录，确保测试之间互不影响
    autouse=True 表示每个测试自动使用此 fixture
    """
    from deeppdf.config import settings

    # 获取配置目录
    configs_dir = Path(settings.base_dir) / "configs" / "configs"

    # 测试前清理
    if configs_dir.exists():
        # 备份并删除所有 JSON 配置文件
        for config_file in configs_dir.glob("*.json"):
            try:
                config_file.unlink()
            except Exception:
                pass

    yield

    # 测试后再次清理（确保清理干净）
    if configs_dir.exists():
        for config_file in configs_dir.glob("*.json"):
            try:
                config_file.unlink()
            except Exception:
                pass


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)
