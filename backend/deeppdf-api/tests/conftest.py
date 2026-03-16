"""
Pytest 配置文件
"""

import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app
from deeppdf.config import settings

# 需要跳过的测试文件（引用了已移除的 deeppdf.agent 模块或已删除的类型）
SKIP_FILES = [
    "test_core.py",
    "test_executor.py",
    "test_llm_tree_search_tool.py",
    "test_markdown_locator.py",
    "test_prompt_builder.py",
    "test_prompt_versions.py",
    "test_prompts.py",
    "test_api_routes.py",
    "test_llm_tree_search_e2e.py",
]


def pytest_ignore_collect(collection_path, config):
    """在收集阶段忽略特定测试文件"""
    path_str = str(collection_path)
    for skip_file in SKIP_FILES:
        if skip_file in path_str:
            return True
    return False


@pytest.fixture(autouse=True)
def clean_test_configs():
    """
    自动清理测试配置的 fixture

    在每个测试前清理配置目录，确保测试之间互不影响
    autouse=True 表示每个测试自动使用此 fixture
    """
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
