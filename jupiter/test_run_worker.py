#!/usr/bin/env python3
"""Тесты точки входа run_worker."""
from __future__ import annotations

import os
import signal
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from tasks import ApplicationTask, TaskState


class FakeQueue:
    def __init__(self, tasks: list[ApplicationTask] | None = None):
        self.tasks = list(tasks or [])
        self.leased: list[str] = []
        self.finished: list[tuple[str, str]] = []
        self.checkpoints: list[tuple[str, str, dict]] = []
        self._worker: str | None = None

    def lease(self, worker: str) -> ApplicationTask | None:
        self._worker = worker
        if not self.tasks:
            return None
        task = self.tasks.pop(0)
        task.lease_owner = worker
        self.leased.append(task.id)
        return task

    def checkpoint(self, task_id: str, state: str, data: dict) -> None:
        self.checkpoints.append((task_id, state, data))

    def finish(self, task_id: str, state: str, **kwargs) -> None:
        self.finished.append((task_id, state))

    def fail(self, task_id: str, error: str, *, retryable: bool = True) -> str:
        state = TaskState.RETRYABLE_FAILED if retryable else TaskState.FAILED
        self.finished.append((task_id, state))
        return state


class TestRequireEnv(unittest.TestCase):
    def test_missing_env_exits(self):
        from run_worker import _require_env
        os.environ.pop("__TEST_MISSING__", None)
        with self.assertRaises(SystemExit):
            _require_env("__TEST_MISSING__")

    def test_present_env(self):
        from run_worker import _require_env
        os.environ["__TEST_PRESENT__"] = "value"
        try:
            self.assertEqual(_require_env("__TEST_PRESENT__"), "value")
        finally:
            del os.environ["__TEST_PRESENT__"]

    def test_blank_env_exits(self):
        from run_worker import _require_env
        os.environ["__TEST_BLANK__"] = "   "
        try:
            with self.assertRaises(SystemExit):
                _require_env("__TEST_BLANK__")
        finally:
            del os.environ["__TEST_BLANK__"]


class TestSignalHandler(unittest.TestCase):
    def test_sets_stop_flag(self):
        import run_worker
        run_worker._stop = False
        run_worker._on_signal(signal.SIGTERM, None)
        self.assertTrue(run_worker._stop)
        run_worker._stop = False


class TestWorkerLoop(unittest.TestCase):
    """Проверяем, что цикл main() можно прервать и что он вызывает run_once."""

    def test_empty_queue_stops_on_signal(self):
        import run_worker
        import worker as worker_mod

        calls = []
        original_run_once = worker_mod.run_once

        def fake_run_once(queue, profile, factory, wid):
            calls.append(wid)
            run_worker._stop = True
            return None

        worker_mod.run_once = fake_run_once
        run_worker._stop = False

        env = {
            "JOBTOO_URL": "https://example.com",
            "JOBTOO_ADMIN_TOKEN": "tok",
            "JUPITER_PROFILE": os.path.join(
                os.path.dirname(__file__), "test_fixtures", "empty_profile.json"
            ),
            "JUPITER_POLL_INTERVAL": "0",
            "JUPITER_WORKER_ID": "test-w",
        }
        old = {}
        for k, v in env.items():
            old[k] = os.environ.get(k)
            os.environ[k] = v

        fixture_dir = os.path.join(os.path.dirname(__file__), "test_fixtures")
        os.makedirs(fixture_dir, exist_ok=True)
        profile_file = os.path.join(fixture_dir, "empty_profile.json")
        if not os.path.exists(profile_file):
            import json
            with open(profile_file, "w") as f:
                json.dump({"name": "Тест"}, f)

        try:
            code = run_worker.main()
            self.assertEqual(code, 0)
            self.assertEqual(calls, ["test-w"])
        finally:
            worker_mod.run_once = original_run_once
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
