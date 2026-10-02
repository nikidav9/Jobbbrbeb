#!/usr/bin/env python3
"""«Зоопарк» тяжёлых карьерных сайтов для браузерного движка (без сети).

Восемь синтетических сайтов, каждый воспроизводит один приём, на котором
ломаются HTTP-движки и «наивные» браузерные: визард без <form>, controlled
inputs, анкета в анимированной модалке, action="javascript:void(0)", ссылка
вместо кнопки, скрытый input file, редирект на /thanks, неизвестное
обязательное поле. Каждый сайт гоняется дважды: live (dry_run=False) и dry-run
(read_only=True) — с JupiterAgent + JupiterBrowserEngine.

Нужен Playwright и Chromium (JUPITER_CHROMIUM); без них тесты пропускаются.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import urllib.parse
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent

try:
    from browser_engine import JupiterBrowserEngine, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

CHROMIUM = os.environ.get("JUPITER_CHROMIUM") or (
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    if Path("/opt/pw-browsers/chromium-1194/chrome-linux/chrome").exists() else None
)
RUN = sync_playwright is not None and (CHROMIUM is not None or os.environ.get("JUPITER_BROWSER_TESTS") == "1")

PROFILE = {
    "first_name": "Никита",
    "last_name": "Давыдов",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "consent": True,
    "resume_path": "resume.txt",
}
CONTACT_VALUES = ("Никита", "Давыдов", "nikita.demo@reply.jobtoo.ru")
RESUME_MARK = "ZOO-RESUME-MARK"

HEAD = '<!doctype html><meta charset="utf-8"><title>Вакансия</title>'
TITLE = "<h1>Backend-разработчик</h1><p>Мы ищем разработчика в команду платежей.</p>"

# Общие поля контактов для сайтов с настоящей <form>.
CONTACT_FIELDS = """
  <label>Имя <input name="fn" required></label>
  <label>Фамилия <input name="ln" required></label>
  <label>Email <input name="em" type="email" required></label>
  <label>Телефон <input name="ph" type="tel" required></label>"""

# fetch-отправка FormData -> /api/apply -> «Спасибо» на месте.
FETCH_SEND = """
async function sendFd(fd) {
  const r = await fetch('/api/apply', { method: 'POST', body: fd });
  const j = await r.json();
  document.getElementById('root').innerHTML = j.ok
    ? '<h2>Спасибо! Ваш отклик получен</h2>' : '<p>Ошибка</p>';
}"""

# 1. Визард без <form>: контакты -> резюме -> согласие. Каждый шаг заменяет DOM.
WIZARD = HEAD + TITLE + """
<div id="root"></div>
<script>
const st = {};
""" + FETCH_SEND + """
function step1() {
  document.getElementById('root').innerHTML = `
    <h2>Шаг 1 из 3. Контакты</h2>
    <label>Имя <input id="fn" required></label>
    <label>Фамилия <input id="ln" required></label>
    <label>Email <input id="em" type="email" required></label>
    <label>Телефон <input id="ph" type="tel" required></label>
    <button type="button" id="n1">Далее</button>`;
  document.getElementById('n1').onclick = () => {
    for (const id of ['fn', 'ln', 'em', 'ph']) st[id] = document.getElementById(id).value;
    step2();
  };
}
function step2() {
  document.getElementById('root').innerHTML = `
    <h2>Шаг 2 из 3. Резюме</h2>
    <label>Резюме <input id="cv" type="file" required></label>
    <button type="button" id="n2">Далее</button>`;
  document.getElementById('n2').onclick = () => { st.cv = document.getElementById('cv').files[0]; step3(); };
}
function step3() {
  document.getElementById('root').innerHTML = `
    <h2>Шаг 3 из 3. Согласие</h2>
    <label><input id="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
    <button type="button" id="send">Отправить</button>`;
  document.getElementById('send').onclick = () => {
    const fd = new FormData();
    for (const id of ['fn', 'ln', 'em', 'ph']) fd.append(id, st[id]);
    fd.append('agree', document.getElementById('agree').checked ? 'yes' : 'no');
    if (st.cv) fd.append('cv', st.cv, st.cv.name);
    sendFd(fd);
  };
}
step1();
</script>"""

# 2. React-подобные controlled inputs: правда — в state, DOM лишь отражает его.
# Значение, выставленное без события input/change, через 50 мс откатывается.
CONTROLLED = HEAD + TITLE + """
<div id="root">
  <div class="app">
    <label>Имя <input id="fn" required></label>
    <label>Фамилия <input id="ln" required></label>
    <label>Email <input id="em" type="email" required></label>
    <label>Телефон <input id="ph" type="tel" required></label>
    <label><input id="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
    <button type="button" id="send">Отправить отклик</button>
  </div>
</div>
<script>
const state = { fn: '', ln: '', em: '', ph: '', agree: false };
""" + FETCH_SEND + """
for (const id of ['fn', 'ln', 'em', 'ph'])
  document.getElementById(id).addEventListener('input', e => { state[id] = e.target.value; });
document.getElementById('agree').addEventListener('change', e => { state.agree = e.target.checked; });
setInterval(() => {
  for (const id of ['fn', 'ln', 'em', 'ph']) {
    const el = document.getElementById(id);
    if (el && el.value !== state[id]) el.value = state[id];
  }
  const a = document.getElementById('agree');
  if (a && a.checked !== state.agree) a.checked = state.agree;
}, 50);
document.getElementById('send').onclick = () => {
  const fd = new FormData();
  for (const id of ['fn', 'ln', 'em', 'ph']) fd.append(id, state[id]);
  fd.append('agree', state.agree ? 'yes' : 'no');
  sendFd(fd);
};
</script>"""

# 3. Анкета в модалке: после «Откликнуться» окно выезжает 600 мс.
MODAL = HEAD + """
<style>
.modal { position: fixed; top: 10%; left: 20%; width: 60%; background: #fff; border: 1px solid #999;
  padding: 16px; animation: slide 600ms ease-out; }
@keyframes slide { from { opacity: 0; transform: translateY(80px); } to { opacity: 1; transform: none; } }
</style>
""" + TITLE + """
<button type="button" id="open">Откликнуться</button>
<div id="root"></div>
<script>
""" + FETCH_SEND + """
document.getElementById('open').onclick = () => {
  const r = document.getElementById('root');
  r.innerHTML = `<div class="modal" role="dialog">
    <h2>Анкета кандидата</h2>
    <label>Имя <input id="fn" required></label>
    <label>Фамилия <input id="ln" required></label>
    <label>Email <input id="em" type="email" required></label>
    <label>Телефон <input id="ph" type="tel" required></label>
    <label><input id="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
    <button type="button" id="send">Отправить отклик</button></div>`;
  document.getElementById('send').onclick = () => {
    const fd = new FormData();
    for (const id of ['fn', 'ln', 'em', 'ph']) fd.append(id, document.getElementById(id).value);
    fd.append('agree', document.getElementById('agree').checked ? 'yes' : 'no');
    sendFd(fd);
  };
};
</script>"""

# 4. Настоящая <form> с action="javascript:void(0)" и onsubmit + fetch.
JS_ACTION_FORM = HEAD + TITLE + """
<div id="root">
<form action="javascript:void(0)" id="f">""" + CONTACT_FIELDS + """
  <label><input name="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form></div>
<script>
""" + FETCH_SEND + """
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  fd.set('agree', e.target.elements.agree.checked ? 'yes' : 'no');
  sendFd(fd);
});
</script>"""

# 5. «Откликнуться» — обычная ссылка на /apply?id=1 того же хоста. Форма там
# настоящая: POST на /api/apply-page, ответ — страница «Спасибо».
LINK_VACANCY = HEAD + TITLE + '<a href="/apply?id=1" class="btn">Откликнуться</a>'
LINK_APPLY = HEAD + """<h1>Отклик на вакансию</h1>
<form method="post" action="/api/apply-page">""" + CONTACT_FIELDS + """
  <label><input name="agree" type="checkbox" value="yes" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form>"""

# 6. Скрытый input file и своя кнопка «Прикрепить резюме».
HIDDEN_FILE = HEAD + TITLE + """
<div id="root">
<form action="javascript:void(0)" id="f">""" + CONTACT_FIELDS + """
  <div class="upload">
    <button type="button" id="pick">Прикрепить резюме</button>
    <span id="fname">файл не выбран</span>
    <input id="cv" name="cv" type="file" style="display:none" required>
  </div>
  <label><input name="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form></div>
<script>
""" + FETCH_SEND + """
document.getElementById('pick').onclick = () => document.getElementById('cv').click();
document.getElementById('cv').onchange = e => {
  document.getElementById('fname').textContent = e.target.files[0] ? e.target.files[0].name : 'файл не выбран';
};
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  fd.set('agree', e.target.elements.agree.checked ? 'yes' : 'no');
  sendFd(fd);
});
</script>"""

# 7. Форма шлёт POST, сервер отвечает 303 на /thanks.
REDIRECT_FORM = HEAD + TITLE + """
<form method="post" action="/api/apply-redirect">""" + CONTACT_FIELDS + """
  <label><input name="agree" type="checkbox" value="yes" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form>"""
THANKS = HEAD + "<h1>Спасибо за отклик</h1><p>Мы свяжемся с вами.</p>"
THANKS_POST = HEAD + "<h1>Спасибо за отклик</h1>"

# 8. Обязательное «Зарплатные ожидания», которого нет в профиле.
SALARY_FORM = HEAD + TITLE + """
<div id="root">
<form action="javascript:void(0)" id="f">""" + CONTACT_FIELDS + """
  <label>Зарплатные ожидания <input name="salary_expectation" required></label>
  <label><input name="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form></div>
<script>
""" + FETCH_SEND + """
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  sendFd(new FormData(e.target));
});
</script>"""

# 9. Сайт сам подсвечивает поле, которое в разметке не обязательное
# (01.10.2026): так 33 сайта из 42 молча не пускали анкету, а Юпитер писал
# «скорее всего, ушёл». Telegram в профиле нет — значит, вопрос человеку.
SITE_FLAG_FORM = HEAD + TITLE + """
<form action="javascript:void(0)" id="f">""" + CONTACT_FIELDS + """
  <label>Telegram <input name="tg" id="tg"></label>
  <span class="field-error" id="tgerr" hidden></span>
  <label><input name="agree" type="checkbox" value="yes" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form>
<script>
""" + FETCH_SEND + """
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const tg = document.getElementById('tg');
  if (!tg.value.trim()) {
    tg.setAttribute('aria-invalid', 'true');
    const err = document.getElementById('tgerr'); err.hidden = false; err.textContent = 'Укажите Telegram';
    return;
  }
  sendFd(new FormData(e.target));
});
</script>"""

# 10. Окно отклика уже в разметке, но скрыто (Orion soft, ФОРС, 02.10.2026):
# в снимок до клика попадают только файл и галочки — «Откликнуться» всё равно
# надо нажать, иначе анкета «не найдена».
HIDDEN_MODAL = HEAD + TITLE + """
<button type="button" id="open">Откликнуться</button>
<div id="root"><div id="dlg" style="display:none">
<form action="javascript:void(0)" id="f">""" + CONTACT_FIELDS + """
  <input id="cv" name="cv" type="file" style="opacity:0;position:absolute;width:1px;height:1px">
  <label><input name="agree" type="checkbox" required> Согласен на обработку персональных данных</label>
  <button type="submit">Отправить отклик</button>
</form></div></div>
<script>
""" + FETCH_SEND + """
document.getElementById('open').onclick = () => { document.getElementById('dlg').style.display = 'block'; };
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  fd.set('agree', e.target.agree.checked ? 'yes' : 'no');
  sendFd(fd);
});
</script>"""


PAGES = {
    "/siteflag": SITE_FLAG_FORM,
    "/wizard": WIZARD,
    "/controlled": CONTROLLED,
    "/modal": MODAL,
    "/jsaction": JS_ACTION_FORM,
    "/linkbtn": LINK_VACANCY,
    "/apply": LINK_APPLY,
    "/hiddenfile": HIDDEN_FILE,
    "/redirect": REDIRECT_FORM,
    "/thanks": THANKS,
    "/salary": SALARY_FORM,
    "/hiddenmodal": HIDDEN_MODAL,
}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in PAGES:
            self._send(200, PAGES[path].encode("utf-8"))
        else:
            self._send(404, b"")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        self.server.state["posts"].append((self.path, raw))
        if self.path == "/api/apply":
            self._send(200, json.dumps({"ok": True}).encode(), "application/json")
        elif self.path == "/api/apply-page":
            self._send(200, THANKS_POST.encode("utf-8"))
        elif self.path == "/api/apply-redirect":
            self._send(303, b"", extra={"Location": "/thanks"})
        else:
            self._send(404, b"")


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class BrowserZooTest(unittest.TestCase):
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
        tmp = Path(self.tmp.name)
        (tmp / "resume.txt").write_text(f"Никита Давыдов\n{RESUME_MARK}\n", encoding="utf-8")
        path = tmp / "profile.json"
        path.write_text(json.dumps(PROFILE, ensure_ascii=False), encoding="utf-8")
        self.profile = CandidateProfile.load(str(path))

    def tearDown(self):
        self.tmp.cleanup()

    # ── помощники ──────────────────────────────────────────────────────────
    def run_site(self, path: str, *, live: bool):
        eng = JupiterBrowserEngine({"127.0.0.1"}, read_only=not live, executable_path=CHROMIUM)
        self.addCleanup(eng.close)
        agent = JupiterAgent({"127.0.0.1"}, engine=eng, dry_run=not live)
        result = agent.run(f"http://127.0.0.1:{self.port}{path}", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        return eng, result, dump

    def posts(self, prefix: str = "/api/apply") -> list[str]:
        out = []
        for p, raw in self.server.state["posts"]:
            if p.startswith(prefix):
                # urlencoded-формы приходят в процентном виде, multipart — как есть
                out.append(urllib.parse.unquote_plus(raw.decode("utf-8", "replace")))
        return out

    def check_live(self, path, *, post_prefix="/api/apply", resume=False, agree=True):
        eng, result, dump = self.run_site(path, live=True)
        self.assertEqual(result.status, "submitted", dump)
        sent = self.posts(post_prefix)
        self.assertEqual(len(sent), 1, dump)
        for value in CONTACT_VALUES:
            self.assertIn(value, sent[0], dump)
        if agree:
            self.assertTrue("yes" in sent[0], dump)
        if resume:
            self.assertIn(RESUME_MARK, sent[0], dump)
        return eng, result

    def check_dry(self, path):
        eng, result, dump = self.run_site(path, live=False)
        self.assertEqual(result.status, "ready_to_submit", dump)
        self.assertEqual(self.server.state["posts"], [], dump)
        return eng, result

    # ── 1. SPA-визард без <form> ───────────────────────────────────────────
    # У полей визарда нет name (только id), как у многих React/Vue-визардов.
    # Движок подставляет name из id — иначе подпись шага (agent._step_signature)
    # у всех экранов одна и агент решает, что «Далее» не сработало.
    def test_1_wizard_live(self):
        self.check_live("/wizard", resume=True)

    def test_1_wizard_dry(self):
        # Первый экран из трёх заполнен, дальше — только настоящий POST, а
        # dry-run его запрещает: агент честно отвечает step_ready, а не
        # ready_to_submit (agent._dry_run_complete). Это верно и не дефект.
        eng, result, dump = self.run_site("/wizard", live=False)
        self.assertEqual(result.status, "step_ready", dump)
        self.assertEqual(self.server.state["posts"], [], dump)

    # ── 2. controlled inputs ───────────────────────────────────────────────
    def test_2_controlled_live(self):
        self.check_live("/controlled")

    def test_2_controlled_dry(self):
        self.check_dry("/controlled")

    # ── 3. модалка с анимацией 600 мс ──────────────────────────────────────
    def test_3_modal_live(self):
        eng, _ = self.check_live("/modal")
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)

    def test_3_modal_dry(self):
        eng, _ = self.check_dry("/modal")
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)

    # ── 4. <form action="javascript:void(0)"> + fetch ──────────────────────
    def test_4_js_action_form_live(self):
        self.check_live("/jsaction")

    def test_4_js_action_form_dry(self):
        self.check_dry("/jsaction")

    # ── 5. «Откликнуться» — ссылка на /apply?id=1 ──────────────────────────
    def test_5_apply_link_live(self):
        self.check_live("/linkbtn", post_prefix="/api/apply-page")

    def test_5_apply_link_dry(self):
        self.check_dry("/linkbtn")

    # ── 6. скрытый input file + своя кнопка ────────────────────────────────
    def test_6_hidden_file_live(self):
        self.check_live("/hiddenfile", resume=True)

    def test_6_hidden_file_dry(self):
        self.check_dry("/hiddenfile")

    # ── 7. редирект на /thanks ─────────────────────────────────────────────
    def test_7_redirect_thanks_live(self):
        _eng, result = self.check_live("/redirect", post_prefix="/api/apply-redirect")
        self.assertTrue(any(i.get("url", "").endswith("/thanks") for i in result.trajectory))

    def test_7_redirect_thanks_dry(self):
        self.check_dry("/redirect")

    # ── 8. неизвестное обязательное поле -> action_required ────────────────
    def _check_salary(self, live: bool):
        _eng, result, dump = self.run_site("/salary", live=live)
        self.assertEqual(result.status, "action_required", dump)
        self.assertEqual(self.server.state["posts"], [], dump)
        # Ничего не выдумано: в поле зарплаты агент не писал.
        for item in result.trajectory:
            if item.get("action") in {"fill", "select", "check", "upload"}:
                text = json.dumps(item, ensure_ascii=False).lower()
                self.assertNotIn("salary", text, dump)
                self.assertNotIn("зарплат", text, dump)

    def test_8_unknown_required_salary_live(self):
        self._check_salary(True)

    def test_8_unknown_required_salary_dry(self):
        self._check_salary(False)


    # ── 9. сайт подсветил поле -> не «скорее всего, ушёл», а вопрос ─────────
    def test_9_site_flagged_field_live(self):
        _eng, result, dump = self.run_site("/siteflag", live=True)
        self.assertEqual(self.server.state["posts"], [], dump)
        self.assertEqual(result.status, "action_required", dump)
        self.assertNotEqual(result.reason_code, "SUCCESS_NOT_CONFIRMED", dump)
        actions = [t.get("action") for t in result.trajectory]
        self.assertIn("site_fix_retry", actions, dump)
        # Ничего не выдумано: в Telegram агент не писал.
        for item in result.trajectory:
            if item.get("action") == "fill":
                self.assertNotIn("tg", json.dumps(item, ensure_ascii=False).lower(), dump)


    # ── 10. скрытое окно с файлом уже в разметке ───────────────────────────
    def test_10_hidden_modal_with_file_dry(self):
        eng, _ = self.check_dry("/hiddenmodal")
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)

    def test_10_hidden_modal_with_file_live(self):
        eng, _ = self.check_live("/hiddenmodal")
        self.assertIn({"action": "apply_click", "label": "Откликнуться"}, eng.actions)

# ── Исход отправки: медленный сервер, «Спасибо» скриптом, соседний хост ─────
# 02.10.2026: почти все отклики кончались «Скорее всего, ушёл». Одна страница,
# сценарий — в ?case=: что отвечает сервер и что потом показывает сайт.
OUTCOME_PAGE = HEAD + TITLE + """
<style>.hid { display: none; } .toast { position: fixed; top: 10px; right: 10px; background: #fff; }</style>
<div id="app">
  <label>Имя <input id="fn"></label>
  <label>Фамилия <input id="ln"></label>
  <label>Email <input id="em" type="email"></label>
  <label>Телефон <input id="ph" type="tel"></label>
  <button type="button" id="send">Отправить отклик</button>
</div>
<div id="thanks" class="hid" role="dialog">Спасибо, ваш отклик отправлен</div>
<script>
const q = new URLSearchParams(location.search);
const c = q.get('case');
const wait = ms => new Promise(r => setTimeout(r, ms));
const post = path => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fn: fn.value, ph: ph.value }) });
const done = text => { document.getElementById('app').innerHTML = '<p>' + text + '</p>'; };
const toast = (text, ms) => { const t = document.createElement('div'); t.className = 'toast';
  t.setAttribute('role', 'status'); t.textContent = text; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms); };
if (c === 'reload' && sessionStorage.getItem('sent')) done('Спасибо, ваша заявка принята');
const send = document.getElementById('send');
if (send) send.onclick = async () => {
  if (c === 'slow_toast') { await post('/api/apply-slow'); toast('Спасибо, отклик получен', 1500); }
  else if (c === 'script_thanks') { await post('/api/apply-ok'); await wait(2000); done('Спасибо, ваша заявка принята'); }
  else if (c === 'hidden_modal') { await post('/api/apply-ok'); await wait(500); document.getElementById('thanks').classList.remove('hid'); }
  else if (c === 'tilda') { await wait(300); done('Спасибо! Данные успешно отправлены'); }
  else if (c === 'status204') { await post('/api/apply-204'); done('Мы свяжемся с вами'); }
  else if (c === 'status204_stays') { await post('/api/apply-204'); }
  else if (c === 'alert') { await wait(300); alert('Спасибо, заявка принята'); }
  else if (c === 'reload') { await post('/api/apply-ok'); await wait(1200); sessionStorage.setItem('sent', '1'); location.reload(); }
  else if (c === 'redir') { const f = document.createElement('form'); f.method = 'post';
    f.action = '/api/redir?to=' + encodeURIComponent(q.get('to')); document.body.appendChild(f); f.submit(); }
  else if (c === 'goto') { await wait(500); location.href = q.get('to'); }
  else if (c === 'err500') { await post('/api/apply-500'); toast('Что-то пошло не так', 1500); }
  else if (c === 'err500_thanks') { await post('/api/apply-500'); done('Спасибо, заявка принята'); }
  else if (c === 'validation') { await post('/api/apply-valid'); toast('Заполните телефон', 1500); }
  else if (c === 'neutral') { await wait(300); done('Мы свяжемся с вами'); }
};
</script>"""

OUTCOME_THANKS = HEAD + "<h1>Готово</h1><p>Спасибо, ваша заявка принята</p>"
# Страница за редиректом: в ней маркер, который не должен попасть ни в снимок,
# ни в траекторию.
OUTCOME_SECRET = HEAD + "<h1>SECRET</h1><p>SECRET внутренняя страница, заявка принята</p>"


class _OutcomeHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        if body:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        self.server.state["gets"].append(path)
        if path == "/s":
            self._send(200, OUTCOME_PAGE.encode(), "text/html; charset=utf-8")
        elif path == "/thanks":
            self._send(200, OUTCOME_THANKS.encode(), "text/html; charset=utf-8")
        elif path == "/secret":
            self._send(200, OUTCOME_SECRET.encode(), "text/html; charset=utf-8")
        else:
            self._send(404)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.state["posts"].append(self.path)
        if self.path.startswith("/api/redir?"):
            # POST → 302: Playwright не вызывает route для редиректов.
            to = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["to"][0]
            self.send_response(302)
            self.send_header("Location", to)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/api/apply-slow":
            time.sleep(3)
            self._send(200, b'{"success": true}')
        elif self.path == "/api/apply-ok":
            self._send(200, b'{"success": true}')
        elif self.path == "/api/apply-204":
            self._send(204)
        elif self.path == "/api/apply-500":
            self._send(500, b'{"error": "boom"}')
        elif self.path == "/api/apply-valid":
            self._send(200, json.dumps({"errors": {"phone": ["неверный"]}}, ensure_ascii=False).encode())
        else:
            self._send(404)


@unittest.skipIf(not RUN, "нужен Playwright и Chromium")
class BrowserSubmitOutcomeTest(unittest.TestCase):
    """Каждый сценарий: подтверждение (submitted), а не «Скорее всего, ушёл»."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _OutcomeHandler)
        cls.server.state = {"posts": [], "gets": []}
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.server.state["posts"].clear()
        self.server.state["gets"].clear()
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "profile.json"
        path.write_text(json.dumps(PROFILE, ensure_ascii=False), encoding="utf-8")
        self.profile = CandidateProfile.load(str(path))

    def tearDown(self):
        self.tmp.cleanup()

    def run_case(self, case, *, host="127.0.0.1", extra="", hosts=None):
        """Страница на host (для поддоменов — *.localhost, Chrome сам отдаёт
        loopback; Python-резолвер подменяем)."""
        from unittest import mock
        import policy
        hosts = hosts or {host}
        with mock.patch.object(policy.NetworkPolicy, "resolve", staticmethod(lambda h: ["127.0.0.1"])):
            eng = JupiterBrowserEngine(hosts, executable_path=CHROMIUM, allow_private_addresses=True)
            self.addCleanup(eng.close)
            agent = JupiterAgent(hosts, engine=eng, dry_run=False)
            result = agent.run(f"http://{host}:{self.port}/s?case={case}{extra}", self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        return eng, result, dump

    def assert_submitted(self, case, **kw):
        eng, result, dump = self.run_case(case, **kw)
        self.assertEqual(result.status, "submitted", dump)
        return eng, result, dump

    def assert_not_submitted(self, case, **kw):
        eng, result, dump = self.run_case(case, **kw)
        self.assertNotEqual(result.status, "submitted", dump)
        return eng, result, dump

    def test_slow_api_3s_then_toast_after_response(self):
        eng, _, dump = self.assert_submitted("slow_toast")
        self.assertEqual(self.server.state["posts"], ["/api/apply-slow"], dump)
        self.assertTrue(eng.last_api_result and eng.last_api_result["api_success"], eng.actions)

    def test_thanks_by_script_after_2s(self):
        self.assert_submitted("script_thanks")

    def test_thanks_modal_hidden_in_dom_and_shown_after_response(self):
        # Окно с «Спасибо» лежало в разметке скрытым классом: в «было до» его
        # быть не должно, форма при этом остаётся на странице.
        eng, result, dump = self.assert_submitted("hidden_modal")
        self.assertTrue(any(i.get("type") == "DOM_TEXT" for item in result.trajectory
                            for i in item.get("evidence", []) if isinstance(i, dict)), dump)

    def test_tilda_like_text_data_sent_successfully(self):
        self.assert_submitted("tilda")

    def test_204_on_submit_path_with_form_gone(self):
        eng, result, dump = self.assert_submitted("status204")
        types = {i.get("type") for item in result.trajectory
                 for i in item.get("evidence", []) if isinstance(i, dict)}
        self.assertIn("API_2XX", types, dump)

    def test_204_alone_while_form_stays_is_not_confirmation(self):
        self.assert_not_submitted("status204_stays")

    def test_alert_text_is_evidence(self):
        eng, _, dump = self.assert_submitted("alert")
        self.assertTrue(any(a.get("action") == "guard_dialog" for a in eng.actions), dump)

    def test_page_reload_during_snapshot_does_not_lose_outcome(self):
        # Страница перезагружается через 1,2 с после ответа — снимок и
        # evaluate попадают в уничтоженный контекст.
        self.assert_submitted("reload")

    def test_thanks_page_on_sibling_subdomain(self):
        to = f"http://thanks.test.localhost:{self.port}/thanks"
        eng, _, dump = self.assert_submitted(
            "goto", host="app.test.localhost", extra=f"&to={urllib.parse.quote(to, safe='')}")
        self.assertFalse(any(a.get("reason") == "host_not_allowed" for a in eng.actions
                             if a.get("action") == "blocked_request"), dump)

    def test_thanks_page_on_foreign_host_is_unknown_not_security_error(self):
        to = f"http://thanks.other.localhost:{self.port}/thanks"
        eng, result, dump = self.run_case(
            "goto", host="app.test.localhost", extra=f"&to={urllib.parse.quote(to, safe='')}")
        self.assertEqual(result.status, "submission_unknown", dump)
        self.assertNotEqual(result.reason_code, "DOMAIN_BLOCKED", dump)
        self.assertTrue(any(a.get("action") == "left_allowed_hosts" for a in eng.actions), eng.actions)
        # Чужой хост по-прежнему закрыт: страница «Спасибо» не загружалась.
        self.assertNotIn("/thanks", self.server.state["gets"], dump)

    def _redirect_case(self, to_host):
        """POST → 302 на to_host: страница старта на app.test.localhost (публичный
        по подмене резолвера), intranet.* резолвится во внутренний адрес."""
        from unittest import mock
        import policy

        def resolve(host):
            return ["10.0.0.5"] if host.startswith("intranet.") else ["93.184.216.34"]

        to = f"http://{to_host}:{self.port}/secret"
        hosts = {"app.test.localhost"}
        with mock.patch.object(policy.NetworkPolicy, "resolve", staticmethod(resolve)):
            eng = JupiterBrowserEngine(hosts, executable_path=CHROMIUM, allow_private_addresses=False)
            self.addCleanup(eng.close)
            agent = JupiterAgent(hosts, engine=eng, dry_run=False)
            result = agent.run(
                f"http://app.test.localhost:{self.port}/s?case=redir&to={urllib.parse.quote(to, safe='')}",
                self.profile)
        dump = json.dumps(result.as_dict(), ensure_ascii=False, indent=1)
        self.assertEqual(result.status, "submission_unknown", dump)
        self.assertNotIn("SECRET", dump)
        self.assertNotIn("SECRET", eng.page.text if eng.page else "")
        self.assertTrue(any(a.get("action") == "left_allowed_hosts" for a in eng.actions), eng.actions)
        self.assertEqual(eng._tab.url, "about:blank")

    def test_post_302_to_internal_host_of_same_site_is_not_snapshotted(self):
        # intranet.test.localhost — «тот же сайт», но резолвится в 10.x.
        self._redirect_case("intranet.test.localhost")

    def test_post_302_to_foreign_host_is_not_snapshotted(self):
        self._redirect_case("thanks.other.localhost")

    def test_error_500_is_not_confirmation(self):
        eng, _, _ = self.assert_not_submitted("err500")
        self.assertTrue(eng.last_api_result and eng.last_api_result["api_error"], eng.actions)

    def test_error_500_beats_thanks_text(self):
        self.assert_not_submitted("err500_thanks")

    def test_validation_error_in_200_is_not_confirmation(self):
        eng, _, _ = self.assert_not_submitted("validation")
        self.assertTrue(eng.last_api_result and eng.last_api_result["api_error"], eng.actions)

    def test_no_form_and_no_confirmation_ends_without_wandering(self):
        eng, result, dump = self.run_case("neutral")
        self.assertEqual(result.status, "submission_unknown", dump)
        # Страницу открыли один раз: ни другой навигации, ни перезагрузки.
        self.assertEqual(self.server.state["gets"], ["/s"], dump)
        self.assertEqual(len(self.server.state["posts"]), 0, dump)

    def test_safe_eval_survives_navigation(self):
        eng = JupiterBrowserEngine({"127.0.0.1"}, executable_path=CHROMIUM, read_only=True)
        self.addCleanup(eng.close)
        eng._tab.goto(f"http://127.0.0.1:{self.port}/s?case=none")
        # Первый вызов попадает на перезагрузку страницы («context was
        # destroyed»), повтор отрабатывает на новом документе.
        got = eng._safe_eval(
            "() => { if (!sessionStorage.getItem('once')) { sessionStorage.setItem('once', '1');"
            " setTimeout(() => location.reload(), 30);"
            " return new Promise(() => {}); } return 'second'; }")
        self.assertEqual(got, "second")
        # И снимок страницы посреди перезагрузок не падает.
        eng._tab.evaluate("setTimeout(() => location.reload(), 30)")
        self.assertIn("Backend", eng._snapshot().text)


if __name__ == "__main__":
    unittest.main()
