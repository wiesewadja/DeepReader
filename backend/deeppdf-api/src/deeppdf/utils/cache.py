"""
缓存工具模块
提供带 TTL 的缓存装饰器和类
"""

import time
import logging
import threading
from functools import wraps
from typing import Any, Callable, Dict, Generic, Optional, TypeVar

logger = logging.getLogger(__name__)

K = TypeVar("K")
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    """
    带 TTL 的线程安全缓存
    """

    def __init__(self, ttl_seconds: float = 60.0, max_size: int = 100):
        """
        Args:
            ttl_seconds: 缓存过期时间（秒）
            max_size: 最大缓存条目数
        """
        self.ttl_seconds = ttl_seconds
        self.max_size = max_size
        self._cache: Dict[K, tuple[V, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: K) -> Optional[V]:
        """获取缓存值"""
        with self._lock:
            if key not in self._cache:
                return None

            value, expire_at = self._cache[key]
            if time.time() > expire_at:
                del self._cache[key]
                return None

            return value

    def set(self, key: K, value: V) -> None:
        """设置缓存值"""
        with self._lock:
            # 如果缓存已满，清理过期条目
            if len(self._cache) >= self.max_size:
                self._cleanup_locked()

            # 如果仍然满了，删除最旧的条目
            if len(self._cache) >= self.max_size:
                oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k][1])
                del self._cache[oldest_key]

            expire_at = time.time() + self.ttl_seconds
            self._cache[key] = (value, expire_at)

    def delete(self, key: K) -> bool:
        """删除缓存值"""
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        """清空缓存"""
        with self._lock:
            self._cache.clear()

    def _cleanup_locked(self) -> int:
        """清理过期条目（需要已持有锁）"""
        now = time.time()
        expired_keys = [
            k for k, (_, expire_at) in self._cache.items() if now > expire_at
        ]

        for key in expired_keys:
            del self._cache[key]

        return len(expired_keys)

    def cleanup(self) -> int:
        """清理过期条目"""
        with self._lock:
            return self._cleanup_locked()

    def __contains__(self, key: K) -> bool:
        return self.get(key) is not None

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)


def cached(
    ttl_seconds: float = 60.0,
    max_size: int = 100,
    key_func: Optional[Callable[..., Any]] = None,
):
    """
    缓存装饰器

    Args:
        ttl_seconds: 缓存过期时间（秒）
        max_size: 最大缓存条目数
        key_func: 自定义缓存键生成函数

    Usage:
        @cached(ttl_seconds=30)
        def expensive_function(arg):
            return arg * 2

        @cached(ttl_seconds=60, key_func=lambda a, b: f"{a}:{b}")
        def another_function(a, b):
            return a + b
    """

    cache = TTLCache(ttl_seconds=ttl_seconds, max_size=max_size)

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 生成缓存键
            if key_func:
                cache_key = key_func(*args, **kwargs)
            else:
                cache_key = (args, tuple(sorted(kwargs.items())))

            # 检查缓存
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.debug(f"Cache hit for {func.__name__}")
                return cached_result

            # 调用原函数
            result = func(*args, **kwargs)

            # 缓存结果
            cache.set(cache_key, result)
            logger.debug(f"Cache miss for {func.__name__}")

            return result

        # 添加缓存管理方法
        wrapper.cache = cache
        wrapper.cache_clear = cache.clear
        wrapper.cache_cleanup = cache.cleanup

        return wrapper

    return decorator


def cached_async(
    ttl_seconds: float = 60.0,
    max_size: int = 100,
    key_func: Optional[Callable[..., Any]] = None,
):
    """
    异步缓存装饰器

    Args:
        ttl_seconds: 缓存过期时间（秒）
        max_size: 最大缓存条目数
        key_func: 自定义缓存键生成函数
    """

    cache = TTLCache(ttl_seconds=ttl_seconds, max_size=max_size)

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存键
            if key_func:
                cache_key = key_func(*args, **kwargs)
            else:
                cache_key = (args, tuple(sorted(kwargs.items())))

            # 检查缓存
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.debug(f"Cache hit for {func.__name__}")
                return cached_result

            # 调用原函数
            result = await func(*args, **kwargs)

            # 缓存结果
            cache.set(cache_key, result)
            logger.debug(f"Cache miss for {func.__name__}")

            return result

        # 添加缓存管理方法
        wrapper.cache = cache
        wrapper.cache_clear = cache.clear
        wrapper.cache_cleanup = cache.cleanup

        return wrapper

    return decorator


class LRUCache(Generic[K, V]):
    """
    LRU (Least Recently Used) 缓存
    """

    def __init__(self, max_size: int = 100):
        from collections import OrderedDict

        self.max_size = max_size
        self._cache: "OrderedDict[K, V]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: K) -> Optional[V]:
        """获取缓存值（会更新访问顺序）"""
        with self._lock:
            if key not in self._cache:
                return None

            # 移动到末尾（最近使用）
            self._cache.move_to_end(key)
            return self._cache[key]

    def set(self, key: K, value: V) -> None:
        """设置缓存值"""
        with self._lock:
            if key in self._cache:
                # 更新并移动到末尾
                self._cache.move_to_end(key)
                self._cache[key] = value
            else:
                # 添加新条目
                self._cache[key] = value

                # 如果超出大小限制，删除最旧的条目
                if len(self._cache) > self.max_size:
                    self._cache.popitem(last=False)

    def delete(self, key: K) -> bool:
        """删除缓存值"""
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        """清空缓存"""
        with self._lock:
            self._cache.clear()

    def __contains__(self, key: K) -> bool:
        with self._lock:
            return key in self._cache

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)
