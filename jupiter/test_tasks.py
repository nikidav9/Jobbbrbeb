#!/usr/bin/env python3
"""Очередь задач подачи. Без сети."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from tasks import BACKOFF_BASE_SECONDS, ApplicationTask, TaskQueue, TaskState


class Leasing(unittest.TestCase):
    def test_a_task_is_handed_to_one_worker_at_a_time(self):
        queue = TaskQueue()
        queue.push("a@b.ru", "https://e.ru/vacancy/1")
        first = queue.lease("w1")
        self.assertIsNotNone(first)
        self.assertIsNone(queue.lease("w2"))

    def test_expired_lease_returns_the_task_to_the_queue(self):
        # Воркер умер. Задача не должна умереть вместе с ним.
        queue = TaskQueue(lease_seconds=1)
        queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1", now=1000.0)
        released = queue.release_expired(now=1002.0)
        self.assertEqual(len(released), 1)
        self.assertIsNotNone(queue.lease("w2", now=1002.0))

    def test_heartbeat_extends_the_lease(self):
        queue = TaskQueue(lease_seconds=10)
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1", now=1000.0)
        self.assertTrue(queue.heartbeat(task.id, now=1005.0))
        # Живой воркер — задача не отбирается.
        self.assertEqual(queue.release_expired(now=1012.0), [])

    def test_heartbeat_for_an_unleased_task_is_refused(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        self.assertFalse(queue.heartbeat(task.id))


class DomainLimit(unittest.TestCase):
    def test_one_employer_does_not_get_twenty_parallel_requests(self):
        queue = TaskQueue(per_domain_limit=2)
        for i in range(5):
            queue.push("a@b.ru", f"https://e.ru/vacancy/{i}")
        self.assertIsNotNone(queue.lease("w1"))
        self.assertIsNotNone(queue.lease("w2"))
        self.assertIsNone(queue.lease("w3"))

    def test_another_employer_is_not_blocked_by_a_busy_one(self):
        queue = TaskQueue(per_domain_limit=1)
        queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.push("a@b.ru", "https://other.ru/vacancy/1")
        self.assertIsNotNone(queue.lease("w1"))
        second = queue.lease("w2")
        self.assertIsNotNone(second)
        self.assertEqual(second.domain, "other.ru")


class Retries(unittest.TestCase):
    def test_failure_is_retryable_until_the_attempt_limit(self):
        queue = TaskQueue(max_attempts=2)
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1", now=1000.0)
        self.assertEqual(
            queue.fail(task.id, "timeout", now=1000.0), TaskState.RETRYABLE_FAILED
        )
        queue.lease("w1", now=2000.0)
        self.assertEqual(
            queue.fail(task.id, "timeout", now=2000.0), TaskState.FAILED
        )

    def test_backoff_keeps_the_task_out_of_reach_for_a_while(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1", now=1000.0)
        queue.fail(task.id, "timeout", now=1000.0)
        # Сразу повторять нельзя: у работодателя только что не сложилось.
        self.assertIsNone(queue.lease("w1", now=1000.0 + BACKOFF_BASE_SECONDS - 1))
        self.assertIsNotNone(queue.lease("w1", now=1000.0 + BACKOFF_BASE_SECONDS + 1))

    def test_a_non_retryable_failure_ends_the_task(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1")
        self.assertEqual(
            queue.fail(task.id, "vacancy closed", retryable=False), TaskState.FAILED
        )
        self.assertIsNone(queue.lease("w2"))


class Terminal(unittest.TestCase):
    def test_submitted_task_is_never_handed_out_again(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1")
        queue.finish(task.id, TaskState.SUBMITTED, receipt_key="k1")
        self.assertIsNone(queue.lease("w2"))
        self.assertEqual(queue.get(task.id).receipt_key, "k1")

    def test_a_task_waiting_for_a_human_is_not_picked_up_by_a_worker(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1")
        queue.finish(
            task.id, TaskState.ACTION_REQUIRED,
            reason_code="CAPTCHA_REQUIRED", resume_token="tok",
        )
        self.assertIsNone(queue.lease("w2"))
        self.assertEqual(queue.get(task.id).resume_token, "tok")

    def test_unknown_submission_is_not_retried_by_the_queue_either(self):
        # Тот же запрет, что и в агенте, но на уровне очереди: повторный POST
        # не должен случиться и через планировщик.
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1")
        queue.finish(task.id, TaskState.SUBMISSION_UNKNOWN)
        self.assertIsNone(queue.lease("w2"))


class Checkpoints(unittest.TestCase):
    def test_checkpoint_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "queue.json")
            queue = TaskQueue(path)
            task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
            queue.lease("w1")
            queue.checkpoint(task.id, TaskState.FILLING, {"url": "https://e.ru/apply"})
            restored = TaskQueue(path).get(task.id)
            self.assertEqual(restored.state, TaskState.FILLING)
            self.assertEqual(restored.checkpoint["url"], "https://e.ru/apply")

    def test_every_transition_is_logged(self):
        queue = TaskQueue()
        task = queue.push("a@b.ru", "https://e.ru/vacancy/1")
        queue.lease("w1")
        queue.checkpoint(task.id, TaskState.FILLING, {})
        queue.finish(task.id, TaskState.SUBMITTED)
        states = [t["to"] for t in queue.get(task.id).transitions]
        self.assertEqual(states, [
            TaskState.QUEUED, TaskState.OPENING_SITE,
            TaskState.FILLING, TaskState.SUBMITTED,
        ])
        self.assertTrue(all("at" in t for t in queue.get(task.id).transitions))

    def test_broken_file_does_not_break_the_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queue.json"
            path.write_text("{ not json", encoding="utf-8")
            queue = TaskQueue(str(path))
            self.assertEqual(queue.all(), [])
            queue.push("a@b.ru", "https://e.ru/vacancy/1")
            self.assertEqual(len(TaskQueue(str(path)).all()), 1)


class Model(unittest.TestCase):
    def test_domain_comes_from_the_vacancy_url(self):
        task = ApplicationTask(id="1", candidate_id="a", vacancy_url="https://E.ru/v/1")
        self.assertEqual(task.domain, "e.ru")

    def test_round_trip_through_a_dict(self):
        task = ApplicationTask(id="1", candidate_id="a", vacancy_url="https://e.ru/v/1")
        self.assertEqual(ApplicationTask.from_dict(task.as_dict()).id, "1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
