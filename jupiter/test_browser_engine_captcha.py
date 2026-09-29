#!/usr/bin/env python3
"""Капча и подтверждение по ответу сайта в браузерном движке — без сети.

Капча: движок её не решает, а только находит (captcha), снимает одну
картинку для кандидата (captcha_png) и вводит ответ кандидата (enter_captcha).
Успех: сайт отвечает JSON {"success": true}, страница не меняется, а
«Спасибо, отклик получен» живёт 1,5 с в тосте — агент всё равно видит отклик.
Нужен Playwright и Chromium (JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import json
import os
import struct
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent
from engine import EngineSecurityError, PageState

try:
    from browser_engine import JupiterBrowserEngine, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

ANSWER = "x7k2"
TOAST_OUTLIVED_MS = 2000  # тост живёт 1,5 с

CAPTCHA_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50">
<rect width="160" height="50" fill="#eee"/><text x="20" y="34" font-size="28">x7k2</text></svg>"""

# Анкета с персональными полями и текстовой капчей со своей кнопкой.
CAPTCHA_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Кладовщик — Карьера</title>
<h1>Кладовщик</h1>
<form method="post" action="/api/apply">
  <label>Имя <input name="first_name"></label>
  <label>Email <input name="email" type="email"></label>
  <label>Телефон <input name="phone" type="tel"></label>
  <div class="captcha" id="cap">
    <p>Введите символы с картинки</p>
    <img id="cimg" src="/captcha.svg?n=0" alt="captcha" width="160" height="50">
    <input id="cans" name="captcha_answer">
    <button type="button" id="ccheck">Проверить</button>
  </div>
  <button type="submit">Отправить отклик</button>
</form>
<script>
let n = 0;
document.getElementById('ccheck').addEventListener('click', () => {
  const inp = document.getElementById('cans');
  if (inp.value.trim() === '__ANSWER__') {
    document.getElementById('cap').remove();
  } else {
    inp.value = '';
    document.getElementById('cimg').src = '/captcha.svg?n=' + (++n);
  }
});
</script>
""".replace("__ANSWER__", ANSWER)

# Отправка fetch'ем, страница не меняется, подтверждение — только в тосте.
TOAST_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Менеджер — Карьера</title>
<h1>Менеджер по продажам</h1>
<div id="app">
  <label>Имя <input id="fn"></label>
  <label>Фамилия <input id="ln"></label>
  <label>Email <input id="em" type="email"></label>
  <label>Телефон <input id="ph" type="tel"></label>
  <button type="button" id="send">Отправить отклик</button>
</div>
<script>
document.getElementById('send').addEventListener('click', async () => {
  const body = JSON.stringify({fn: fn.value, ln: ln.value, em: em.value, ph: ph.value});
  const r = await fetch('__API__', { method: 'POST', body, headers: {'Content-Type': 'application/json'} });
  const j = await r.json();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.textContent = j.success ? 'Спасибо, отклик получен' : 'Что-то пошло не так';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
});
</script>
"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, ctype: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/captcha.svg"):
            self._send(200, "image/svg+xml", CAPTCHA_SVG.encode())
        elif self.path.startswith("/captcha"):
            self._send(200, "text/html; charset=utf-8", CAPTCHA_PAGE.encode())
        elif self.path.startswith("/toast-ok"):
            self._send(200, "text/html; charset=utf-8", TOAST_PAGE.replace("__API__", "/api/ok").encode())
        elif self.path.startswith("/toast-bad"):
            self._send(200, "text/html; charset=utf-8", TOAST_PAGE.replace("__API__", "/api/bad").encode())
        else:
            self._send(404, "text/plain", b"")

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.state["posts"].append((self.path, raw))
        if self.path == "/api/bad":
            body = {"success": False, "error": "Вакансия закрыта"}
        else:
            body = {"success": True, "name": "Никита"}  # чужой ключ не должен попасть в журнал
        self._send(200, "application/json", json.dumps(body, ensure_ascii=False).encode())


PROFILE = {
    "first_name": "Никита",
    "last_name": "Давыдов",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "consent": True,
}


def _png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "не PNG"
    return struct.unpack(">II", data[16:24])


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class BrowserEngineCaptchaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.state = {"posts": []}
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.server.state["posts"].clear()
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "profile.json"
        path.write_text(json.dumps(PROFILE, ensure_ascii=False), encoding="utf-8")
        self.profile = CandidateProfile.load(str(path))

    def tearDown(self):
        self.tmp.cleanup()

    def engine(self, *, read_only: bool, settle_ms: int = 200) -> "JupiterBrowserEngine":
        eng = JupiterBrowserEngine({"127.0.0.1"}, read_only=read_only,
                                   executable_path=CHROMIUM, settle_ms=settle_ms)
        self.addCleanup(eng.close)
        return eng

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    # ── Капча ──────────────────────────────────────────────────────────────
    def test_captcha_is_found_shown_as_image_only_and_answered(self):
        eng = self.engine(read_only=False)
        eng.open(self.url("/captcha/1"))
        info = eng.captcha()
        self.assertIsNotNone(info)
        self.assertTrue(info.transferable, info)
        self.assertIsNotNone(info.submit_selector, info)

        png = eng.captcha_png(info)
        width, height = _png_size(png)
        # Только картинка капчи, а не вся страница с полями кандидата.
        self.assertLessEqual(width, 400)
        self.assertLessEqual(height, 200)
        full_w, full_h = _png_size(eng._tab.screenshot(type="png", full_page=True))
        self.assertLess(width * height, full_w * full_h)

        self.assertFalse(eng.enter_captcha(info, "zzzz"))
        info = eng.captcha()  # картинка обновилась — капча та же
        self.assertIsNotNone(info)
        self.assertTrue(eng.enter_captcha(info, ANSWER))
        self.assertIsNone(eng.captcha())
        # Проверка капчи — на странице, анкету она не отправила.
        self.assertEqual(self.server.state["posts"], [])

        page = eng.current_page()
        self.assertIsInstance(page, PageState)
        self.assertIn("Кладовщик", page.text)
        self.assertTrue(page.forms)

    def test_captcha_answer_is_refused_in_read_only(self):
        eng = self.engine(read_only=True)
        eng.open(self.url("/captcha/2"))
        info = eng.captcha()
        self.assertIsNotNone(info)
        self.assertTrue(eng.captcha_png(info).startswith(b"\x89PNG"))
        with self.assertRaises(EngineSecurityError):
            eng.enter_captcha(info, ANSWER)
        self.assertIsNotNone(eng.captcha())  # ничего не ввели и не нажали
        self.assertIsInstance(eng.current_page(), PageState)

    def test_page_without_captcha(self):
        eng = self.engine(read_only=True)
        eng.open(self.url("/toast-ok/1"))
        self.assertIsNone(eng.captcha())

    # ── Успех по ответу сайта ──────────────────────────────────────────────
    def test_api_success_and_vanishing_toast_confirm_the_application(self):
        # Пауза дольше жизни тоста: к снимку страницы его уже нет.
        eng = self.engine(read_only=False, settle_ms=TOAST_OUTLIVED_MS)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(self.url("/toast-ok/7"), self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertEqual([p for p, _ in self.server.state["posts"]], ["/api/ok"], dump)
        self.assertTrue(eng.last_api_result and eng.last_api_result["api_success"], eng.actions)
        api = [a for a in eng.actions if a.get("action") == "api_result"]
        self.assertEqual(len(api), 1, eng.actions)
        self.assertIsNone(api[0]["api_error"])
        # В журнал попадают только безопасные ключи ответа, без ПДн.
        self.assertNotIn("Никита", json.dumps(eng.actions, ensure_ascii=False))

    def test_api_error_is_recorded_and_not_a_success(self):
        eng = self.engine(read_only=False, settle_ms=TOAST_OUTLIVED_MS)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(self.url("/toast-bad/7"), self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertNotEqual(result.status, "submitted", dump)
        self.assertIsNotNone(eng.last_api_result, eng.actions)
        self.assertFalse(eng.last_api_result["api_success"])
        self.assertIn("Вакансия закрыта", eng.last_api_result["api_error"])
        self.assertTrue(any(a.get("action") == "api_result" for a in eng.actions))


if __name__ == "__main__":
    unittest.main()
