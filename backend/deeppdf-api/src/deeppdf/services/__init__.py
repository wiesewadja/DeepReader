"""
业务逻辑服务层
"""

from deeppdf.services.indexer import index_pdf
from deeppdf.services.manager import list_indexes, delete_index

__all__ = [
    "index_pdf",
    "list_indexes",
    "delete_index",
]
