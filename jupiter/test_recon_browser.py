#!/usr/bin/env python3
"""Браузерная разведка на двух синтетических сайтах, без сети.

Обычная серверная анкета и SPA с кнопкой «Откликнуться»: обе должны дать
dry_run_ok, а сервер — не получить ни одного POST. Нужен Playwright и Chromium
(JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from recon_browser import compare, run_recon, select_sites

try:
    from browser_engine import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

PLAIN = """<!doctype html><meta charset="utf-8"><h1>Продавец-кассир</h1>
<form method="post" action="/send">
  <label>Имя <input name="fn" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label><input type="checkbox" name="pd" required>
    Согласен на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>"""

SPA = """<!doctype html><meta charset="utf-8"><h1>Продавец-кассир</h1>
<button type="button" id="open">Откликнуться</button><div id="root"></div>
<script>
document.getElementById('open').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `
    <label>Имя <input id="fn" required></label>
    <label>Телефон <input id="ph" type="tel" required></label>
    <label>Email <input id="em" type="email" required></label>
    <label><input id="agree" type="checkbox" required>
      Согласен на обработку персональных данных</label>
    <button type="button" id="send">Отправить отклик</button>`;
  document.getElementById('send').addEventListener('click',
    () => fetch('/api/apply', {method: 'POST', body: 'x'}));
});
fetch('/api/track', {method: 'POST', body: 'open'}).catch(() => {});
</script>"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        page = {"/plain": PLAIN, "/spa": SPA}.get(self.path)
        if page is None:
            self.send_response(404)
            self.end_headers()
            return
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.posts.append(self.path)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class ReconBrowserTest(unittest.TestCase):
    def test_plain_and_spa_forms_reach_dry_run_ok_without_post(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.posts = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        results = run_recon(
            [("plain", f"{base}/plain"), ("spa", f"{base}/spa")],
            timeout=15, site_deadline=90, chromium=CHROMIUM,
        )
        dump = json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=1)
        for item in results:
            self.assertEqual(item.klass, "dry_run_ok", dump)
            self.assertEqual(item.engine, "browser")
        spa = next(r for r in results if r.name == "spa")
        self.assertIn("apply_click", [a.get("action") for a in spa.browser_actions], dump)
        self.assertEqual(server.posts, [])

    def test_deadline_turns_into_blocked_result(self):
        [item] = run_recon([("x", "http://127.0.0.1:9/")], timeout=5, site_deadline=0.01, chromium=CHROMIUM)
        self.assertEqual(item.klass, "blocked")
        self.assertEqual(item.block_kind, "таймаут")


class PureTest(unittest.TestCase):
    def test_select_sites(self):
        sites = [("A", "https://www.a.ru/x"), ("B", "https://b.ru/y"), ("C", "https://c.ru/z")]
        self.assertEqual(select_sites(sites, ["a.ru", "c.ru"], 1), [sites[0]])
        self.assertEqual(select_sites(sites, None, 2), sites[:2])

    def test_compare_reports_class_changes(self):
        old = [{"url": "u1", "klass": "spa"}, {"url": "u2", "klass": "blocked"}]
        new = [{"url": "u1", "klass": "dry_run_ok"}, {"url": "u2", "klass": "blocked"}]
        text = compare(old, new)
        self.assertIn("spa -> dry_run_ok  u1", text)
        self.assertIn("Сменили класс: 1", text)


if __name__ == "__main__":
    unittest.main()
