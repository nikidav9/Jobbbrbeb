#!/usr/bin/env python3
"""RemoteTaskQueue — без настоящего сервера, с заглушкой db.php."""
from __future__ import annotations

import json
import threading
import time
import unittest
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from remote_tasks import RemoteError, RemoteTaskQueue
from tasks import TaskState, SubmissionAuthorizationRevoked

ADMIN_TOKEN = "test-admin-token"
APP_SECRET = "test-app-secret"


class FakeTask:
    def __init__(self, task_id: str, url: str, user_id: str = "u1"):
        self.data: dict[str, Any] = {
            "id": task_id,
            "user_id": user_id,
            "vacancy_url": url,
            "canonical_url": url,
            "state": "queued",
            "attempt_count": 0,
            "lease_owner": None,
            "lease_until": None,
            "heartbeat_at": None,
            "checkpoint": None,
            "reason_code": None,
            "last_error": None,
            "resume_token": None,
            "receipt_key": None,
            "submission_authorized_at": None,
            "not_before": None,
        }


class FakeDbHandler(BaseHTTPRequestHandler):
    tasks: dict[str, FakeTask] = {}
    calls: list[tuple[str, list[Any]]] = []

    def log_message(self, *_args: Any) -> None:
        pass

    def do_POST(self) -> None:
        if self.headers.get("X-App-Secret") != APP_SECRET:
            self._json({"error": "Forbidden"}, 403)
            return
        token = self.headers.get("X-Admin-Token", "")
        if token != ADMIN_TOKEN:
            self._json({"error": "Admin authorization required"}, 403)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        fn = body.get("fn", "")
        args = body.get("args", [])
        FakeDbHandler.calls.append((fn, args))

        if fn == "jupiterLease":
            self._handle_lease(args)
        elif fn == "jupiterHeartbeat":
            self._handle_heartbeat(args)
        elif fn == "jupiterCheckpoint":
            self._handle_checkpoint(args)
        elif fn == "jupiterFinish":
            self._handle_finish(args)
        elif fn == "jupiterSubmitGuard":
            tid, worker = args
            task = FakeDbHandler.tasks.get(tid)
            allowed = (task is not None and task.data["lease_owner"] == worker
                       and bool(task.data["submission_authorized_at"]))
            self._json({"ok": True} if allowed else {"error": "Submission is not authorized"},
                       200 if allowed else 409)
        else:
            self._json({"error": f"Unknown fn: {fn}"}, 400)

    def _handle_lease(self, args: list[Any]) -> None:
        worker = str(args[0]) if args else ""
        lease_seconds = int(args[1]) if len(args) > 1 else 300
        for task in FakeDbHandler.tasks.values():
            d = task.data
            if d["state"] in ("queued", "retryable_failed") and d["lease_owner"] is None:
                d["lease_owner"] = worker
                d["lease_until"] = time.time() + lease_seconds
                d["heartbeat_at"] = time.time()
                d["attempt_count"] += 1
                d["state"] = "opening_site"
                self._json(d)
                return
        self._json(None)

    def _handle_heartbeat(self, args: list[Any]) -> None:
        task_id = str(args[0]) if args else ""
        worker = str(args[1]) if len(args) > 1 else ""
        task = FakeDbHandler.tasks.get(task_id)
        if not task or task.data["lease_owner"] != worker:
            self._json({"error": "Lease is held by another worker"}, 409)
            return
        task.data["heartbeat_at"] = time.time()
        self._json({"ok": True})

    def _handle_checkpoint(self, args: list[Any]) -> None:
        task_id = str(args[0]) if args else ""
        worker = str(args[1]) if len(args) > 1 else ""
        state = str(args[2]) if len(args) > 2 else ""
        data = args[3] if len(args) > 3 else {}
        task = FakeDbHandler.tasks.get(task_id)
        if not task or task.data["lease_owner"] != worker:
            self._json({"error": "Lease is held by another worker"}, 409)
            return
        task.data["state"] = state
        task.data["checkpoint"] = data
        self._json({"ok": True})

    def _handle_finish(self, args: list[Any]) -> None:
        task_id = str(args[0]) if args else ""
        worker = str(args[1]) if len(args) > 1 else ""
        state = str(args[2]) if len(args) > 2 else ""
        extra = args[3] if len(args) > 3 else {}
        task = FakeDbHandler.tasks.get(task_id)
        if not task or task.data["lease_owner"] != worker:
            self._json({"error": "Lease is held by another worker"}, 409)
            return
        task.data["state"] = state
        task.data["lease_owner"] = None
        task.data["lease_until"] = None
        for key in ("reason_code", "resume_token", "receipt_key", "last_error",
                     "checkpoint", "attempt_count", "not_before"):
            if key in extra:
                task.data[key] = extra[key]
        self._json({"ok": True})

    def _json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class RemoteTaskQueueTest(unittest.TestCase):
    server: HTTPServer
    thread: threading.Thread
    port: int

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), FakeDbHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def setUp(self) -> None:
        FakeDbHandler.tasks.clear()
        FakeDbHandler.calls.clear()

    def _queue(self, **kw: Any) -> RemoteTaskQueue:
        return RemoteTaskQueue(
            f"http://127.0.0.1:{self.port}",
            ADMIN_TOKEN,
            APP_SECRET,
            **kw,
        )

    def _seed(self, url: str = "https://e.ru/v/1") -> str:
        tid = uuid.uuid4().hex
        FakeDbHandler.tasks[tid] = FakeTask(tid, url)
        return tid

    # ── lease ───────────────────────────────────────────────────────────────

    def test_lease_returns_task_when_one_is_queued(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        self.assertIsNotNone(task)
        self.assertEqual(task.id, tid)
        self.assertEqual(task.vacancy_url, "https://e.ru/v/1")

    def test_lease_returns_none_when_queue_is_empty(self) -> None:
        q = self._queue()
        self.assertIsNone(q.lease("w1"))

    def test_lease_treats_null_composite_as_empty_queue(self) -> None:
        q = self._queue()
        original = q._call
        q._call = lambda fn, args: {"id": None, "user_id": None, "vacancy_url": None}
        try:
            self.assertIsNone(q.lease("w1"))
        finally:
            q._call = original

    # ── heartbeat ──────────────────────────────────────────────────────────

    def test_heartbeat_succeeds_for_lease_holder(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        self.assertTrue(q.heartbeat(task.id))

    def test_heartbeat_fails_for_wrong_worker(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        q2 = self._queue()
        q2._worker = "w2"
        self.assertFalse(q2.heartbeat(task.id))

    def test_submit_guard_rejects_legacy_task_and_accepts_opted_in_task(self) -> None:
        tid = self._seed()
        q = self._queue()
        q.lease("w1")
        with self.assertRaises(SubmissionAuthorizationRevoked):
            q.authorize_submit(tid)
        FakeDbHandler.tasks[tid].data["submission_authorized_at"] = "2026-09-24T11:00:00Z"
        q.authorize_submit(tid)

    # ── checkpoint ─────────────────────────────────────────────────────────

    def test_checkpoint_updates_state_and_keeps_lease(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        q.checkpoint(task.id, TaskState.FILLING, {"url": "https://e.ru/apply"})
        ft = FakeDbHandler.tasks[tid]
        self.assertEqual(ft.data["state"], TaskState.FILLING)
        self.assertEqual(ft.data["checkpoint"], {"url": "https://e.ru/apply"})
        self.assertIsNotNone(ft.data["lease_owner"])

    # ── finish ─────────────────────────────────────────────────────────────

    def test_finish_sets_terminal_state_and_releases_lease(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        q.finish(task.id, TaskState.SUBMITTED, receipt_key="k1")
        ft = FakeDbHandler.tasks[tid]
        self.assertEqual(ft.data["state"], TaskState.SUBMITTED)
        self.assertIsNone(ft.data["lease_owner"])
        self.assertEqual(ft.data["receipt_key"], "k1")
        finish_call = FakeDbHandler.calls[-1]
        self.assertEqual(finish_call[0], "jupiterFinish")
        self.assertTrue(finish_call[1][3]["verified"])

    def test_finish_passes_fill_summary_as_checkpoint(self) -> None:
        self._seed()
        q = self._queue()
        task = q.lease("w1")
        summary = {"fields": 3, "keys": ["first_name", "phone"], "resume": True}
        q.finish(task.id, TaskState.SUBMITTED, summary=summary)
        extra = FakeDbHandler.calls[-1][1][3]
        self.assertEqual(extra["checkpoint"], {"summary": summary})

    def test_finish_with_action_required_stores_resume_token(self) -> None:
        tid = self._seed()
        q = self._queue()
        task = q.lease("w1")
        q.finish(
            task.id, TaskState.ACTION_REQUIRED,
            reason_code="CAPTCHA_REQUIRED", resume_token="tok",
        )
        ft = FakeDbHandler.tasks[tid]
        self.assertEqual(ft.data["state"], TaskState.ACTION_REQUIRED)
        self.assertEqual(ft.data["resume_token"], "tok")
        self.assertEqual(ft.data["reason_code"], "CAPTCHA_REQUIRED")

    # ── fail ───────────────────────────────────────────────────────────────

    def test_fail_retryable_sets_retryable_state(self) -> None:
        tid = self._seed()
        q = self._queue()
        q.lease("w1")
        state = q.fail(tid, "timeout", retryable=True)
        self.assertEqual(state, TaskState.RETRYABLE_FAILED)
        due = datetime.fromisoformat(FakeDbHandler.tasks[tid].data["not_before"])
        self.assertGreater(due, datetime.now(timezone.utc))

    def test_retry_limit_stops_after_third_failure(self) -> None:
        tid = self._seed()
        q = self._queue()
        q.lease("w1")
        q._attempts[tid] = 3
        self.assertEqual(q.fail(tid, "timeout", retryable=True), TaskState.FAILED)

    def test_fail_non_retryable_sets_failed(self) -> None:
        tid = self._seed()
        q = self._queue()
        q.lease("w1")
        state = q.fail(tid, "vacancy closed", retryable=False)
        self.assertEqual(state, TaskState.FAILED)

    # ── auth ───────────────────────────────────────────────────────────────

    def test_wrong_token_raises_remote_error(self) -> None:
        self._seed()
        q = RemoteTaskQueue(
            f"http://127.0.0.1:{self.port}", "wrong-token", APP_SECRET,
        )
        with self.assertRaises(RemoteError) as ctx:
            q.lease("w1")
        self.assertEqual(ctx.exception.status, 403)

    def test_missing_app_secret_is_rejected_before_lease(self) -> None:
        self._seed()
        q = RemoteTaskQueue(f"http://127.0.0.1:{self.port}", ADMIN_TOKEN, "")
        with self.assertRaises(RemoteError) as ctx:
            q.lease("w1")
        self.assertEqual(ctx.exception.status, 403)

    # ── worker.py integration ──────────────────────────────────────────────

    def test_rpc_calls_match_server_protocol(self) -> None:
        self._seed()
        q = self._queue()
        task = q.lease("w1")
        q.heartbeat(task.id)
        q.checkpoint(task.id, "filling", {"step": 2})
        q.finish(task.id, "submitted")
        fns = [c[0] for c in FakeDbHandler.calls]
        self.assertEqual(fns, [
            "jupiterLease", "jupiterHeartbeat",
            "jupiterCheckpoint", "jupiterFinish",
        ])


if __name__ == "__main__":
    unittest.main(verbosity=2)
