#!/usr/bin/env python3
"""Мост между очередью в базе и воркером Jupiter.

Клиент кладёт задачу свайпом (jupiterEnqueue → jm_jupiter_applications).
Воркер берёт её через этот класс: те же lease/heartbeat/checkpoint/finish,
что у локальной TaskQueue, но за каждым вызовом — HTTP-запрос к db.php.

Только stdlib: у Jupiter нет и не будет внешних зависимостей.
"""
from __future__ import annotations

import json
import os
import tempfile
import urllib.request
import urllib.error
from typing import Any

from agent import CandidateProfile
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

    # ── профиль кандидата ──────────────────────────────────────────────────

    def fetch_profile(self, user_id: str) -> CandidateProfile:
        """Собрать профиль кандидата из данных в базе."""
        raw = self._call("jupiterGetCandidateProfile", [user_id])
        if not isinstance(raw, dict) or raw.get("error"):
            raise RemoteError(0, raw.get("error", "empty profile") if isinstance(raw, dict) else "bad response")
        values: dict[str, Any] = {}
        for key in ("first_name", "last_name", "phone", "email", "age"):
            if raw.get(key) not in (None, ""):
                values[key] = raw[key]
        pd = raw.get("personal_data")
        if isinstance(pd, dict):
            for key in ("patronymic", "birth_date", "citizenship", "city",
                        "desired_role", "employment", "cover_letter",
                        "work_authorization"):
                if pd.get(key) not in (None, ""):
                    values[key] = pd[key]
            if pd.get("consent"):
                values["consent"] = pd["consent"]
        rd = raw.get("resume_data")
        if isinstance(rd, dict):
            for key, val in rd.items():
                if key not in values and val not in (None, ""):
                    values[key] = val
        resume_path = self._download_resume(raw.get("resume_url"))
        return CandidateProfile(values=values, resume_path=resume_path)

    @staticmethod
    def _download_resume(url: str | None) -> str | None:
        if not url:
            return None
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if not data or data[:4] != b"%PDF":
                return None
            fd, path = tempfile.mkstemp(suffix=".pdf", prefix="jupiter_resume_")
            os.write(fd, data)
            os.close(fd)
            return path
        except Exception:
            return None
