#!/usr/bin/env python3
"""Анкета в iframe: same-origin и другой origin (другой порт), без сети."""
from __future__ import annotations

import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from browser_frames import find_application_frames, frame_direct_url, snapshot_frame

try:
    from browser_engine import SNAPSHOT_JS, SUBMIT_TEXT_RE, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

FORM = """<!doctype html><meta charset="utf-8"><h3>Анкета</h3>
<label>Имя <input id="fn"></label><label>Email <input type="email" id="em"></label>
<label>Телефон <input type="tel" id="ph"></label><button type="button">Отправить отклик</button>"""
NOISE = "<!doctype html><meta charset=utf-8><input placeholder='Поиск'><p>Реклама</p>"


def make_handler(page_html: str):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            path = self.path
            body = {"/form": FORM, "/noise": NOISE}.get(path, page_html).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return H


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class FramesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.other = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(""))
        oport = cls.other.server_address[1]
        page = (f'<!doctype html><meta charset=utf-8><h1>Вакансия</h1>'
                f'<iframe id="a" src="/form"></iframe>'
                f'<iframe id="b" src="http://127.0.0.1:{oport}/form"></iframe>'
                f'<iframe id="c" src="/noise"></iframe>')
        cls.main = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(page))
        cls.mport = cls.main.server_address[1]
        cls.oport = oport
        for s in (cls.main, cls.other):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=["--no-first-run"])
        cls.tab = cls.browser.new_page()
        cls.tab.goto(f"http://127.0.0.1:{cls.mport}/", wait_until="load")
        cls.tab.wait_for_timeout(300)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.main.shutdown()
        cls.other.shutdown()

    def test_finds_both_frames_and_skips_noise(self):
        frames = find_application_frames(self.tab, {"127.0.0.1"})
        self.assertEqual(len(frames), 2, [f.url for f in frames])
        same = [f for f in frames if f.same_origin]
        cross = [f for f in frames if not f.same_origin]
        self.assertEqual(len(same), 1)
        self.assertEqual(len(cross), 1)
        self.assertIsNone(same[0].direct_url)
        self.assertEqual(cross[0].direct_url, f"http://127.0.0.1:{self.oport}/form")

    def test_direct_url_needs_allowed_or_known_host(self):
        cross = [f for f in find_application_frames(self.tab, set()) if not f.same_origin][0]
        self.assertIsNone(cross.direct_url)
        self.assertIsNone(frame_direct_url(cross.frame, set()))

    def test_snapshot_of_both_frames_has_fields_and_refs(self):
        for f in find_application_frames(self.tab, {"127.0.0.1"}):
            data = snapshot_frame(f.frame, SNAPSHOT_JS, [SUBMIT_TEXT_RE, []])
            self.assertIn('id="fn"', data["html"])
            self.assertIn('id="ph"', data["html"])
            self.assertIn("data-jt-ref", data["html"])
            self.assertTrue(data["virtualForm"])
            self.assertEqual(data["url"], f.url)
            # метки стоят в самом фрейме — заполнить можно через frame.locator
            f.frame.locator('[data-jt-ref="0"]').first.fill("Никита")
            self.assertEqual(f.frame.locator("#fn").input_value(), "Никита")


if __name__ == "__main__":
    unittest.main()
