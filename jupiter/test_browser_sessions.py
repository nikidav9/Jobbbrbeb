#!/usr/bin/env python3
"""Пул браузерных сессий: лимит, срок, потокобезопасность, живой движок."""
from __future__ import annotations

import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from browser_sessions import SessionPool

try:
    from browser_engine import JupiterBrowserEngine, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and CHROMIUM is not None

PAGE = """<!doctype html><meta charset="utf-8"><title>t</title>
<form method="post" action="/done"><label>Код <input name="code"></label>
<button type="submit">Отправить</button></form>""".encode()


class FakeEngine:
    def __init__(self):
        self.closed = 0

    def close(self):
        self.closed += 1


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class SessionPoolTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.pool = SessionPool(max_sessions=3, ttl_seconds=600, clock=self.clock)

    def test_park_and_take_returns_same_engine_without_closing(self):
        eng = FakeEngine()
        self.pool.park("t1", eng, {"kind": "CAPTCHA"})
        self.assertEqual(self.pool.meta("t1"), {"kind": "CAPTCHA"})
        self.assertIs(self.pool.take("t1"), eng)
        self.assertEqual(eng.closed, 0)
        self.assertIsNone(self.pool.take("t1"))
        self.assertEqual(len(self.pool), 0)

    def test_overflow_closes_oldest(self):
        engines = [FakeEngine() for _ in range(4)]
        dropped = []
        for i, eng in enumerate(engines):
            self.clock.now = i
            dropped += self.pool.park(f"t{i}", eng)
        self.assertEqual(dropped, ["t0"])
        self.assertEqual([e.closed for e in engines], [1, 0, 0, 0])
        self.assertEqual(len(self.pool), 3)
        self.assertIsNone(self.pool.take("t0"))

    def test_expire_closes_only_stale(self):
        old, fresh = FakeEngine(), FakeEngine()
        self.pool.park("old", old)
        self.clock.now = 500
        self.pool.park("fresh", fresh)
        self.clock.now = 700
        self.assertEqual(self.pool.expire(), ["old"])
        self.assertEqual((old.closed, fresh.closed), (1, 0))
        self.assertEqual(self.pool.expire(), [])
        self.assertIs(self.pool.take("fresh"), fresh)

    def test_take_of_expired_session_closes_it_and_returns_none(self):
        eng = FakeEngine()
        self.pool.park("t1", eng)
        self.clock.now = 601
        self.assertIsNone(self.pool.take("t1"))
        self.assertEqual(eng.closed, 1)

    def test_reparking_same_task_closes_previous_engine(self):
        a, b = FakeEngine(), FakeEngine()
        self.pool.park("t1", a)
        self.assertEqual(self.pool.park("t1", b), ["t1"])
        self.assertEqual((a.closed, b.closed), (1, 0))
        self.assertIs(self.pool.take("t1"), b)

    def test_close_failure_does_not_break_pool(self):
        class Broken(FakeEngine):
            def close(self):
                raise RuntimeError("boom")
        self.pool.park("t1", Broken())
        self.clock.now = 601
        self.assertEqual(self.pool.expire(), ["t1"])

    def test_close_all(self):
        engines = [FakeEngine(), FakeEngine()]
        for i, eng in enumerate(engines):
            self.pool.park(f"t{i}", eng)
        self.assertEqual(sorted(self.pool.close_all()), ["t0", "t1"])
        self.assertEqual([e.closed for e in engines], [1, 1])

    def test_threads_never_exceed_limit_and_close_each_engine_once(self):
        pool = SessionPool(max_sessions=3, ttl_seconds=600)
        engines = [FakeEngine() for _ in range(40)]

        def work(chunk):
            for eng in chunk:
                pool.park(f"t{id(eng)}", eng)
                self.assertLessEqual(len(pool), 3)

        threads = [threading.Thread(target=work, args=(engines[i::4],)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        pool.close_all()
        self.assertEqual([e.closed for e in engines], [1] * 40)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(PAGE)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._send("<!doctype html><meta charset=utf-8><h1>Спасибо</h1>".encode())


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class RealEngineParkedTest(unittest.TestCase):
    def test_parked_engine_stays_alive_and_submits_after_take(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        engine = JupiterBrowserEngine({"127.0.0.1"}, executable_path=CHROMIUM, timeout=10)
        pool = SessionPool(max_sessions=1, ttl_seconds=600)
        try:
            page = engine.open(url)
            pool.park("task-1", engine, {"url": url})
            self.assertEqual(pool.expire(), [])
            taken = pool.take("task-1")
            self.assertIs(taken, engine)
            # Страница жива: то же состояние, форма отправляется.
            form = page.forms[0]
            code = next(page.controls[i] for i in form.control_indices
                        if page.controls[i].name == "code")
            code.value = "123"
            button = next(page.controls[i] for i in form.control_indices
                          if page.controls[i].type == "submit")
            after = taken.submit(page, form, button)
            self.assertIn("Спасибо", after.text)
        finally:
            engine.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
