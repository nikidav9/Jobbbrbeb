#!/usr/bin/env python3
"""Состояние возврата: хранение, срок жизни, восстановление кук."""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from engine import JupiterWebEngine
from handoff import HandoffStore, HumanAction, HumanActionRequest, ResumeState, new_token


def state(token: str, **kwargs) -> ResumeState:
    base = dict(
        token=token,
        page_url="http://127.0.0.1/apply",
        allowed_hosts=["127.0.0.1"],
        dry_run=False,
        cookies=[{"name": "sid", "value": "1", "domain": "127.0.0.1", "path": "/"}],
    )
    base.update(kwargs)
    return ResumeState(**base)


class Tokens(unittest.TestCase):
    def test_tokens_are_unique_and_not_guessable_by_shape(self):
        tokens = {new_token() for _ in range(50)}
        self.assertEqual(len(tokens), 50)
        self.assertTrue(all(len(t) >= 24 for t in tokens))


class Store(unittest.TestCase):
    def test_state_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "handoffs.json")
            HandoffStore(path).save(state("t1"))
            loaded = HandoffStore(path).load("t1")
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.cookies[0]["name"], "sid")

    def test_expired_state_is_not_returned(self):
        # Сессия работодателя протухает сама; отдавать мёртвые куки — значит
        # хранить их дольше нужного без всякой пользы.
        store = HandoffStore()
        old = state("t2")
        old.created_at = time.time() - HandoffStore.TTL_SECONDS - 1
        store.save(old)
        self.assertIsNone(store.load("t2"))

    def test_dropped_state_is_gone_from_disk_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "handoffs.json")
            store = HandoffStore(path)
            store.save(state("t3"))
            store.drop("t3")
            self.assertIsNone(HandoffStore(path).load("t3"))

    def test_broken_file_does_not_break_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "handoffs.json"
            path.write_text("{ not json", encoding="utf-8")
            store = HandoffStore(str(path))
            self.assertIsNone(store.load("t4"))
            store.save(state("t4"))
            self.assertIsNotNone(HandoffStore(str(path)).load("t4"))

    def test_unknown_token_is_none_not_an_error(self):
        self.assertIsNone(HandoffStore().load("never-existed"))


class Cookies(unittest.TestCase):
    def test_engine_round_trips_cookies(self):
        engine = JupiterWebEngine({"127.0.0.1"})
        engine.import_cookies([
            {"name": "sid", "value": "abc", "domain": "127.0.0.1", "path": "/"},
        ])
        exported = engine.export_cookies()
        self.assertEqual(exported[0]["name"], "sid")
        self.assertEqual(exported[0]["value"], "abc")

    def test_nameless_cookie_is_skipped(self):
        engine = JupiterWebEngine({"127.0.0.1"})
        engine.import_cookies([{"value": "x"}])
        self.assertEqual(engine.export_cookies(), [])


class Request(unittest.TestCase):
    def test_request_carries_everything_the_ui_needs(self):
        request = HumanActionRequest(
            type=HumanAction.CAPTCHA,
            prompt="Пройдите проверку",
            page_url="http://127.0.0.1/apply",
            resume_token=new_token(),
            field=None,
        )
        payload = request.as_dict()
        for key in ("type", "prompt", "page_url", "resume_token"):
            self.assertIn(key, payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
