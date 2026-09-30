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
import urllib.parse
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

# Самописный список городов и телефон с маской — как в React-анкетах.
COMBO_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Аналитик — Карьера</title>
<h1>Аналитик данных</h1>
<div id="app">
  <label>Имя и фамилия <input id="nm"></label>
  <label>Email <input id="em" type="email"></label>
  <label>Телефон <input id="ph" type="tel" placeholder="+7 (___) ___-__-__"></label>
  <span id="city-l">Город</span>
  <div id="city" role="combobox" aria-labelledby="city-l" aria-required="true"
       aria-expanded="false" aria-controls="city-list" tabindex="0"
       style="border:1px solid #999;padding:6px;width:220px">Выберите город</div>
  <ul id="city-list" role="listbox" style="display:none">
    <li role="option">Санкт-Петербург</li><li role="option">Москва</li><li role="option">Казань</li>
  </ul>
  <button type="button" id="send">Отправить отклик</button>
</div>
<script>
const ph = document.getElementById('ph');
ph.addEventListener('input', () => {
  let d = ph.value.replace(/\\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (!d.startsWith('7')) d = '7' + d;
  d = d.slice(0, 11);
  const p = [d.slice(1, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)];
  ph.value = '+7 (' + p[0] + (d.length > 4 ? ') ' + p[1] : '') + (d.length > 7 ? '-' + p[2] : '') + (d.length > 9 ? '-' + p[3] : '');
});
const box = document.getElementById('city'), list = document.getElementById('city-list');
box.addEventListener('click', () => {
  const open = list.style.display === 'none';
  list.style.display = open ? 'block' : 'none';
  box.setAttribute('aria-expanded', String(open));
});
for (const li of list.querySelectorAll('li')) li.addEventListener('click', () => {
  box.textContent = li.textContent; box.dataset.value = li.textContent;
  list.querySelectorAll('li').forEach(x => x.setAttribute('aria-selected', String(x === li)));
  list.style.display = 'none'; box.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') list.style.display = 'none'; });
document.getElementById('send').addEventListener('click', async () => {
  const body = JSON.stringify({ name: document.getElementById('nm').value,
    email: document.getElementById('em').value, phone: ph.value, city: box.dataset.value || '' });
  const r = await fetch('/api/apply', { method: 'POST', body });
  document.getElementById('app').innerHTML = (await r.json()).ok ? '<h2>Спасибо! Ваш отклик получен</h2>' : 'Ошибка';
});
</script>
"""

# Анкета во iframe (так вставляют Huntflow, Potok и самописные виджеты).
FRAMED_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Тестировщик — Карьера</title>
<h1>QA-инженер</h1>
<p>Оставьте отклик в форме ниже.</p>
<iframe src="/frame-form" width="600" height="500"></iframe>
"""

FRAME_FORM = """<!doctype html>
<meta charset="utf-8">
<form method="post" action="/api/frame-apply">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="last_name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Телефон <input name="phone" type="tel" required></label>
  <button type="submit">Отправить отклик</button>
</form>
"""

# Поиск вакансий в шапке + анкета за «Откликнуться» (как job.rt.ru).
SEARCH_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>DevOps — Карьера</title>
<form action="/search" method="get"><input name="q" placeholder="Поиск вакансий"><input name="city" placeholder="Город">
  <button>Найти</button></form>
<h1>DevOps-инженер</h1>
<button type="button" id="open">Откликнуться</button>
<div id="root"></div>
<script>
document.getElementById('open').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `<form method="post" action="/api/search-apply">
    <label>Имя <input name="first_name" required></label>
    <label>Фамилия <input name="last_name" required></label>
    <label>Email <input name="email" type="email" required></label>
    <label>Телефон <input name="phone" type="tel" required></label>
    <button type="submit">Отправить отклик</button></form>`;
});
</script>
"""

# Анкета без <form> рядом с калькулятором ипотеки (как fsk.ru): поля
# калькулятора в анкету попадать не должны.
CALC_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Юрист — Карьера</title>
<section class="calc">
  <label>Площадь <input id="area" maxlength="4" value="169,1"></label>
  <label>Цена <input id="price" maxlength="0" value="0 ₽"></label>
</section>
<section class="apply">
  <h2>Отклик</h2>
  <label>Имя <input id="fn"></label>
  <label>Фамилия <input id="ln"></label>
  <label>Email <input id="em" type="email"></label>
  <label>Телефон <input id="ph" type="tel"></label>
  <button type="button" id="send">Отправить отклик</button>
</section>
<script>
document.getElementById('send').addEventListener('click', async () => {
  const body = JSON.stringify({fn: fn.value, ln: ln.value, em: em.value, ph: ph.value});
  const r = await fetch('/api/apply', { method: 'POST', body });
  document.querySelector('.apply').innerHTML = (await r.json()).ok ? '<h2>Спасибо! Ваш отклик получен</h2>' : 'Ошибка';
});
</script>
"""

# «Откликнуться» — div с обработчиком клика (ни button, ни курсора-руки, ни
# tabindex), а дата рождения — календарь, который глушит ввод с клавиатуры.
DIVBTN_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Тестировщик — Карьера</title>
<h1>QA-инженер</h1>
<div class="cta"><div class="cta__text">Откликнуться</div></div>
<div id="root"></div>
<script>
document.querySelector('.cta__text').addEventListener('click', () => {
  document.getElementById('root').innerHTML = `
    <label>Имя <input id="fn"></label>
    <label>Фамилия <input id="ln"></label>
    <label>Email <input id="em" type="email"></label>
    <label>Телефон <input id="ph" type="tel"></label>
    <label>Дата рождения <input id="bd" class="datepicker" name="birth_date"></label>
    <button type="button" id="send">Отправить отклик</button>`;
  // Как плагины-календари: набранное с клавиатуры стирается, принимается
  // только значение, записанное скриптом (выбор даты в календаре).
  document.getElementById('bd').addEventListener('input', e => {
    if (e.inputType && e.inputType.startsWith('insert')) e.target.value = '';
  });
  document.getElementById('send').addEventListener('click', async () => {
    const body = JSON.stringify({fn: fn.value, em: em.value, bd: bd.value});
    const r = await fetch('/api/apply', { method: 'POST', body });
    document.getElementById('root').innerHTML = (await r.json()).ok ? '<h2>Спасибо! Ваш отклик получен</h2>' : 'Ошибка';
  });
});
</script>
"""

# Лендинг на конструкторе: форма отклика внизу появляется, только когда до
# неё докрутили (IntersectionObserver).
LAZY_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Продакт — Карьера</title>
<h1>Продакт-менеджер</h1>
<div style="height:3200px">Описание вакансии и о компании…</div>
<div id="sentinel" style="height:10px"></div>
<div id="root"></div>
<script>
new IntersectionObserver((entries, obs) => {
  if (!entries.some(e => e.isIntersecting)) return;
  obs.disconnect();
  document.getElementById('root').innerHTML = `<form method="post" action="/api/search-apply">
    <label>Имя <input name="first_name" required></label>
    <label>Фамилия <input name="last_name" required></label>
    <label>Email <input name="email" type="email" required></label>
    <label>Телефон <input name="phone" type="tel" required></label>
    <button type="submit">Отправить отклик</button></form>`;
}).observe(document.getElementById('sentinel'));
</script>
"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/challenge") and "jt_check=1" not in (self.headers.get("Cookie") or ""):
            # Проверка браузера, как у DDoS-Guard: 403 и скрипт, который ставит
            # куку и перезагружает страницу.
            body = ("<!doctype html><meta charset=utf-8><p>Проверяем браузер…</p><script>"
                    "document.cookie='jt_check=1; path=/';"
                    "setTimeout(function(){location.reload()},300)</script>").encode("utf-8")
            self.send_response(403)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/blocked"):
            body = "<h1>417 Доступ заблокирован. Отключите VPN</h1>".encode("utf-8")
            self.send_response(417)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        pages = {"/vacancy": SPA_VACANCY, "/challenge": SPA_VACANCY, "/combo": COMBO_VACANCY,
                 "/searchy": SEARCH_VACANCY, "/calc": CALC_VACANCY, "/divbtn": DIVBTN_VACANCY,
                 "/lazy": LAZY_VACANCY, "/radio": RADIO_VACANCY,
                 "/framed": FRAMED_VACANCY, "/frame-form": FRAME_FORM}
        page = next((html for prefix, html in pages.items() if self.path.startswith(prefix)), None)
        if page is not None:
            body = page.encode("utf-8")
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
        if self.path in {"/api/frame-apply", "/api/search-apply", "/api/radio-apply"}:
            body = "<!doctype html><meta charset=utf-8><h2>Спасибо! Ваш отклик получен</h2>".encode()
            ctype = "text/html; charset=utf-8"
        else:
            body = json.dumps({"ok": True}).encode()
            ctype = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# Полюс, 30.09: сайт заранее отмечает ответ за кандидата. Необязательный
# вопрос без ответа в профиле не уходит вовсе.
RADIO_VACANCY = """<!doctype html>
<meta charset="utf-8">
<title>Геолог — Карьера</title>
<h1>Геолог</h1>
<form method="post" action="/api/radio-apply">
  <label>Имя <input name="fn" required></label>
  <label>Фамилия <input name="ln" required></label>
  <label>Email <input name="em" type="email" required></label>
  <p>Готовность к вахтовому методу</p>
  <label><input type="radio" name="shift" value="ready" checked>Готов</label>
  <label><input type="radio" name="shift" value="not-ready">Не готов</label>
  <label><input name="agree" type="checkbox" required>
    Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form>
"""


PROFILE = {
    "first_name": "Никита",
    "last_name": "Давыдов",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "consent": True,
    "city": "Москва",
    "birth_date": "1995-02-01",
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

    def test_site_preselected_radio_is_not_sent_as_the_candidates_answer(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/radio", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        applies = [raw for path, raw in self.server.state["posts"] if path == "/api/radio-apply"]
        self.assertEqual(len(applies), 1, dump)
        body = urllib.parse.parse_qs(applies[0].decode())
        self.assertEqual(body.get("fn"), ["Никита"])
        self.assertNotIn("shift", body)

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

    def test_custom_combobox_and_phone_mask_are_filled(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/combo/7", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        applies = [raw for path, raw in self.server.state["posts"] if path == "/api/apply"]
        self.assertEqual(len(applies), 1, dump)
        sent = json.loads(applies[0])
        self.assertEqual(sent["city"], "Москва", sent)
        self.assertEqual(sent["phone"], "+7 (999) 000-00-00", sent)
        self.assertEqual(sent["email"], "nikita.demo@reply.jobtoo.ru")

    def test_form_inside_iframe_is_opened_and_submitted(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/framed/3", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertTrue(any(a.get("action") == "frame_open" for a in eng.actions), eng.actions)
        applies = [raw for path, raw in self.server.state["posts"] if path == "/api/frame-apply"]
        self.assertEqual(len(applies), 1, dump)
        self.assertIn("Давыдов", urllib.parse.unquote_plus(applies[0].decode("utf-8")))

    def test_search_form_does_not_hide_the_apply_button(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/searchy/5", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)
        self.assertEqual([p for p, _ in self.server.state["posts"]], ["/api/search-apply"], dump)
        self.assertEqual(result.trajectory[0]["engine"], "jupiter-browser-engine")

    def test_calculator_fields_stay_out_of_the_virtual_form(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/calc/9", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        # До правки агент проверял и поля калькулятора и падал на VALIDATION_FAILED.
        self.assertNotIn('"area"', json.dumps(result.trajectory, ensure_ascii=False))
        sent = json.loads(next(raw for path, raw in self.server.state["posts"] if path == "/api/apply"))
        self.assertEqual(sent["em"], "nikita.demo@reply.jobtoo.ru")

    def test_div_apply_button_and_datepicker_that_blocks_typing(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/divbtn/4", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)
        sent = json.loads(next(raw for path, raw in self.server.state["posts"] if path == "/api/apply"))
        self.assertEqual(sent["fn"], "Никита")
        self.assertIn("1995", sent["bd"], sent)

    def test_lazy_form_at_the_bottom_appears_after_scrolling(self):
        eng = self.engine(read_only=False)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=False)
        result = agent.run(f"http://127.0.0.1:{self.port}/lazy/2", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submitted", dump)
        self.assertIn({"action": "scroll_through"}, eng.actions)
        self.assertEqual([p for p, _ in self.server.state["posts"]], ["/api/search-apply"], dump)

    def test_blocked_page_is_a_navigation_failure(self):
        eng = self.engine(read_only=True)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=True)
        result = agent.run(f"http://127.0.0.1:{self.port}/blocked/1", self.profile)
        self.assertEqual(result.reason_code, "NAVIGATION_FAILED", result.as_dict())

    def test_browser_check_page_passes_by_itself(self):
        eng = self.engine(read_only=True)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=True)
        result = agent.run(f"http://127.0.0.1:{self.port}/challenge/42", self.profile)
        self.assertNotEqual(result.reason_code, "NAVIGATION_FAILED", result.as_dict())
        self.assertIn({"action": "browser_check_passed", "was": 403, "now": 200}, eng.actions)
        self.assertEqual(self.server.state["posts"], [])

    def test_navigation_outside_allowed_hosts_is_refused(self):
        eng = self.engine(read_only=True)
        with self.assertRaises(EngineSecurityError):
            eng.open("http://example.invalid/vacancy")


if __name__ == "__main__":
    unittest.main()
