import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

from ..config import settings

logger = logging.getLogger(__name__)

class ChatStorage:
    """会话历史存储服务

    存储路径: .deeppdf/chats/{index_id}/{session_id}.json
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir) if storage_dir else settings.base_dir / "chats"
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _get_chat_path(self, index_id: str, session_id: str) -> Path:
        """获取聊天文件路径"""
        index_dir = self.storage_dir / index_id
        index_dir.mkdir(parents=True, exist_ok=True)
        return index_dir / f"{session_id}.json"

    def save_history(self, index_id: str, session_id: str, history: List[Dict[str, Any]]) -> None:
        """保存会话历史"""
        try:
            file_path = self._get_chat_path(index_id, session_id)
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            logger.info(f"[ChatStorage] 已保存历史: {file_path}")
        except Exception as e:
            logger.error(f"[ChatStorage] 保存历史失败: {e}")

    def load_history(self, index_id: str, session_id: str) -> List[Dict[str, Any]]:
        """加载会话历史"""
        try:
            file_path = self._get_chat_path(index_id, session_id)
            if not file_path.exists():
                return []

            with open(file_path, "r", encoding="utf-8") as f:
                history = json.load(f)
            logger.info(f"[ChatStorage] 已加载历史: {file_path} ({len(history)} 条)")
            return history
        except Exception as e:
            logger.error(f"[ChatStorage] 加载历史失败: {e}")
            return []

    def list_sessions(self, index_id: str) -> List[str]:
        """列出某个索引的所有会话ID"""
        index_dir = self.storage_dir / index_id
        if not index_dir.exists():
            return []

        sessions = []
        for file in index_dir.glob("*.json"):
            sessions.append(file.stem)
        return sessions

    def delete_session(self, index_id: str, session_id: str) -> bool:
        """删除指定会话"""
        try:
            file_path = self._get_chat_path(index_id, session_id)
            if file_path.exists():
                file_path.unlink()
                logger.info(f"[ChatStorage] 已删除会话: {file_path}")
                return True
            return False
        except Exception as e:
            logger.error(f"[ChatStorage] 删除会话失败: {e}")
            return False

    def get_session_info(self, index_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        """获取会话信息（包括消息数量、创建时间等）"""
        try:
            file_path = self._get_chat_path(index_id, session_id)
            if not file_path.exists():
                return None

            # 获取文件统计信息
            stat = file_path.stat()
            created_time = datetime.fromtimestamp(stat.st_ctime).isoformat()
            modified_time = datetime.fromtimestamp(stat.st_mtime).isoformat()

            # 读取历史记录获取消息数量
            history = self.load_history(index_id, session_id)

            return {
                "sessionId": session_id,
                "indexId": index_id,
                "messageCount": len(history),
                "createdTime": created_time,
                "lastMessageTime": modified_time,
            }
        except Exception as e:
            logger.error(f"[ChatStorage] 获取会话信息失败: {e}")
            return None

    def list_sessions_with_info(self, index_id: str) -> List[Dict[str, Any]]:
        """列出某个索引的所有会话及其详细信息"""
        session_ids = self.list_sessions(index_id)
        sessions_info = []

        for session_id in session_ids:
            info = self.get_session_info(index_id, session_id)
            if info:
                sessions_info.append(info)

        # 按最后消息时间倒序排列
        sessions_info.sort(key=lambda x: x["lastMessageTime"], reverse=True)
        return sessions_info

# 全局实例
chat_storage = ChatStorage()
