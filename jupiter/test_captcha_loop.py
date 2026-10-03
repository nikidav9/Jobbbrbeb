#!/usr/bin/env python3
"""Тесты передачи капчи человеку: без браузера, на фейковых движке, очереди и часах."""
from __future__ import annotations

import json
import logging
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from agent import AgentResult, CandidateProfile, Reason
from captcha_loop import continue_through_captcha, solve_with_human
from tasks import ApplicationTask, TaskState
from worker import run_once

SECRET = "x7K9q"  # ответ человека — не должен всплыть ни в логах, ни в траектории


class Info:
    def __init__(self, transferable: bool = True):
        self.transferable = transferable


class FakeEngine:
    def __init__(self, info=None, accept: bool = True):
        self.info = info if info is not None else Info()
        self.accept = accept
        self.entered: list[str] = []

    def captcha(self):
        return self.info

    def captcha_png(self, info) -> bytes:
        return b"\x89PNG-fake"

    def enter_captcha(self, info, answer) -> bool:
        self.entered.append(answer)
        return self.accept

    def current_page(self):
        return "PAGE-AFTER-CAPTCHA"


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.now += s


class CaptchaQueue:
    """Очередь с капчей: polls — что вернёт captcha_poll по порядку, дальше — 'waiting'."""

    def __init__(self, polls=None, tasks=None):
        self.polls = list(polls or [])
        self.tasks = list(tasks or [])
        self.posted: list[tuple[str, bytes]] = []
        self.results: list[tuple[str, str]] = []
        self.heartbeats = 0
        self.finished: list[tuple[str, str, dict]] = []
        self.checkpoints: list = []

    def captcha_post(self, task_id, png):
        self.posted.append((task_id, png))
        return "cap-1"

    def captcha_poll(self, task_id):
        return self.polls.pop(0) if self.polls else ("waiting", None)

    def captcha_result(self, task_id, outcome):
        self.results.append((task_id, outcome))

    def heartbeat(self, task_id):
        self.heartbeats += 1
        return True

    # для run_once
    def lease(self, worker):
        return self.tasks.pop(0) if self.tasks else None

    def checkpoint(self, task_id, state, data):
        self.checkpoints.append((task_id, state, data))

    def finish(self, task_id, state, **kwargs):
        self.finished.append((task_id, state, kwargs))

    def fail(self, task_id, error, *, retryable=True):
        return TaskState.FAILED


def captcha_result() -> AgentResult:
    return AgentResult(
        "action_required", "CAPTCHA detected",
        [{"action": "open", "url": "https://ex.test/apply"},
         {"action": "action_required", "reason_code": Reason.CAPTCHA_REQUIRED}],
        Reason.CAPTCHA_REQUIRED, {"resume_token": "tok"},
    )


class FakeAgent:
    def __init__(self, engine, first: AgentResult, then: list[AgentResult] | None = None,
                 dry_run: bool = False):
        self.engine = engine
        self.dry_run = dry_run
        self.first = first
        self.then = list(then or [])
        self.continued: list[tuple] = []

    def run(self, url, profile):
        return self.first

    def _run_from_page(self, page, profile, trajectory):
        self.continued.append((page, profile, trajectory))
        nxt = self.then.pop(0)
        return AgentResult(nxt.status, nxt.reason, trajectory + nxt.trajectory,
                           nxt.reason_code, nxt.human_action)


def submitted() -> AgentResult:
    return AgentResult("submitted", "ok", [{"action": "submitted"}], None)


class TestSolveWithHuman(unittest.TestCase):
    def run_solve(self, engine, queue, wait_s=600):
        clock = FakeClock()
        return solve_with_human(engine, queue, "t1", wait_s=wait_s, poll_s=5,
                                sleep=clock.sleep, clock=clock), clock

    def test_answer_accepted_is_solved(self):
        engine, queue = FakeEngine(), CaptchaQueue([("waiting", None), ("answered", SECRET)])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "solved")
        self.assertEqual(engine.entered, [SECRET])
        self.assertEqual(queue.posted, [("t1", b"\x89PNG-fake")])
        self.assertEqual(queue.results, [("t1", "solved")])

    def test_answer_rejected_twice_is_failed(self):
        # Первый неверный ответ не обрывает отклик: сайт показал новую
        # картинку, человек вводит заново. Второй неверный подряд — стоп.
        engine = FakeEngine(accept=False)
        queue = CaptchaQueue([("answered", "wrong"), ("answered", "wrong2")])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "failed")
        self.assertEqual(queue.results, [("t1", "failed"), ("t1", "failed")])
        self.assertEqual(len(queue.posted), 2)

    def test_wrong_then_right_answer_is_solved_on_a_fresh_picture(self):
        engine = FakeEngine()
        verdicts = iter([False, True])
        engine.enter_captcha = lambda info, answer: next(verdicts)
        queue = CaptchaQueue([("answered", "wrong"), ("answered", "right")])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "solved")
        self.assertEqual(len(queue.posted), 2)  # вторая картинка — новая
        self.assertEqual(queue.results, [("t1", "failed"), ("t1", "solved")])

    def test_repeat_captcha_asks_site_for_a_new_picture(self):
        engine = FakeEngine()
        engine.refreshed = []
        engine.refresh_captcha = lambda info: engine.refreshed.append(info) or True
        queue = CaptchaQueue([("refresh", None), ("answered", SECRET)])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "solved")
        self.assertEqual(len(engine.refreshed), 1)
        self.assertEqual(len(queue.posted), 2)
        self.assertEqual(engine.entered, [SECRET])

    def test_repeat_captcha_when_site_dropped_it_is_solved(self):
        engine = FakeEngine()
        engine.captcha = lambda: None
        engine.captcha_png = lambda info: b"\x89PNG-fake"
        # первый раз капча есть, после обновления её на странице уже нет
        calls = iter([Info()])
        engine.captcha = lambda: next(calls, None)
        queue = CaptchaQueue([("refresh", None)])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "solved")

    def test_repeat_captcha_is_limited(self):
        engine = FakeEngine()
        queue = CaptchaQueue([("refresh", None)] * 20)
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "failed")
        self.assertEqual(len(queue.posted), 6)

    def test_no_answer_in_time_is_expired(self):
        engine, queue = FakeEngine(), CaptchaQueue()
        outcome, clock = self.run_solve(engine, queue, wait_s=60)
        self.assertEqual(outcome, "expired")
        self.assertEqual(engine.entered, [])
        self.assertEqual(queue.results, [])
        self.assertGreaterEqual(clock.now, 60)

    def test_lost_lease_stops_waiting_and_answer_is_not_entered(self):
        engine, queue = FakeEngine(), CaptchaQueue([("answered", "kotik")])
        queue.heartbeat = lambda task_id: False  # аренду перехватил другой воркер
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "expired")
        self.assertEqual(engine.entered, [])
        self.assertEqual(queue.results, [])

    def test_queue_expired_status_is_expired(self):
        engine, queue = FakeEngine(), CaptchaQueue([("expired", None)])
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "expired")

    def test_not_transferable_is_unsupported_and_nothing_posted(self):
        engine, queue = FakeEngine(info=Info(transferable=False)), CaptchaQueue()
        outcome, _ = self.run_solve(engine, queue)
        self.assertEqual(outcome, "unsupported")
        self.assertEqual(queue.posted, [])

    def test_no_captcha_on_page_is_unsupported(self):
        engine = FakeEngine()
        engine.captcha = lambda: None
        outcome, _ = self.run_solve(engine, CaptchaQueue())
        self.assertEqual(outcome, "unsupported")

    def test_heartbeat_renews_lease_while_waiting(self):
        engine, queue = FakeEngine(), CaptchaQueue()
        self.run_solve(engine, queue, wait_s=60)  # 60 / 5 = 12 опросов
        self.assertEqual(queue.heartbeats, 12)


class TestContinueThroughCaptcha(unittest.TestCase):
    def test_solved_continues_agent_from_current_page(self):
        engine = FakeEngine()
        queue = CaptchaQueue([("answered", SECRET)])
        first = captcha_result()
        agent = FakeAgent(engine, first, [submitted()])
        profile = CandidateProfile({"full_name": "Иван"})
        with self.assertLogs("jupiter", level="DEBUG") as logs:
            result = continue_through_captcha(
                agent, queue, "t1", profile, first,
                solve=lambda e, q, t: solve_with_human(e, q, t, sleep=lambda s: None),
            )
        self.assertEqual(result.status, "submitted")
        self.assertEqual(len(agent.continued), 1)
        page, prof, trajectory = agent.continued[0]
        self.assertEqual(page, "PAGE-AFTER-CAPTCHA")
        self.assertIs(prof, profile)
        self.assertIs(trajectory, first.trajectory)  # та же траектория, не новая
        self.assertNotIn(SECRET, json.dumps(result.trajectory, ensure_ascii=False))
        self.assertNotIn(SECRET, "\n".join(logs.output))

    def test_failed_keeps_captcha_required(self):
        engine = FakeEngine(accept=False)
        first = captcha_result()
        agent = FakeAgent(engine, first, [submitted()])
        result = continue_through_captcha(
            agent, CaptchaQueue([("answered", "wrong"), ("answered", "wrong2")]), "t1", None, first,
            solve=lambda e, q, t: solve_with_human(e, q, t, sleep=lambda s: None))
        self.assertIs(result, first)
        self.assertEqual(agent.continued, [])

    def test_at_most_two_captchas_per_task(self):
        engine = FakeEngine()
        first = captcha_result()
        agent = FakeAgent(engine, first, [captcha_result(), captcha_result(), submitted()])
        calls = []
        result = continue_through_captcha(
            agent, CaptchaQueue(), "t1", None, first,
            solve=lambda e, q, t: calls.append(t) or "solved")
        self.assertEqual(len(calls), 2)
        self.assertEqual(result.reason_code, Reason.CAPTCHA_REQUIRED)

    def test_dry_run_http_engine_or_old_queue_skip(self):
        first = captcha_result()
        never = lambda *a: self.fail("solve must not be called")
        # dry-run
        agent = FakeAgent(FakeEngine(), first, dry_run=True)
        self.assertIs(continue_through_captcha(agent, CaptchaQueue(), "t", None, first, solve=never), first)
        # HTTP-движок без captcha()
        agent = FakeAgent(object(), first)
        self.assertIs(continue_through_captcha(agent, CaptchaQueue(), "t", None, first, solve=never), first)
        # очередь без captcha_post
        agent = FakeAgent(FakeEngine(), first)
        self.assertIs(continue_through_captcha(agent, object(), "t", None, first, solve=never), first)

    def test_other_reason_untouched(self):
        agent = FakeAgent(FakeEngine(), submitted())
        res = submitted()
        self.assertIs(continue_through_captcha(
            agent, CaptchaQueue(), "t", None, res, solve=lambda *a: self.fail("no")), res)

    def test_queue_error_leaves_needs_you(self):
        first = captcha_result()
        agent = FakeAgent(FakeEngine(), first)

        def boom(*a):
            raise RuntimeError(f"network down {SECRET}")
        with self.assertLogs("jupiter", level="WARNING") as logs:
            result = continue_through_captcha(agent, CaptchaQueue(), "t", None, first, solve=boom)
        self.assertIs(result, first)
        self.assertNotIn(SECRET, "\n".join(logs.output))


class TestWorkerHook(unittest.TestCase):
    def task(self):
        return ApplicationTask(id="t1", candidate_id="u1", vacancy_url="https://ex.test/apply")

    def test_run_once_continues_after_solved_captcha(self):
        queue = CaptchaQueue([("answered", SECRET)], tasks=[self.task()])
        agent = FakeAgent(FakeEngine(), captcha_result(), [submitted()])
        # ответ приходит на первом опросе — до сна дело не доходит
        _, state = run_once(queue, CandidateProfile({}), lambda t: agent)
        self.assertEqual(state, TaskState.SUBMITTED)
        self.assertEqual(len(agent.continued), 1)
        self.assertNotIn(SECRET, json.dumps(queue.finished, ensure_ascii=False, default=str))

    def test_run_once_dry_run_keeps_needs_you(self):
        queue = CaptchaQueue([("answered", SECRET)], tasks=[self.task()])
        agent = FakeAgent(FakeEngine(), captcha_result(), [submitted()], dry_run=True)
        _, state = run_once(queue, CandidateProfile({}), lambda t: agent)
        self.assertEqual(state, TaskState.ACTION_REQUIRED)
        self.assertEqual(queue.posted, [])
        self.assertEqual(queue.finished[0][2]["reason_code"], Reason.CAPTCHA_REQUIRED)


class TapInfo:
    transferable = False
    tappable = True


class TapEngine:
    """Движок с галочкой/сеткой: tap_captcha отдаёт состояния по очереди."""

    def __init__(self, states, infos=None):
        self.states = list(states)
        self.infos = list(infos) if infos is not None else [TapInfo()] * 4
        self.taps: list[list[tuple[float, float]]] = []

    def captcha(self):
        return self.infos.pop(0) if self.infos else None

    def captcha_tap_png(self, info) -> bytes:
        return b"\x89PNG-frame"

    def tap_captcha(self, info, points):
        self.taps.append(points)
        return self.states.pop(0)


class TapQueue(CaptchaQueue):
    def __init__(self, polls=None):
        super().__init__(polls)
        self.kinds: list[str] = []

    def captcha_post(self, task_id, png, kind="text"):
        self.kinds.append(kind)
        return super().captcha_post(task_id, png)


class TapCaptchaTest(unittest.TestCase):
    def solve(self, engine, queue):
        clock = FakeClock()
        return solve_with_human(engine, queue, "t1", wait_s=60, poll_s=5,
                                sleep=clock.sleep, clock=clock)

    def test_checkbox_tap_is_replayed_and_solved(self):
        engine = TapEngine(["solved"])
        queue = TapQueue([("answered", "0.1,0.5;0.9,0.25")])
        self.assertEqual(self.solve(engine, queue), "solved")
        self.assertEqual(queue.kinds, ["tap"])
        self.assertEqual(engine.taps, [[(0.1, 0.5), (0.9, 0.25)]])
        self.assertEqual(queue.results, [("t1", "solved")])

    def test_grid_after_checkbox_asks_a_second_time(self):
        engine = TapEngine(["again", "solved"])
        queue = TapQueue([("answered", "0.2,0.2"), ("answered", "0.3,0.3;0.8,0.9")])
        self.assertEqual(self.solve(engine, queue), "solved")
        self.assertEqual(queue.kinds, ["tap", "tap"])
        self.assertEqual(len(engine.taps), 2)

    def test_gives_up_after_three_rounds(self):
        engine = TapEngine(["again"] * 3)
        queue = TapQueue([("answered", "0.5,0.5")] * 3)
        self.assertEqual(self.solve(engine, queue), "failed")
        self.assertEqual(len(queue.posted), 3)

    def test_repeat_captcha_gives_a_fresh_snapshot(self):
        engine = TapEngine(["solved"])
        queue = TapQueue([("refresh", None), ("answered", "0.5,0.5")])
        self.assertEqual(self.solve(engine, queue), "solved")
        self.assertEqual(queue.kinds, ["tap", "tap"])
        self.assertEqual(len(engine.taps), 1)

    def test_nothing_changed_is_failed(self):
        engine = TapEngine(["failed"])
        queue = TapQueue([("answered", "0.5,0.5")])
        self.assertEqual(self.solve(engine, queue), "failed")
        self.assertEqual(queue.results, [("t1", "failed")])

    def test_bad_answer_never_reaches_the_browser(self):
        for answer in ("слово", "1.5,0.2", "0.5", "0.5,0.5;" * 13):
            engine = TapEngine(["solved"])
            queue = TapQueue([("answered", answer)])
            self.assertEqual(self.solve(engine, queue), "failed", answer)
            self.assertEqual(engine.taps, [], answer)

    def test_no_answer_expires_and_taps_nothing(self):
        engine = TapEngine(["solved"])
        queue = TapQueue([("expired", None)])
        self.assertEqual(self.solve(engine, queue), "expired")
        self.assertEqual(engine.taps, [])

    def test_lost_lease_stops_before_tapping(self):
        engine = TapEngine(["solved"])
        queue = TapQueue([("answered", "0.5,0.5")])
        queue.heartbeat = lambda task_id: False
        self.assertEqual(self.solve(engine, queue), "expired")
        self.assertEqual(engine.taps, [])

    def test_invisible_captcha_is_not_handed_over(self):
        class Invisible:
            transferable = False
            tappable = False
        engine = TapEngine(["solved"], infos=[Invisible()])
        queue = TapQueue()
        self.assertEqual(self.solve(engine, queue), "unsupported")
        self.assertEqual(queue.posted, [])


if __name__ == "__main__":
    unittest.main()
