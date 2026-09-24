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

        def fake_run_once(queue, profile_factory, factory, wid, site_gate=None):
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
            "EXPO_PUBLIC_APP_SECRET": "test-app-secret",
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

    def test_public_worker_cannot_enable_submissions_with_env_flag(self):
        import run_worker
        import worker as worker_mod

        original_run_once = worker_mod.run_once
        original_env = {key: os.environ.get(key) for key in (
            "JOBTOO_URL", "JOBTOO_ADMIN_TOKEN", "EXPO_PUBLIC_APP_SECRET",
            "JUPITER_DRY_RUN", "JUPITER_POLL_INTERVAL",
        )}

        def fake_run_once(queue, profile_factory, agent_factory, wid, site_gate=None):
            task = ApplicationTask(id="t1", candidate_id="u1", vacancy_url="https://example.com/job")
            self.assertTrue(agent_factory(task).dry_run)
            self.assertEqual(queue._app_secret, "test-app-secret")
            run_worker._stop = True
            return None

        worker_mod.run_once = fake_run_once
        os.environ.update({
            "JOBTOO_URL": "https://example.com", "JOBTOO_ADMIN_TOKEN": "token",
            "EXPO_PUBLIC_APP_SECRET": "test-app-secret",
            "JUPITER_DRY_RUN": "false", "JUPITER_POLL_INTERVAL": "0",
        })
        run_worker._stop = False
        try:
            self.assertEqual(run_worker.main(), 0)
        finally:
            worker_mod.run_once = original_run_once
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_only_authorized_task_runs_in_live_mode(self):
        from run_worker import main
        import run_worker
        import worker as worker_mod

        old_run = worker_mod.run_once
        old_stop = run_worker._stop
        keys = ("JOBTOO_URL", "JOBTOO_ADMIN_TOKEN", "EXPO_PUBLIC_APP_SECRET", "JUPITER_POLL_INTERVAL")
        old_env = {key: os.environ.get(key) for key in keys}
        def check(queue, profile_factory, factory, wid, site_gate=None):
            # Боевой воркер обязан ограничивать сайты реестром site_compat.
            from site_compat import live_ready
            self.assertIs(site_gate, live_ready)
            old = ApplicationTask(id="old", candidate_id="u", vacancy_url="https://example.com/job")
            fresh = ApplicationTask(id="new", candidate_id="u", vacancy_url="https://example.com/job",
                                    submission_authorized_at="2026-09-24T11:00:00Z")
            self.assertTrue(factory(old).dry_run)
            self.assertFalse(factory(fresh).dry_run)
            run_worker._stop = True
            return None
        try:
            os.environ.update({"JOBTOO_URL": "https://example.com", "JOBTOO_ADMIN_TOKEN": "tok",
                               "EXPO_PUBLIC_APP_SECRET": "app", "JUPITER_POLL_INTERVAL": "0"})
            worker_mod.run_once = check
            run_worker._stop = False
            self.assertEqual(main(), 0)
        finally:
            worker_mod.run_once = old_run
            run_worker._stop = old_stop
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


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

    def test_failure_after_form_request_never_retries(self):
        import worker as worker_mod
        from agent import AgentResult, Reason

        task = ApplicationTask(id="attempted", candidate_id="u1", vacancy_url="https://example.com/job")
        queue = FakeQueue([task])

        class FailedAfterPost:
            dry_run = False
            def run(self, url, profile):
                self.before_submit(url, False)
                return AgentResult("failed", "HTTP failed", reason_code=Reason.SUBMIT_FAILED)

        _task, state = worker_mod.run_once(queue, CandidateProfile({"first_name": "Иван"}),
                                           lambda _: FailedAfterPost())
        self.assertEqual(state, TaskState.SUBMISSION_UNKNOWN)
        self.assertEqual(queue.finished, [(task.id, TaskState.SUBMISSION_UNKNOWN)])

    def test_live_task_on_unverified_site_is_parked_without_agent(self):
        import worker as worker_mod

        task = ApplicationTask(id="live", candidate_id="u1", vacancy_url="https://unknown.example/job",
                               submission_authorized_at="2026-09-24T11:00:00Z")
        queue = FakeQueue([task])
        touched: list[str] = []

        def profile(_task):
            touched.append("profile")
            return CandidateProfile({"first_name": "Иван"})

        def factory(_task):
            touched.append("agent")
            raise AssertionError("агент не должен открывать непроверенный сайт")

        _task, state = worker_mod.run_once(queue, profile, factory, "w1", site_gate=lambda url: False)
        self.assertEqual(state, TaskState.ACTION_REQUIRED)
        self.assertEqual(queue.finished, [(task.id, TaskState.ACTION_REQUIRED)])
        self.assertEqual(touched, [])

    def test_dry_run_task_is_not_gated_by_site(self):
        import worker as worker_mod
        from agent import AgentResult

        task = ApplicationTask(id="dry", candidate_id="u1", vacancy_url="https://unknown.example/job")
        queue = FakeQueue([task])

        class DryAgent:
            dry_run = True
            def run(self, url, profile):
                return AgentResult("ready_to_submit")

        _task, state = worker_mod.run_once(queue, CandidateProfile({"first_name": "Иван"}),
                                           lambda _t: DryAgent(), "w1", site_gate=lambda url: False)
        self.assertEqual(state, TaskState.READY_TO_SUBMIT)

    def test_profile_failure_releases_task_as_failed(self):
        import worker as worker_mod

        task = ApplicationTask(id="t-profile", candidate_id="u1", vacancy_url="https://example.com/job")
        queue = FakeQueue([task])

        def missing_profile(_task):
            raise ValueError("profile unavailable")

        result = worker_mod.run_once(queue, missing_profile, lambda _task: None, "w1")
        self.assertEqual(result[1], TaskState.FAILED)
        self.assertEqual(queue.finished, [(task.id, TaskState.FAILED)])

    def test_long_running_agent_renews_lease(self):
        import threading
        import worker as worker_mod
        from agent import AgentResult

        task = ApplicationTask(id="t-long", candidate_id="u1", vacancy_url="https://example.com/job")

        class HeartbeatQueue(FakeQueue):
            heartbeat_interval = 0.01

            def __init__(self):
                super().__init__([task])
                self.beat = threading.Event()

            def heartbeat(self, task_id):
                self.assert_task_id = task_id
                self.beat.set()
                return True

        queue = HeartbeatQueue()

        class SlowAgent:
            def run(self, url, prof):
                self_test.assertTrue(queue.beat.wait(0.5))
                return AgentResult(status="ready_to_submit")

        self_test = self
        result = worker_mod.run_once(queue, CandidateProfile(values={}), lambda _task: SlowAgent(), "w1")
        self.assertEqual(queue.assert_task_id, task.id)
        self.assertEqual(result[1], TaskState.READY_TO_SUBMIT)


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
            "resume_url": "https://example.com/resume.pdf",
        }

        q._call = lambda fn, args: server_response
        q._download_resume = lambda url: "/tmp/test-resume.pdf" if url == server_response["resume_url"] else None

        profile = q.fetch_profile("u1")
        self.assertEqual(profile.values["first_name"], "Мария")
        self.assertEqual(profile.values["last_name"], "Петрова")
        self.assertEqual(profile.values["patronymic"], "Ивановна")
        self.assertEqual(profile.values["birth_date"], "1998-03-15")
        self.assertEqual(profile.values["city"], "Москва")
        self.assertEqual(profile.values["desired_role"], "Менеджер")
        self.assertEqual(profile.values["experience"], "3 года")
        self.assertNotIn("consent", profile.values)
        self.assertEqual(profile.resume_path, "/tmp/test-resume.pdf")

    def test_maps_real_schema_field_names(self):
        # Имена как в базе: PersonalDetails.middleName, ResumeProfile.desiredPosition.
        from remote_tasks import RemoteTaskQueue

        q = RemoteTaskQueue.__new__(RemoteTaskQueue)
        q._call = lambda fn, args: {
            "first_name": "Мария", "last_name": "Петрова", "phone": "+79001234567",
            "personal_data": {"middleName": "Ивановна", "location": "Химки"},
            "resume_data": {"desiredPosition": "Кассир", "employmentType": "Полная",
                            "city": "Москва", "citizenship": "Россия"},
            "resume_url": "https://example.com/r.pdf",
        }
        q._download_resume = lambda url: "/tmp/r.pdf"
        values = q.fetch_profile("u1").values
        self.assertEqual(values["patronymic"], "Ивановна")
        self.assertEqual(values["desired_role"], "Кассир")
        self.assertEqual(values["employment"], "Полная")
        self.assertEqual(values["city"], "Москва")  # город из резюме важнее «где живу»
        self.assertEqual(values["citizenship"], "Россия")

    def test_missing_resume_blocks_profile(self):
        from remote_tasks import RemoteError, RemoteTaskQueue

        q = RemoteTaskQueue.__new__(RemoteTaskQueue)
        q._call = lambda fn, args: {"first_name": "Мария", "resume_url": None}
        with self.assertRaises(RemoteError) as raised:
            q.fetch_profile("u1")
        self.assertEqual(raised.exception.status, 503)

    def test_empty_candidate_id_raises(self):
        from remote_tasks import RemoteTaskQueue

        q = RemoteTaskQueue.__new__(RemoteTaskQueue)
        q._url = "http://test"
        q._token = "tok"

        with self.assertRaises(ValueError):
            q.fetch_profile("")
        with self.assertRaises(ValueError):
            q.fetch_profile("   ")


class TestResumeCleanup(unittest.TestCase):
    """Проверяем, что временный PDF удаляется после прогона."""

    def test_temp_resume_deleted_after_run(self):
        import tempfile
        import worker as worker_mod

        fd, path = tempfile.mkstemp(suffix=".pdf", prefix="jupiter_resume_")
        os.write(fd, b"%PDF-fake")
        os.close(fd)
        self.assertTrue(os.path.isfile(path))

        task = ApplicationTask(
            id="t-cleanup", candidate_id="user-99",
            vacancy_url="https://example.com/job",
            state=TaskState.QUEUED,
        )
        queue = FakeQueue([task])
        profile = CandidateProfile(
            values={"first_name": "Тест"},
            resume_path=path,
        )

        class FakeAgent:
            def run(self, url, prof):
                from agent import AgentResult
                return AgentResult(status="submitted")

        result = worker_mod.run_once(
            queue, profile,
            lambda t: FakeAgent(), "w1",
        )
        self.assertIsNotNone(result)
        self.assertFalse(os.path.isfile(path))

    def test_non_temp_resume_not_deleted(self):
        import tempfile
        import worker as worker_mod

        fd, path = tempfile.mkstemp(suffix=".pdf", prefix="user_own_")
        os.write(fd, b"%PDF-fake")
        os.close(fd)

        task = ApplicationTask(
            id="t-keep", candidate_id="user-99",
            vacancy_url="https://example.com/job",
            state=TaskState.QUEUED,
        )
        queue = FakeQueue([task])
        profile = CandidateProfile(
            values={"first_name": "Тест"},
            resume_path=path,
        )

        class FakeAgent:
            def run(self, url, prof):
                from agent import AgentResult
                return AgentResult(status="submitted")

        worker_mod.run_once(queue, profile, lambda t: FakeAgent(), "w1")
        self.assertTrue(os.path.isfile(path))
        os.unlink(path)


if __name__ == "__main__":
    unittest.main()
