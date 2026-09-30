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


class TestEngineChoice(unittest.TestCase):
    """JUPITER_ENGINE: http по умолчанию, browser — с закрытием после задачи."""

    KEYS = ("JOBTOO_URL", "JOBTOO_ADMIN_TOKEN", "EXPO_PUBLIC_APP_SECRET",
            "JUPITER_POLL_INTERVAL", "JUPITER_ENGINE", "JUPITER_CHROMIUM")

    def setUp(self):
        import run_worker
        import worker as worker_mod
        self.rw = run_worker
        self.wm = worker_mod
        self.old_run = worker_mod.run_once
        self.old_env = {k: os.environ.get(k) for k in self.KEYS}
        self.old_pw = run_worker.browser_engine.sync_playwright
        self.old_cls = run_worker.browser_engine.JupiterBrowserEngine
        # Не зависеть от памяти машины и не искать настоящие Chromium.
        self.old_mem = run_worker._memory_allows_browser
        self.old_kill = run_worker.browser_limits.kill_stray_chromium
        run_worker._memory_allows_browser = lambda: True
        run_worker.browser_limits.kill_stray_chromium = lambda *a, **k: []
        os.environ.update({"JOBTOO_URL": "https://example.com", "JOBTOO_ADMIN_TOKEN": "tok",
                           "EXPO_PUBLIC_APP_SECRET": "app", "JUPITER_POLL_INTERVAL": "0"})
        os.environ.pop("JUPITER_ENGINE", None)
        os.environ.pop("JUPITER_CHROMIUM", None)
        run_worker._stop = False

    def tearDown(self):
        self.wm.run_once = self.old_run
        self.rw.browser_engine.sync_playwright = self.old_pw
        self.rw.browser_engine.JupiterBrowserEngine = self.old_cls
        self.rw._memory_allows_browser = self.old_mem
        self.rw.browser_limits.kill_stray_chromium = self.old_kill
        self.rw._stop = False
        for k, v in self.old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_http_is_default_and_creates_no_browser(self):
        from engine import JupiterWebEngine

        def boom(*a, **k):
            raise AssertionError("браузер не нужен в режиме http")
        self.rw.browser_engine.JupiterBrowserEngine = boom
        agents = []

        def fake_run_once(queue, pf, factory, wid, site_gate=None):
            agents.append(factory(ApplicationTask(id="t", candidate_id="u",
                                                  vacancy_url="https://example.com/j")))
            self.rw._stop = True
            return None
        self.wm.run_once = fake_run_once
        self.assertEqual(self.rw.main(), 0)
        self.assertIsInstance(agents[0].engine, JupiterWebEngine)

    def test_browser_engine_created_and_closed_after_task(self):
        created = []

        class FakeEngine:
            def __init__(self, allowed_hosts, *, read_only=False, executable_path=None, **kw):
                self.allowed_hosts = set(allowed_hosts)
                self.read_only = read_only
                self.executable_path = executable_path
                self.closed = False
                created.append(self)

            def close(self):
                self.closed = True

        self.rw.browser_engine.sync_playwright = object()
        self.rw.browser_engine.JupiterBrowserEngine = FakeEngine
        os.environ["JUPITER_ENGINE"] = "browser"
        os.environ["JUPITER_CHROMIUM"] = "/usr/bin/chromium"
        seen = []

        def fake_run_once(queue, pf, factory, wid, site_gate=None):
            agent = factory(ApplicationTask(id="t", candidate_id="u",
                                            vacancy_url="https://example.com/j"))
            seen.append(agent)
            self.assertFalse(created[0].closed)
            self.rw._stop = True
            raise RuntimeError("падение задачи")  # закрытие и при ошибке
        self.wm.run_once = fake_run_once
        self.assertEqual(self.rw.main(), 0)
        self.assertEqual(len(created), 1)
        self.assertIs(seen[0].engine, created[0])
        self.assertTrue(created[0].read_only)
        self.assertEqual(created[0].executable_path, "/usr/bin/chromium")
        self.assertTrue(created[0].closed)

    def test_browser_without_playwright_fails_at_startup(self):
        self.rw.browser_engine.sync_playwright = None
        os.environ["JUPITER_ENGINE"] = "browser"
        called = []
        self.wm.run_once = lambda *a, **k: called.append(1)
        with self.assertRaises(SystemExit) as raised:
            self.rw.main()
        self.assertIn("Playwright", str(raised.exception))
        self.assertEqual(called, [])

    def test_unknown_engine_exits(self):
        os.environ["JUPITER_ENGINE"] = "selenium"
        with self.assertRaises(SystemExit):
            self.rw.main()


class TestProfileFactory(unittest.TestCase):
    """Проверяем, что worker.run_once вызывает фабрику профиля с задачей."""

    def test_delegated_consents_are_exactly_the_documented_ones(self):
        # Поручение (Соглашение п. 8.3) — только это; ни рекламы, ни резерва,
        # ни третьих лиц, ни трансграничной передачи.
        import run_worker
        self.assertEqual(set(run_worker.DELEGATED_CONSENTS), {
            "personal_data_consent", "privacy_consent", "terms_consent",
            "data_accuracy_confirmation",
        })
        for key in ("marketing_consent", "talent_pool_consent", "third_party_consent",
                    "crossborder_consent", "special_category_consent"):
            self.assertNotIn(key, run_worker.DELEGATED_CONSENTS)

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


class TestFillSummary(unittest.TestCase):
    def test_counts_fields_keys_and_resume_without_values(self) -> None:
        from worker import fill_summary
        summary = fill_summary([
            {"action": "open", "url": "https://e.ru", "engine": "jupiter-browser-engine"},
            {"action": "fill", "field": "name", "key": "first_name", "value": "Иван"},
            {"action": "fill", "field": "tel", "key": "phone", "value": "+7999"},
            {"action": "select", "field": "city", "key": "city", "value": "Москва"},
            {"action": "check", "field": "agree", "key": "personal_data_consent"},
            {"action": "upload", "field": "cv", "source": "resume"},
        ])
        self.assertEqual(summary["fields"], 4)
        self.assertEqual(summary["keys"], ["first_name", "phone", "city", "personal_data_consent"])
        self.assertTrue(summary["resume"])
        self.assertEqual(summary["engine"], "jupiter-browser-engine")
        self.assertNotIn("Иван", str(summary))

    def test_empty_trajectory(self) -> None:
        from worker import fill_summary
        self.assertEqual(fill_summary([]), {"fields": 0, "keys": [], "resume": False, "engine": ""})


class TestBrowserLimitsAndFieldMapper(unittest.TestCase):
    """Сторож и память браузерного режима; YandexGPT как field_mapper."""

    KEYS = ("JOBTOO_URL", "JOBTOO_ADMIN_TOKEN", "EXPO_PUBLIC_APP_SECRET",
            "JUPITER_POLL_INTERVAL", "JUPITER_ENGINE", "JUPITER_CHROMIUM",
            "JUPITER_TASK_TIMEOUT_S", "YANDEX_GPT_API_KEY", "YANDEX_GPT_FOLDER_ID")
    SECRET = "AQVN-secret-key-do-not-log"

    def setUp(self):
        import browser_limits
        import browser_planner
        import run_worker
        import worker as worker_mod
        self.rw, self.wm, self.bl, self.bp = run_worker, worker_mod, browser_limits, browser_planner
        self.saved = [
            (worker_mod, "run_once", worker_mod.run_once),
            (run_worker.browser_engine, "sync_playwright", run_worker.browser_engine.sync_playwright),
            (run_worker.browser_engine, "JupiterBrowserEngine", run_worker.browser_engine.JupiterBrowserEngine),
            (run_worker, "JupiterAgent", run_worker.JupiterAgent),
            (run_worker, "_memory_allows_browser", run_worker._memory_allows_browser),
            (browser_limits, "mark_owner", browser_limits.mark_owner),
            (browser_limits, "watch_engine", browser_limits.watch_engine),
            (browser_limits, "kill_stray_chromium", browser_limits.kill_stray_chromium),
            (browser_planner, "suggest_field_keys", browser_planner.suggest_field_keys),
        ]
        self.old_env = {k: os.environ.get(k) for k in self.KEYS}
        for k in self.KEYS:
            os.environ.pop(k, None)
        os.environ.update({"JOBTOO_URL": "https://example.com", "JOBTOO_ADMIN_TOKEN": "tok",
                           "EXPO_PUBLIC_APP_SECRET": "app", "JUPITER_POLL_INTERVAL": "0"})
        run_worker._stop = False
        self.events: list = []
        browser_limits.mark_owner = lambda: self.events.append("mark_owner")
        browser_limits.kill_stray_chromium = lambda *a, **k: self.events.append("kill_stray") or []
        run_worker._memory_allows_browser = lambda: True

    def tearDown(self):
        for obj, name, value in self.saved:
            setattr(obj, name, value)
        self.rw._stop = False
        for k, v in self.old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _browser_mode(self):
        events = self.events

        class FakeEngine:
            def __init__(self, allowed_hosts, **kw):
                self.allowed_hosts = set(allowed_hosts)
                self.read_only = kw.get("read_only", False)

            def close(self):
                events.append("close")

        self.rw.browser_engine.sync_playwright = object()
        self.rw.browser_engine.JupiterBrowserEngine = FakeEngine
        os.environ["JUPITER_ENGINE"] = "browser"

    def _fake_watchdog(self, fired: bool):
        events = self.events

        class FakeWatchdog:
            def __init__(self, engine, timeout):
                self.fired = fired
                events.append(("watch", engine, timeout))

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                events.append("watch_exit")
        return FakeWatchdog

    def _run_main_with(self, body):
        def fake_run_once(queue, pf, factory, wid, site_gate=None):
            try:
                return body(factory)
            finally:
                self.rw._stop = True
        self.wm.run_once = fake_run_once
        self.assertEqual(self.rw.main(), 0)

    def test_browser_task_runs_under_watchdog_then_close_then_kill(self):
        from agent import AgentResult
        self._browser_mode()
        os.environ["JUPITER_TASK_TIMEOUT_S"] = "90"
        self.bl.watch_engine = self._fake_watchdog(fired=False)
        seen = {}

        def body(factory):
            agent = factory(ApplicationTask(id="t", candidate_id="u", vacancy_url="https://e.ru/j"))
            seen["agent"] = agent
            self.events.append("task")
            return None
        self._run_main_with(body)
        agent = seen["agent"]
        self.assertIn("run", agent.__dict__)
        self.assertIn("resume", agent.__dict__)
        self.assertIn("_run_from_page", agent.__dict__)
        self.assertEqual(self.events[0], "mark_owner")
        self.assertEqual(self.events[-2:], ["close", "kill_stray"])

        # Вызов run идёт под сторожем с таймаутом из env и на этом движке.
        agent.__dict__["run"] = self.rw.JupiterAgent.run.__get__(agent)
        agent._run_from_page = lambda *a: AgentResult("ready_to_submit")
        agent.engine.open = lambda url: type("P", (), {"url": url, "status": 200})()
        self.events.clear()
        self.rw._watch_agent(agent, agent.engine, 90.0)
        self.assertEqual(agent.run("https://e.ru/j", CandidateProfile({})).status, "ready_to_submit")
        watch = [e for e in self.events if isinstance(e, tuple)]
        self.assertEqual(watch, [("watch", agent.engine, 90.0)])  # вложенный вызов — без второго сторожа

    def test_default_timeout_is_240(self):
        self._browser_mode()
        self.bl.watch_engine = self._fake_watchdog(fired=False)

        def body(factory):
            agent = factory(ApplicationTask(id="t", candidate_id="u", vacancy_url="https://e.ru/j"))
            agent.engine.open = lambda url: (_ for _ in ()).throw(RuntimeError("boom"))
            with self.assertRaises(RuntimeError):
                agent.run("https://e.ru/j", CandidateProfile({}))
            return None
        self._run_main_with(body)
        self.assertEqual([e[2] for e in self.events if isinstance(e, tuple)], [240.0])

    def test_fired_watchdog_makes_task_retryable(self):
        import worker as worker_mod
        self._browser_mode()
        self.bl.watch_engine = self._fake_watchdog(fired=True)
        states = []

        def body(factory):
            task = ApplicationTask(id="t", candidate_id="u", vacancy_url="https://e.ru/j")
            agent = factory(task)
            # Браузер убит сторожем — зависший вызов Playwright падает.
            agent.engine.open = lambda url: (_ for _ in ()).throw(RuntimeError("browser has been closed"))
            result = agent.run(task.vacancy_url, CandidateProfile({}))
            self.assertEqual(result.status, "failed")
            self.assertIn(result.reason_code, worker_mod.RETRYABLE_CODES)
            queue = FakeQueue()
            states.append(worker_mod.apply_result(queue, task, result))
            # Отправка уже началась — повтора нет, итог неизвестен.
            states.append(worker_mod.apply_result(queue, task, result, submission_attempted=True))
            return None
        self._run_main_with(body)
        self.assertEqual(states, [TaskState.RETRYABLE_FAILED, TaskState.SUBMISSION_UNKNOWN])

    def test_fired_watchdog_keeps_submitted_result(self):
        from agent import AgentResult

        class Agent:
            def run(self, *a):
                return AgentResult("submitted")
            resume = _run_from_page = run
        self.bl.watch_engine = self._fake_watchdog(fired=True)
        agent = Agent()
        self.rw._watch_agent(agent, object(), 5)
        self.assertEqual(agent.run("u", None).status, "submitted")

    def test_no_memory_task_not_taken(self):
        self._browser_mode()
        called = []

        def no_memory():
            self.rw._stop = True
            return False
        self.rw._memory_allows_browser = no_memory
        self.wm.run_once = lambda *a, **k: called.append(1)
        self.assertEqual(self.rw.main(), 0)
        self.assertEqual(called, [])

    def test_memory_check_has_no_floor_of_one(self):
        # max_parallel_browsers() никогда не меньше 1 — поэтому своя проверка.
        old = self.bl.read_available_mb
        try:
            self.bl.read_available_mb = lambda *a, **k: self.bl.RESERVE_MB + 100
            self.assertFalse(self.saved[4][2]())
            self.bl.read_available_mb = lambda *a, **k: self.bl.RESERVE_MB + self.bl.PER_BROWSER_MB
            self.assertTrue(self.saved[4][2]())
        finally:
            self.bl.read_available_mb = old

    def _recording_agent(self, accepts_mapper: bool):
        made = []
        real = self.saved[3][2]

        if accepts_mapper:
            class Agent(real):
                def __init__(self, allowed_hosts, max_steps=30, *, field_mapper=None, **kw):
                    super().__init__(allowed_hosts, max_steps, **kw)
                    self.field_mapper = field_mapper
                    made.append(self)
        else:
            class Agent(real):
                def __init__(self, allowed_hosts, max_steps=30, **kw):
                    super().__init__(allowed_hosts, max_steps, **kw)
                    made.append(self)
        self.rw.JupiterAgent = Agent
        return made

    def _one_agent(self):
        def body(factory):
            factory(ApplicationTask(id="t", candidate_id="u", vacancy_url="https://e.ru/j"))
            return None
        with self.assertLogs("jupiter", level="INFO") as logs:
            self._run_main_with(body)
        return "\n".join(logs.output)

    def test_without_key_no_field_mapper(self):
        made = self._recording_agent(accepts_mapper=True)
        out = self._one_agent()
        self.assertIsNone(made[0].field_mapper)
        self.assertIn("YandexGPT для незнакомых полей: нет", out)

    def test_with_key_field_mapper_calls_suggest_field_keys_and_key_not_logged(self):
        import yandex_gpt
        os.environ["YANDEX_GPT_API_KEY"] = self.SECRET
        os.environ["YANDEX_GPT_FOLDER_ID"] = "b1g-folder-secret"
        made = self._recording_agent(accepts_mapper=True)
        calls = []

        def fake_suggest(llm, fields, allowed_keys):
            calls.append((llm, fields, allowed_keys))
            return {"plan-f0": "phone"}
        self.bp.suggest_field_keys = fake_suggest
        out = self._one_agent()
        mapper = made[0].field_mapper
        self.assertTrue(callable(mapper))
        fields = [{"jt": "plan-f0", "label": "Мобильный"}]
        self.assertEqual(mapper(fields, ["phone", "email"]), {"plan-f0": "phone"})
        llm, got_fields, got_keys = calls[0]
        self.assertIsInstance(llm, yandex_gpt.YandexGPT)
        self.assertEqual(got_fields, fields)
        self.assertEqual(got_keys, ["phone", "email"])
        self.assertIn("YandexGPT для незнакомых полей: да", out)
        self.assertNotIn(self.SECRET, out)
        self.assertNotIn("b1g-folder-secret", out)

    def test_agent_without_field_mapper_param_does_not_crash(self):
        os.environ["YANDEX_GPT_API_KEY"] = self.SECRET
        os.environ["YANDEX_GPT_FOLDER_ID"] = "folder"
        made = self._recording_agent(accepts_mapper=False)
        out = self._one_agent()
        self.assertEqual(len(made), 1)
        self.assertNotIn(self.SECRET, out)


if __name__ == "__main__":
    unittest.main()
