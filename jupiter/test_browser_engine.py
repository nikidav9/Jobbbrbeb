#!/usr/bin/env python3
"""Браузерный движок на «тяжёлом» карьерном сайте без сети.

Синтетический сайт устроен так, как те, что HTTP-движок не проходит:
анкета появляется после нажатия «Откликнуться» (JS), полей без <form>,
файл резюме спрятан за своей кнопкой, отправка — fetch, ответ — «Спасибо»
без перехода. Нужен Playwright и Chromium (JUPITER_CHROMIUM); без них тесты
пропускаются, остальной Юпитер от этого не зависит.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent
from engine import EngineSecurityError

try:
    from browser_engine import JupiterBrowserEngine, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)

SPA_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Backend-разработчик — Карьера</title>
<h1>Backend-разработчик</h1>
<p>Мы ищем разработчика в команду платежей.</p>
<button type="button" id="open">Откликнуться</button>
<div id="root"></div>
<script>
document.getElementById('open').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `
    <div class="apply">
      <h2>Отклик на вакансию</h2>
      <label>Имя <input id="fn" required></label>
      <label>Фамилия <input id="ln" required></label>
      <label>Email <input id="em" type="email" required></label>
      <label>Телефон <input id="ph" type="tel" required></label>
      <label class="upload">Резюме <span>Прикрепить файл</span>
        <input id="cv" type="file" style="display:none" required></label>
      <label><input id="agree" type="checkbox" required>
        Согласен на обработку персональных данных</label>
      <div class="hint" style="display:none"><input id="ghost" required></div>
      <button type="button" id="send">Отправить отклик</button>
    </div>`;
  document.getElementById('send').addEventListener('click', async () => {
    const fd = new FormData();
    for (const id of ['fn', 'ln', 'em', 'ph']) fd.append(id, document.getElementById(id).value);
    fd.append('agree', document.getElementById('agree').checked ? 'yes' : 'no');
    const f = document.getElementById('cv').files[0];
    if (f) fd.append('cv', f, f.name);
    const r = await fetch('/api/apply', { method: 'POST', body: fd });
    const j = await r.json();
    document.getElementById('root').innerHTML = j.ok
      ? '<h2>Спасибо! Ваш отклик получен</h2>' : '<p>Ошибка</p>';
  });
});
// Сайт сам шлёт аналитику при загрузке — в dry-run это тоже POST.
fetch('/api/track', { method: 'POST', body: 'open' }).catch(() => {});
</script>
"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/vacancy"):
            body = SPA_VACANCY.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        self.server.state["posts"].append((self.path, raw))
        body = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


PROFILE = {
    "first_name": "Никита",
    "last_name": "Давыдов",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "consent": True,
    "resume_path": "resume.txt",
}


# В CI (JUPITER_BROWSER_TESTS=1) Chromium ставит сам Playwright; локально —
# JUPITER_CHROMIUM или браузер песочницы.
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class BrowserEngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.server.state = {"posts": []}
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.server.state["posts"].clear()
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        (tmp / "resume.txt").write_text("Никита Давыдов\nBackend\n", encoding="utf-8")
        path = tmp / "profile.json"
        path.write_text(json.dumps(PROFILE, ensure_ascii=False), encoding="utf-8")
        self.profile = CandidateProfile.load(str(path))

    def tearDown(self):
        self.tmp.cleanup()

    def engine(self, *, read_only: bool) -> "JupiterBrowserEngine":
        eng = JupiterBrowserEngine({"127.0.0.1"}, read_only=read_only,
                                   executable_path=CHROMIUM, settle_ms=200)
        self.addCleanup(eng.close)
        return eng

    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/vacancy/42"

    def test_live_run_opens_spa_form_fills_and_submits(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(self.url(), self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)
        applies = [raw for path, raw in self.server.state["posts"] if path == "/api/apply"]
        self.assertEqual(len(applies), 1, dump)
        body = applies[0].decode("utf-8", "replace")
        for value in ("Никита", "Давыдов", "nikita.demo@reply.jobtoo.ru", "Backend"):
            self.assertIn(value, body)
        self.assertIn('name="agree"\r\n\r\nyes', body)
        # Невидимое поле агенту не показали — иначе он счёл бы его
        # обязательным, неизвестным и отдал бы анкету человеку.
        self.assertNotIn("ghost", dump)

    def test_dry_run_fills_but_the_browser_sends_nothing(self):
        eng = self.engine(read_only=True)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=True)
        result = agent.run(self.url(), self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "ready_to_submit", dump)
        # Ни отклика, ни даже аналитики страницы: в dry-run браузер
        # обрывает любой не-GET запрос.
        self.assertEqual(self.server.state["posts"], [])
        self.assertTrue(any(a.get("reason") == "read_only" for a in eng.actions))

    def test_submit_is_blocked_in_read_only(self):
        eng = self.engine(read_only=True)
        page = eng.open(self.url())
        form = page.forms[0]
        with self.assertRaises(EngineSecurityError):
            eng.submit(page, form)

    def test_navigation_outside_allowed_hosts_is_refused(self):
        eng = self.engine(read_only=True)
        with self.assertRaises(EngineSecurityError):
            eng.open("http://example.invalid/vacancy")


if __name__ == "__main__":
    unittest.main()
