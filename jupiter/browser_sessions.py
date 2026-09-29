#!/usr/bin/env python3
"""Пул открытых браузерных сессий, ждущих человека.

Капча привязана к живой странице: закроешь её — ответ человека уже не к чему
приложить. Поэтому на время ожидания движок не закрывается, а паркуется здесь.

Память ограничена двумя способами: не больше max_sessions сессий (при
переполнении закрывается самая старая) и не дольше ttl_seconds на сессию.
Закрытые из-за лимита или срока task_id возвращаются вызывающему — ему нужно
отметить эти задачи «время вышло».

Важно: sync-Playwright привязан к потоку, где создан движок. park/take/expire
вызывать из потока воркера, а не из потока heartbeat.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("jupiter.browser_sessions")


@dataclass
class ParkedSession:
    task_id: str
    engine: Any
    meta: dict[str, Any] = field(default_factory=dict)
    parked_at: float = 0.0


class SessionPool:
    def __init__(
        self,
        max_sessions: int = 3,
        ttl_seconds: float = 600,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_sessions = max(1, max_sessions)
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        # dict хранит порядок вставки: первый ключ — самая старая сессия.
        self._sessions: dict[str, ParkedSession] = {}

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def __contains__(self, task_id: str) -> bool:
        with self._lock:
            return task_id in self._sessions

    @staticmethod
    def _close(session: ParkedSession) -> None:
        try:
            session.engine.close()
        except Exception:
            log.exception("could not close parked session %s", session.task_id)

    def park(self, task_id: str, engine: Any, meta: dict[str, Any] | None = None) -> list[str]:
        """Держать engine открытым. Возвращает task_id вытесненных сессий
        (уже закрытых): прежняя сессия той же задачи и самые старые при переполнении."""
        dropped: list[ParkedSession] = []
        with self._lock:
            old = self._sessions.pop(task_id, None)
            if old is not None and old.engine is not engine:
                dropped.append(old)
            while len(self._sessions) >= self.max_sessions:
                oldest = next(iter(self._sessions))
                dropped.append(self._sessions.pop(oldest))
            self._sessions[task_id] = ParkedSession(
                task_id, engine, dict(meta or {}), self._clock()
            )
        for session in dropped:
            self._close(session)
        return [s.task_id for s in dropped]

    def take(self, task_id: str) -> Any | None:
        """Забрать engine (владение переходит вызывающему). None — сессии нет
        или она уже просрочена."""
        with self._lock:
            session = self._sessions.pop(task_id, None)
            if session is None:
                return None
            expired = self._clock() - session.parked_at >= self.ttl_seconds
        if expired:
            self._close(session)
            return None
        return session.engine

    def meta(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.get(task_id)
            return dict(session.meta) if session else None

    def expire(self) -> list[str]:
        """Закрыть просроченные сессии; вернуть их task_id."""
        now = self._clock()
        with self._lock:
            stale = [s for s in self._sessions.values()
                     if now - s.parked_at >= self.ttl_seconds]
            for s in stale:
                del self._sessions[s.task_id]
        for s in stale:
            self._close(s)
        return [s.task_id for s in stale]

    def close_all(self) -> list[str]:
        """Остановка воркера: закрыть всё."""
        with self._lock:
            rest = list(self._sessions.values())
            self._sessions.clear()
        for s in rest:
            self._close(s)
        return [s.task_id for s in rest]
