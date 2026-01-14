"""
pytest 配置文件
自动加载 .env 文件中的环境变量
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 获取项目根目录的 .env 文件
project_root = Path(__file__).parent.parent
env_file = project_root / ".env"

# 加载环境变量
if env_file.exists():
    load_dotenv(env_file)
