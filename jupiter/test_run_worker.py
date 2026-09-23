#!/usr/bin/env python3
"""Тесты точки входа run_worker."""
from __future__ import annotations

import os
import signal
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from agent import CandidateProfile
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

        def fake_run_once(queue, profile_factory, factory, wid):
            calls.append(wid)
            run_worker._stop = True
            return None

        worker_mod.run_once = fake_run_once
        run_worker._stop = False

        env = {
            "JOBTOO_URL": "https://example.com",
            "JOBTOO_ADMIN_TOKEN": "tok",
            "JUPITER_POLL_INTERVAL": "0",
            "JUPITER_WORKER_ID": "test-w",
        }
        old = {}
        for k, v in env.items():
            old[k] = os.environ.get(k)
            os.environ[k] = v

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


class TestProfileFactory(unittest.TestCase):
    """Проверяем, что worker.run_once вызывает фабрику профиля с задачей."""

    def test_profile_factory_called_with_task(self):
        import worker as worker_mod

        task = ApplicationTask(
            id="t1", candidate_id="user-42", vacancy_url="https://example.com/job",
            state=TaskState.QUEUED,
        )
        queue = FakeQueue([task])
        profile = CandidateProfile(values={"first_name": "Иван"})

        factory_calls: list[str] = []

        def profile_factory(t: ApplicationTask) -> CandidateProfile:
            factory_calls.append(t.candidate_id)
            return profile

        class FakeAgent:
            def run(self, url, prof):
                from agent import AgentResult
                return AgentResult(status="submitted")

        def agent_factory(t):
            return FakeAgent()

        result = worker_mod.run_once(queue, profile_factory, agent_factory, "w1")
        self.assertIsNotNone(result)
        self.assertEqual(factory_calls, ["user-42"])
        self.assertEqual(result[1], TaskState.SUBMITTED)


class TestFetchProfileBuildsValues(unittest.TestCase):
    """Проверяем сборку CandidateProfile из серверного ответа."""

    def test_builds_from_server_response(self):
        from remote_tasks import RemoteTaskQueue

        q = RemoteTaskQueue.__new__(RemoteTaskQueue)
        q._url = "http://test"
        q._token = "tok"

        server_response = {
            "user_id": "u1",
            "first_name": "Мария",
            "last_name": "Петрова",
            "age": 28,
            "phone": "+79001234567",
            "email": "m@example.com",
            "personal_data": {
                "patronymic": "Ивановна",
                "birth_date": "1998-03-15",
                "city": "Москва",
                "consent": True,
            },
            "resume_data": {
                "desired_role": "Менеджер",
                "experience": "3 года",
            },
            "resume_url": None,
        }

        original_call = getattr(q, '_call', None)
        q._call = lambda fn, args: server_response

        profile = q.fetch_profile("u1")
        self.assertEqual(profile.values["first_name"], "Мария")
        self.assertEqual(profile.values["last_name"], "Петрова")
        self.assertEqual(profile.values["patronymic"], "Ивановна")
        self.assertEqual(profile.values["birth_date"], "1998-03-15")
        self.assertEqual(profile.values["city"], "Москва")
        self.assertEqual(profile.values["desired_role"], "Менеджер")
        self.assertEqual(profile.values["experience"], "3 года")
        self.assertEqual(profile.values["consent"], True)
        self.assertIsNone(profile.resume_path)


if __name__ == "__main__":
    unittest.main()
