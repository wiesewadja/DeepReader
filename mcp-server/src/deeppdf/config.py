import os
from pathlib import Path
from dataclasses import dataclass

@dataclass
class Config:
    """MCP 服务器配置"""
    base_dir: str = None
    max_results: int = 5

    def __post_init__(self):
        if self.base_dir is None:
            self.base_dir = Path(__file__).parent.parent / "data"
        else:
            self.base_dir = Path(self.base_dir)

        self.index_path = self.base_dir / "indexes"
        self.chroma_path = self.base_dir / "chroma"

        # 从环境变量覆盖
        if "DEEPPDF_MAX_RESULTS" in os.environ:
            self.max_results = int(os.environ["DEEPPDF_MAX_RESULTS"])

        # 创建必要的目录
        self.index_path.mkdir(parents=True, exist_ok=True)
        self.chroma_path.mkdir(parents=True, exist_ok=True)
