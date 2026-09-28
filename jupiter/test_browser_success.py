#!/usr/bin/env python3
"""ResponseRecorder / classify / toast_text на локальном сервере с fetch-отправкой."""
from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from browser_success import ResponseRecorder, classify, toast_text

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

PAGE = """<!doctype html><meta charset="utf-8"><title>t</title>
<button id="go">Отправить</button><div id="out"></div>
<script>
document.getElementById('go').onclick = async () => {
  const r = await fetch('/api/apply/' + location.hash.slice(1), {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'Иван', phone: '+7999'})});
  if (location.hash === '#toast') {
    const d = document.createElement('div'); d.setAttribute('role', 'status');
    d.textContent = 'Отклик отправлен'; document.body.appendChild(d);
  }
};
</script>"""

REPLIES = {
    "ok": (200, {"ok": True, "id": 7, "name": "Иван", "phone": "+7999"}),
    "fail": (422, {"error": "Заполните телефон", "phone": "+7999"}),
    "toast": (204, None),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # тишина
        pass

    def do_GET(self):
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        status, data = REPLIES[self.path.rsplit("/", 1)[-1]]
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        if data is not None:
            self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@unittest.skipIf(sync_playwright is None or CHROMIUM is None, "нужен Playwright и Chromium")
class BrowserSuccessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.host = f"127.0.0.1:{cls.srv.server_address[1]}"
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.srv.shutdown()

    def run_case(self, name, hosts=None):
        page = self.browser.new_page()
        self.addCleanup(page.close)
        page.goto(f"http://{self.host}/#{name}")
        rec = ResponseRecorder(hosts or {self.host}).start(page)
        page.click("#go")
        page.wait_for_timeout(500)
        return page, rec.stop()

    def test_json_ok_is_success_without_pii(self):
        _, res = self.run_case("ok")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["json"], {"ok": True, "id": 7})
        verdict = classify(res)
        self.assertTrue(verdict["api_success"])
        self.assertIsNone(verdict["api_error"])
        self.assertNotIn("Иван", json.dumps(res, ensure_ascii=False))

    def test_422_is_failure(self):
        _, res = self.run_case("fail")
        verdict = classify(res)
        self.assertFalse(verdict["api_success"])
        self.assertIn("422", verdict["api_error"])
        self.assertNotIn("+7999", json.dumps(res))

    def test_toast_text_after_submit(self):
        page, res = self.run_case("toast")
        self.assertIn("Отклик отправлен", toast_text(page))
        self.assertFalse(classify(res)["api_success"])  # 204 без тела — не доказательство

    def test_foreign_host_ignored(self):
        _, res = self.run_case("ok", hosts={"example.org"})
        self.assertEqual(res, [])

    def test_classify_failure_beats_success(self):
        verdict = classify([
            {"method": "POST", "path": "/a", "status": 200, "json": {"ok": True}},
            {"method": "POST", "path": "/b", "status": 500, "json": {}},
        ])
        self.assertFalse(verdict["api_success"])
        self.assertEqual(verdict["api_error"], "HTTP 500")
        self.assertTrue(classify([{"status": 200, "json": {"success": True}}])["api_success"])
        self.assertEqual(classify([{"status": 200, "json": {"ok": False}}])["api_error"], "ok=false")


if __name__ == "__main__":
    unittest.main()
