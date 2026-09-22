#!/usr/bin/env python3
"""Очередь задач подачи: аренда, сердцебиение, чекпоинты, повторы.

Свайп вправо не должен синхронно ждать чужой сайт: внешняя анкета — это
десятки секунд, капча — это часы. Поэтому свайп кладёт задачу, а воркер её
берёт.

Три вещи, ради которых это написано отдельно от агента.

Аренда. Воркер умирает — задача не должна умереть вместе с ним и не должна
тут же достаться второму воркеру, пока первый ещё жив. Отсюда срок аренды и
сердцебиение.

Чекпоинт. Прогон дорогой: открыли сайт, нашли вакансию, заполнили анкету.
Начинать заново после перезапуска — терять всё это и заново трогать сайт
работодателя.

Предел на домен. Двадцать свайпов подряд по одному работодателю не должны
превратиться в двадцать одновременных запросов к нему.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class TaskState:
    QUEUED = "queued"
    OPENING_SITE = "opening_site"
    FINDING_VACANCY = "finding_vacancy"
    OPENING_APPLICATION = "opening_application"
    FILLING = "filling"
    VALIDATING = "validating"
    READY_TO_SUBMIT = "ready_to_submit"
    SUBMITTING = "submitting"
    VERIFYING = "verifying"
    SUBMITTED = "submitted"
    ACTION_REQUIRED = "action_required"
    SUBMISSION_UNKNOWN = "submission_unknown"
    DUPLICATE = "duplicate"
    RETRYABLE_FAILED = "retryable_failed"
    FAILED = "failed"


# Состояния, из которых задача больше не берётся в работу.
TERMINAL = {
    TaskState.SUBMITTED,
    TaskState.DUPLICATE,
    TaskState.FAILED,
    # Ждут человека, а не воркера.
    TaskState.ACTION_REQUIRED,
    TaskState.SUBMISSION_UNKNOWN,
}

DEFAULT_LEASE_SECONDS = 300
MAX_ATTEMPTS = 3
# Пауза перед повтором: 1, 4, 9 минут. Работодателя долбить нельзя.
BACKOFF_BASE_SECONDS = 60


@dataclass
class ApplicationTask:
    id: str
    candidate_id: str
    vacancy_url: str
    state: str = TaskState.QUEUED
    attempt_count: int = 0
    lease_owner: str | None = None
    lease_until: float = 0.0
    heartbeat_at: float = 0.0
    not_before: float = 0.0
    checkpoint: dict[str, Any] = field(default_factory=dict)
    reason_code: str | None = None
    last_error: str | None = None
    resume_token: str | None = None
    receipt_key: str | None = None
    transitions: list[dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def domain(self) -> str:
        return (urllib.parse.urlsplit(self.vacancy_url).hostname or "").lower()

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "candidate_id": self.candidate_id,
            "vacancy_url": self.vacancy_url,
            "state": self.state,
            "attempt_count": self.attempt_count,
            "lease_owner": self.lease_owner,
            "lease_until": self.lease_until,
            "heartbeat_at": self.heartbeat_at,
            "not_before": self.not_before,
            "checkpoint": dict(self.checkpoint),
            "reason_code": self.reason_code,
            "last_error": self.last_error,
            "resume_token": self.resume_token,
            "receipt_key": self.receipt_key,
            "transitions": list(self.transitions),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ApplicationTask":
        task = cls(
            id=str(raw.get("id", "")),
            candidate_id=str(raw.get("candidate_id", "")),
            vacancy_url=str(raw.get("vacancy_url", "")),
            state=str(raw.get("state", TaskState.QUEUED)),
            attempt_count=int(raw.get("attempt_count", 0) or 0),
            lease_owner=raw.get("lease_owner"),
            lease_until=float(raw.get("lease_until", 0) or 0),
            heartbeat_at=float(raw.get("heartbeat_at", 0) or 0),
            not_before=float(raw.get("not_before", 0) or 0),
            checkpoint=dict(raw.get("checkpoint") or {}),
            reason_code=raw.get("reason_code"),
            last_error=raw.get("last_error"),
            resume_token=raw.get("resume_token"),
            receipt_key=raw.get("receipt_key"),
            transitions=list(raw.get("transitions") or []),
        )
        task.created_at = float(raw.get("created_at", 0) or time.time())
        task.updated_at = float(raw.get("updated_at", 0) or time.time())
        return task


class TaskQueue:
    """Очередь задач. Файл или память — переезд в базу будет заменой класса."""

    def __init__(
        self,
        path: str | None = None,
        *,
        per_domain_limit: int = 2,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
        max_attempts: int = MAX_ATTEMPTS,
    ):
        self.path = Path(path) if path else None
        self.per_domain_limit = per_domain_limit
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        self._items: dict[str, ApplicationTask] = {}
        if self.path and self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = {}
            for task_id, item in (raw or {}).items():
                if isinstance(item, dict):
                    self._items[task_id] = ApplicationTask.from_dict(item)

    # ── чтение ──────────────────────────────────────────────────────────────

    def get(self, task_id: str) -> ApplicationTask | None:
        return self._items.get(task_id)

    def all(self) -> list[ApplicationTask]:
        return list(self._items.values())

    def _leased_now(self, domain: str, now: float) -> int:
        return sum(
            1 for task in self._items.values()
            if task.domain == domain
            and task.lease_owner is not None
            and task.lease_until > now
        )

    # ── запись ──────────────────────────────────────────────────────────────

    def push(self, candidate_id: str, vacancy_url: str) -> ApplicationTask:
        task = ApplicationTask(
            id=uuid.uuid4().hex,
            candidate_id=candidate_id,
            vacancy_url=vacancy_url,
        )
        self._transition(task, TaskState.QUEUED, note="queued")
        self._items[task.id] = task
        self._flush()
        return task

    def lease(self, worker: str, now: float | None = None) -> ApplicationTask | None:
        """Взять задачу в работу. None — брать нечего."""
        now = time.time() if now is None else now
        ready = [
            task for task in self._items.values()
            if task.state not in TERMINAL
            and task.not_before <= now
            and (task.lease_owner is None or task.lease_until <= now)
        ]
        # Старые вперёд: иначе задача с популярного домена может ждать вечно.
        ready.sort(key=lambda task: task.created_at)
        for task in ready:
            if self._leased_now(task.domain, now) >= self.per_domain_limit:
                continue
            task.lease_owner = worker
            task.lease_until = now + self.lease_seconds
            task.heartbeat_at = now
            task.attempt_count += 1
            self._transition(task, TaskState.OPENING_SITE, note=f"leased by {worker}")
            self._flush()
            return task
        return None

    def heartbeat(self, task_id: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        task = self._items.get(task_id)
        if task is None or task.lease_owner is None:
            return False
        task.heartbeat_at = now
        task.lease_until = now + self.lease_seconds
        task.updated_at = now
        self._flush()
        return True

    def checkpoint(self, task_id: str, state: str, data: dict[str, Any]) -> None:
        """Отметить шаг, чтобы после перезапуска не начинать сначала."""
        task = self._items.get(task_id)
        if task is None:
            return
        task.checkpoint = dict(data)
        self._transition(task, state, note="checkpoint")
        self._flush()

    def finish(
        self,
        task_id: str,
        state: str,
        *,
        reason_code: str | None = None,
        resume_token: str | None = None,
        receipt_key: str | None = None,
    ) -> None:
        task = self._items.get(task_id)
        if task is None:
            return
        task.lease_owner = None
        task.lease_until = 0.0
        task.reason_code = reason_code
        task.resume_token = resume_token
        task.receipt_key = receipt_key
        self._transition(task, state, note="finished")
        self._flush()

    def fail(
        self,
        task_id: str,
        error: str,
        *,
        retryable: bool = True,
        now: float | None = None,
    ) -> str:
        """Записать неудачу. Возвращает итоговое состояние задачи."""
        now = time.time() if now is None else now
        task = self._items.get(task_id)
        if task is None:
            return TaskState.FAILED
        task.lease_owner = None
        task.lease_until = 0.0
        task.last_error = error[:500]
        if retryable and task.attempt_count < self.max_attempts:
            # Пауза растёт: повторять сразу — значит ломиться к работодателю,
            # у которого только что что-то не сложилось.
            task.not_before = now + BACKOFF_BASE_SECONDS * (task.attempt_count ** 2)
            self._transition(task, TaskState.RETRYABLE_FAILED, note=error[:200])
        else:
            self._transition(task, TaskState.FAILED, note=error[:200])
        self._flush()
        return task.state

    def release_expired(self, now: float | None = None) -> list[str]:
        """Вернуть в очередь задачи умерших воркеров."""
        now = time.time() if now is None else now
        released: list[str] = []
        for task in self._items.values():
            if task.lease_owner is not None and task.lease_until <= now:
                task.lease_owner = None
                task.lease_until = 0.0
                self._transition(task, TaskState.QUEUED, note="lease expired")
                released.append(task.id)
        if released:
            self._flush()
        return released

    # ── внутреннее ──────────────────────────────────────────────────────────

    def _transition(self, task: ApplicationTask, state: str, *, note: str) -> None:
        now = time.time()
        task.transitions.append({
            "from": task.state,
            "to": state,
            "at": now,
            "attempt": task.attempt_count,
            "note": note,
        })
        task.state = state
        task.updated_at = now

    def _flush(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(
                    {k: v.as_dict() for k, v in self._items.items()},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        except OSError:
            pass
