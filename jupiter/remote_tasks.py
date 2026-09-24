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
from datetime import datetime, timedelta, timezone
import urllib.request
import urllib.error
from typing import Any

from agent import CandidateProfile
from tasks import ApplicationTask, TaskState, BACKOFF_BASE_SECONDS, MAX_ATTEMPTS, SubmissionAuthorizationRevoked

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
        app_secret: str,
        *,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ):
        self._url = base_url.rstrip("/") + "/api/db.php"
        self._token = admin_token
        self._app_secret = app_secret
        self._lease_seconds = lease_seconds
        self.heartbeat_interval = max(5, min(60, lease_seconds // 3))
        self._worker: str | None = None
        self._attempts: dict[str, int] = {}

    def _call(self, fn: str, args: list[Any]) -> Any:
        body = json.dumps({"fn": fn, "args": args}).encode()
        req = urllib.request.Request(
            self._url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Admin-Token": self._token,
                "X-App-Secret": self._app_secret,
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
            submission_authorized_at=row.get("submission_authorized_at"),
            third_party_consent_at=row.get("third_party_consent_at"),
            third_party_terms_url=row.get("third_party_terms_url"),
        )

    # ── публичный интерфейс ────────────────────────────────────────────────

    def lease(self, worker: str) -> ApplicationTask | None:
        self._worker = worker
        result = self._call("jupiterLease", [worker, self._lease_seconds])
        if result is None:
            return None
        # PostgreSQL functions returning a composite row can be serialized by
        # PostgREST as an object whose every field is null when the function
        # returns NULL. Treat that shape as an empty queue instead of inventing
        # a task with id == "None".
        if not isinstance(result, dict) or result.get("id") in (None, ""):
            return None
        task = self._row_to_task(result)
        self._attempts[task.id] = task.attempt_count
        return task

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

    def authorize_submit(self, task_id: str) -> None:
        if self._worker is None:
            raise RuntimeError("No worker lease for submission")
        try:
            result = self._call("jupiterSubmitGuard", [task_id, self._worker])
        except RemoteError as exc:
            if exc.status == 409:
                raise SubmissionAuthorizationRevoked("Candidate disabled live submissions") from None
            raise
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeError("Submission authorization could not be verified")

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
        attempt = self._attempts.get(task_id, MAX_ATTEMPTS)
        state = TaskState.RETRYABLE_FAILED if retryable and attempt < MAX_ATTEMPTS else TaskState.FAILED
        extra: dict[str, Any] = {"last_error": error[:500]}
        if state == TaskState.RETRYABLE_FAILED:
            extra["not_before"] = (
                datetime.now(timezone.utc)
                + timedelta(seconds=BACKOFF_BASE_SECONDS * attempt ** 2)
            ).isoformat()
        try:
            self._call("jupiterFinish", [task_id, self._worker, state, extra])
        except RemoteError:
            return TaskState.FAILED
        return state

    # ── профиль кандидата ──────────────────────────────────────────────────

    def fetch_profile(self, user_id: str) -> CandidateProfile:
        """Собрать профиль кандидата из данных в базе."""
        if not user_id or not user_id.strip():
            raise ValueError("candidate_id пуст — задача без привязки к пользователю")
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
        # JobToo's own consent does not accept a third party's legal terms.
        for key in ("consent", "personal_data_consent", "privacy_consent", "terms_consent"):
            values.pop(key, None)
        resume_path = self._download_resume(raw.get("resume_url"))
        if not resume_path:
            raise RemoteError(503, "Selected resume PDF is unavailable")
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
