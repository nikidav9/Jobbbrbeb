#!/usr/bin/env python3
"""Мост между очередью в базе и воркером Jupiter.

Клиент кладёт задачу свайпом (jupiterEnqueue → jm_jupiter_applications).
Воркер берёт её через этот класс: те же lease/heartbeat/checkpoint/finish,
что у локальной TaskQueue, но за каждым вызовом — HTTP-запрос к db.php.

Только stdlib: у Jupiter нет и не будет внешних зависимостей.
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any

from tasks import ApplicationTask, TaskState

DEFAULT_LEASE_SECONDS = 300


class RemoteError(Exception):
    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {body[:200]}")


class RemoteTaskQueue:
    """Очередь задач через RPC к серверу JobToo."""

    def __init__(
        self,
        base_url: str,
        admin_token: str,
        *,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ):
        self._url = base_url.rstrip("/") + "/api/db.php"
        self._token = admin_token
        self._lease_seconds = lease_seconds
        self._worker: str | None = None

    def _call(self, fn: str, args: list[Any]) -> Any:
        body = json.dumps({"fn": fn, "args": args}).encode()
        req = urllib.request.Request(
            self._url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Admin-Token": self._token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            text = exc.read().decode(errors="replace")
            raise RemoteError(exc.code, text) from None

    def _row_to_task(self, row: dict[str, Any]) -> ApplicationTask:
        return ApplicationTask(
            id=str(row["id"]),
            candidate_id=str(row.get("user_id", "")),
            vacancy_url=str(row.get("vacancy_url", "")),
            state=str(row.get("state", TaskState.QUEUED)),
            attempt_count=int(row.get("attempt_count", 0) or 0),
            lease_owner=row.get("lease_owner"),
            checkpoint=row.get("checkpoint") or {},
            reason_code=row.get("reason_code"),
            last_error=row.get("last_error"),
            resume_token=row.get("resume_token"),
            receipt_key=row.get("receipt_key"),
        )

    # ── публичный интерфейс ────────────────────────────────────────────────

    def lease(self, worker: str) -> ApplicationTask | None:
        self._worker = worker
        result = self._call("jupiterLease", [worker, self._lease_seconds])
        if result is None:
            return None
        return self._row_to_task(result)

    def heartbeat(self, task_id: str) -> bool:
        if self._worker is None:
            return False
        try:
            result = self._call(
                "jupiterHeartbeat", [task_id, self._worker, self._lease_seconds]
            )
            return bool(result and result.get("ok"))
        except RemoteError as exc:
            if exc.status == 409:
                return False
            raise

    def checkpoint(self, task_id: str, state: str, data: dict[str, Any]) -> None:
        if self._worker is None:
            return
        self._call(
            "jupiterCheckpoint",
            [task_id, self._worker, state, data],
        )

    def finish(
        self,
        task_id: str,
        state: str,
        *,
        reason_code: str | None = None,
        resume_token: str | None = None,
        receipt_key: str | None = None,
    ) -> None:
        if self._worker is None:
            return
        extra: dict[str, Any] = {}
        if reason_code is not None:
            extra["reason_code"] = reason_code
        if resume_token is not None:
            extra["resume_token"] = resume_token
        if receipt_key is not None:
            extra["receipt_key"] = receipt_key
        self._call("jupiterFinish", [task_id, self._worker, state, extra])

    def fail(
        self,
        task_id: str,
        error: str,
        *,
        retryable: bool = True,
    ) -> str:
        state = TaskState.RETRYABLE_FAILED if retryable else TaskState.FAILED
        extra: dict[str, Any] = {"last_error": error[:500]}
        try:
            self._call("jupiterFinish", [task_id, self._worker, state, extra])
        except RemoteError:
            return TaskState.FAILED
        return state
