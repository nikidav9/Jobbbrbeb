#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from agent import CandidateProfile, JupiterAgent
from engine import EngineSecurityError, JupiterWebEngine
from submission import ReceiptStore
from site_compat import AUDITED_SITES, field_override, trusted_hosts_for


APPLICATION_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Native Engine Test</title>
<h1>Backend Developer</h1>
<form action="/submit" method="post" enctype="multipart/form-data">
  <label>First name <input name="first_name" required></label>
  <label>Фамилия <input name="surname" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Город <input name="city" required></label>
  <label>Сколько лет опыта? <input name="experience_years" required></label>
  <label>Формат работы
    <select name="work_format" required>
      <option value="">Выберите</option>
      <option value="Office">Office</option>
      <option value="Hybrid">Hybrid</option>
      <option value="Remote">Remote</option>
    </select>
  </label>
  <label>Why are you interested in this role?
    <textarea name="motivation" required></textarea>
  </label>
  <label>Resume <input type="file" name="resume" required></label>
  <button type="submit">Submit application</button>
</form>
"""

UNKNOWN_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Unknown Field Test</title>
<form action="/submit" method="post">
  <label>Email <input type="email" name="email" required></label>
  <label>Do you require visa sponsorship? <input name="visa_sponsorship" required></label>
  <button type="submit">Submit application</button>
</form>
"""

JS_ONLY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>JS Careers</title>
<div id="root"></div>
<script>window.renderApplicationForm()</script>
"""


JS_RENDERED_FORM_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Script Render Test</title>
<div id="root"></div>
<script>
document.getElementById('root').innerHTML = `<form id="js-form" action="/submit-js" method="post">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>`;
</script>
"""

JS_INTERCEPT_SUBMIT_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Script Submit Test</title>
<form id="application-form">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>
<div id="success" hidden><h1>Application received</h1><p>Jupiter script success.</p></div>
<script>
const form = document.getElementById('application-form');
form.addEventListener('submit', function(e) {
  e.preventDefault();
  document.getElementById('application-form').hidden = true;
  document.getElementById('success').hidden = false;
});
</script>
"""


JS_FETCH_SUBMIT_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Fetch Submit Test</title>
<form id="network-form">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>
<div id="network-success" hidden><h1>Application received</h1><p>Fetch completed.</p></div>
<script>
const form = document.getElementById('network-form');
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const response = await fetch('/network-submit', {
    method: 'POST',
    body: new FormData(form)
  });
  if (response.ok) {
    document.getElementById('network-form').hidden = true;
    document.getElementById('network-success').hidden = false;
  }
});
</script>
"""

JS_XHR_SUBMIT_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter XHR Submit Test</title>
<form id="xhr-form">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>
<div id="xhr-success" hidden><h1>Application received</h1><p>XHR completed.</p></div>
<script>
const form = document.getElementById('xhr-form');
form.addEventListener('submit', function(e) {
  e.preventDefault();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/xhr-submit');
  xhr.onload = function() {
    document.getElementById('xhr-form').hidden = true;
    document.getElementById('xhr-success').hidden = false;
  };
  xhr.send(new FormData(form));
});
</script>
"""

JS_FETCH_EXTERNAL_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Jupiter Fetch Policy Test</title>
<form id="blocked-form">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Submit application</button>
</form>
<script>
const form = document.getElementById('blocked-form');
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const response = await fetch('http://example.com/apply', {
    method: 'POST',
    body: new FormData(form)
  });
  if (response.ok) {
    document.getElementById('blocked-form').hidden = true;
  }
});
</script>
"""


MODERN_APP_HTML = """<!doctype html>
<meta charset="utf-8">
<meta name="csrf-token" content="csrf-demo-123">
<title>Modern Careers</title>
<form id="modern-form">
  <label>Email <input type="email" name="email" required></label>
  <label>City <input name="city" required></label>
  <button type="submit">Submit application</button>
</form>
<div id="modern-success" hidden>
  <h1>Application received</h1>
  <p>JSON application accepted.</p>
</div>
<script src="/assets/modern-app.js"></script>
"""

MODERN_EXTERNAL_BLOCKED_HTML = """<!doctype html>
<meta charset="utf-8">
<title>External Script Policy</title>
<div id="root"></div>
<script src="http://example.com/evil.js"></script>
"""

MODERN_EXTERNAL_JS = """
const form = document.getElementById('modern-form');
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const response = await fetch('/json-submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
    },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
  const data = await response.json();
  if (data.accepted) {
    document.getElementById('modern-form').hidden = true;
    document.getElementById('modern-success').hidden = false;
  }
});
"""

# ── Один отклик — один раз, и «двести» не значит «принято» ──────────────────

DUP_APPLY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Анкета</title>
<form id="application-form" action="/dup-submit" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="last_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <button type="submit">Откликнуться</button>
</form>
"""

DROP_APPLY_HTML = DUP_APPLY_HTML.replace("/dup-submit", "/drop-submit")

# Двести, та же форма и ни слова о принятой заявке. Ровно так выглядит
# молчаливый отказ на стороне работодателя.
SILENT_REJECT_HTML = DUP_APPLY_HTML.replace("/dup-submit", "/silent-submit")


# ── SPA: формы нет в разметке, но адрес анкеты лежит в состоянии ────────────

SPA_VACANCY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Кассир — вакансия</title>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"vacancy":{"id":"777","title":"Кассир",
"applyUrl":"/spa-apply"}}},"page":"/vacancy/[id]"}
</script>
<script>var hydrate=1;</script>
"""

SPA_APPLY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Анкета</title>
<form id="application-form" action="/never-submit" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="last_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <button type="submit">Откликнуться</button>
</form>
"""

SPA_DEAD_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Кассир — вакансия</title>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"vacancy":{"id":"777","title":"Кассир",
"salary":"60000","city":"Москва"}}}}
</script>
<script>var hydrate=1;</script>
"""

SPA_EXTERNAL_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Кассир — вакансия</title>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"vacancy":{"applyUrl":"http://example.com/apply/777"}}}}
</script>
<script>var hydrate=1;</script>
"""


# ── Многошаговая анкета: «Далее» — не «Отправить» ───────────────────────────

WIZARD_STEP1_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Отклик, шаг 1</title>
<h1>Анкета кандидата</h1>
<form id="application-form" action="/wizard-next" method="post">
  <input type="hidden" name="step" value="1">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="surname" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <button type="submit">Далее</button>
</form>
"""

WIZARD_STEP2_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Отклик, шаг 2</title>
<h1>Анкета кандидата</h1>
<form id="application-form" action="/wizard-next" method="post">
  <input type="hidden" name="step" value="2">
  <label>Город <input name="city" required></label>
  <label>Опыт, лет <input name="experience_years" required></label>
  <label>Формат работы <input name="work_format"></label>
  <button type="submit">Далее</button>
</form>
"""

WIZARD_STEP3_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Отклик, шаг 3</title>
<h1>Анкета кандидата</h1>
<form id="application-form" action="/wizard-submit" method="post">
  <input type="hidden" name="step" value="3">
  <label>Сопроводительное письмо
    <textarea name="motivation" required></textarea>
  </label>
  <button type="submit">Отправить заявку</button>
</form>
"""

WIZARD_STUCK_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Отклик, шаг без продолжения</title>
<h1>Анкета кандидата</h1>
<form id="application-form" action="/wizard-stuck-next" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="surname" required></label>
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Далее</button>
</form>
"""


# ── Формы, на которых Jupiter спотыкался до Semantic Form Engine v2 ──────────

TWO_BUTTONS_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Two buttons</title>
<form action="/draft" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Фамилия <input name="surname" required></label>
  <label>Email <input type="email" name="email" required></label>
  <button type="submit" name="act" value="draft">Сохранить черновик</button>
  <button type="submit" name="act" value="apply" formaction="/apply-now">Откликнуться</button>
</form>
"""

BASE_HREF_HTML = """<!doctype html>
<meta charset="utf-8">
<base href="BASE_PLACEHOLDER">
<title>Base href</title>
<form action="apply-now" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Откликнуться</button>
</form>
"""

FIELDSET_OFF_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Fieldset off</title>
<form action="/never-submit" method="post">
  <fieldset><legend>Контакты</legend>
    <label>Имя <input name="first_name" required></label>
    <label>Фамилия <input name="last_name" required></label>
    <label>Телефон <input type="tel" name="phone" required></label>
    <label>Email <input type="email" name="email" required></label>
  </fieldset>
  <fieldset disabled><legend>Только для водителей</legend>
    <label>Категория прав <input name="licence_category" required></label>
    <label>Стаж вождения <input name="driving_years" required></label>
  </fieldset>
  <button type="submit">Откликнуться</button>
</form>
"""

BAD_PATTERN_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Strict phone</title>
<form action="/never-submit" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Телефон <input name="phone" required pattern="[0-9]{11}"></label>
  <button type="submit">Откликнуться</button>
</form>
"""

MULTI_SELECT_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Multi select</title>
<form action="/echo-submit" method="post">
  <label>Имя <input name="first_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Смены
    <select name="shifts" multiple>
      <option value="day" selected>День</option>
      <option value="night" selected>Ночь</option>
      <option value="mixed">Смешанный</option>
    </select>
  </label>
  <button type="submit">Откликнуться</button>
</form>
"""


PROFILE = {
    "first_name": "Nikita",
    "last_name": "Davydov",
    "email": "nikita.demo@reply.jobtoo.ru",
    "phone": "+79990000000",
    "city": "Москва",
    "patronymic": "Александрович",
    "birth_date": "09.05.1995",
    "citizenship": "Россия",
    "education": "Высшее",
    "desired_role": "Кассир",
    "employment": "Полная",
    "consent": True,
    "has_car": False,
    "experience_years": "4",
    "work_format": "Hybrid",
    "cover_letter": "Мне интересна роль, потому что мой опыт соответствует задачам команды.",
    "resume_path": "resume.txt",
}


SLATA_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Slata-like application</title>
<form action="/never-submit" method="post" enctype="multipart/form-data">
  <label>Фамилия <input name="last_name" required></label>
  <label>Имя <input name="first_name" required></label>
  <label>Отчество <input name="patronymic" required></label>
  <label>Дата рождения <input type="date" name="birthday" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Гражданство <input name="citizenship"></label>
  <label>Образование
    <select name="education" required>
      <option value="">Выберите</option>
      <option value="higher">Высшее</option>
      <option value="middle">Среднее</option>
    </select>
  </label>
  <label>Комментарий <textarea name="comment" required></textarea></label>
  <label>Ссылка на резюме <input type="url" name="cv_url" required></label>
  <label>Файл резюме <input type="file" name="cv_file"></label>
  <label><input type="checkbox" name="agreedPersonalData" required> Согласие на обработку персональных данных</label>
  <textarea name="g-recaptcha-response" required></textarea>
  <div class="g-recaptcha"></div>
  <button type="submit">Откликнуться</button>
</form>
"""

CDEK_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>CDEK-like application</title>
<form action="/never-submit" method="post" enctype="multipart/form-data">
  <label>ФИО <input name="name" required></label>
  <label>Телефон <input type="tel" name="phone" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Город <input name="city" required></label>
  <label>Комментарий <textarea name="comment"></textarea></label>
  <label>Ссылка на резюме <input name="brief_link" required></label>
  <label>Резюме <input type="file" name="brief"></label>
  <button type="submit">Отправить отклик</button>
</form>
"""

REACT_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>React-like application</title>
<form id="application-form">
  <input name="lastName" placeholder="Фамилия">
  <input name="firstName" placeholder="Имя">
  <input type="email" name="email" placeholder="Email">
  <input type="tel" name="phone" placeholder="Телефон">
  <textarea name="comment" placeholder="Комментарий"></textarea>
  <input type="file">
  <label><input type="checkbox" name="agreedReservation"> Согласен</label>
  <label><input type="checkbox" name="agreedPersonalData"> Персональные данные</label>
</form>
<script>window.__NEXT_DATA__ = {"page":"apply"};</script>
"""


VKUSVILL_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>VkusVill-like form</title>
<form action="/never-submit" method="post">
  <input name="JOB_STORE_NAME" required>
  <input name="NAME" required>
  <input type="date" name="BORN" required>
  <input type="tel" name="PHONE" required>
  <input name="CITIZENSHIP" required>
  <input name="METRO">
  <label><input type="radio" name="HAS_CAR" value="Да" required>Да</label>
  <label><input type="radio" name="HAS_CAR" value="Нет" required>Нет</label>
  <label><input type="checkbox" name="JOB_POLICY_AGREE" required>Согласие на обработку данных</label>
  <button type="submit">Отправить</button>
</form>
"""

LEMANA_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Lemana-like form</title>
<form action="/never-submit" method="post" enctype="multipart/form-data">
  <input name="firstName" autocomplete="given-name" required>
  <input name="lastName" autocomplete="family-name" required>
  <input type="tel" name="phone" required>
  <input type="email" name="email" required>
  <input type="file" name="resumeFiles[]" required>
  <input type="url" name="resumeUrl">
  <textarea name="comment"></textarea>
  <label><input type="checkbox" name="consent" required>Я согласен на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>
"""

TEREMOK_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Teremok-like form</title>
<form action="/never-submit" method="post" enctype="multipart/form-data">
  <input name="PROPERTY[NAME][0]" required>
  <input type="tel" name="PROPERTY[101][0]" required>
  <input name="PROPERTY[104][0]" required>
  <label><input type="checkbox" name="PROPERTY[105]" required>Согласие на обработку персональных данных</label>
  <input type="file" name="PROPERTY_FILE_106_0">
  <button type="submit">Отправить анкету</button>
</form>
"""

COFFEEMANIA_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Coffeemania-like form</title>
<form action="/never-submit" method="post">
  <select name="vacancy" required>
    <option value="">Выберите</option>
    <option value="cashier">Кассир</option>
  </select>
  <input name="lastname" required>
  <input name="firstname" required>
  <input type="tel" name="phone" required>
  <input type="email" name="email" required>
  <input name="citizenship" required>
  <label><input type="checkbox" name="agree" required>Согласие на обработку персональных данных</label>
  <button type="submit">Отправить</button>
</form>
"""

DODO_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Dodo-like form</title>
<form action="/never-submit" method="post">
  <input name="name" required>
  <input name="lastname" required>
  <input type="date" name="date" required>
  <input type="tel" name="phone" required>
  <input type="email" name="email" required>
  <button type="submit">Откликнуться</button>
</form>
"""

MEGAFON_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Megafon-like form</title>
<form id="apply-form">
  <input name="lastName" required>
  <input name="firstName" required>
  <input type="email" name="email" required>
  <input type="tel" name="phone" required>
  <textarea name="comment"></textarea>
  <label><input type="checkbox" name="agreedReservation">Добавить в кадровый резерв</label>
  <label><input type="checkbox" name="agreedPersonalData" required>Согласие на обработку персональных данных</label>
  <button type="submit">Откликнуться</button>
</form>
"""

FORM_ATTR_DRY_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Form attribute</title>
<form id="external-form" action="/never-submit" method="post"></form>
<label>Email <input form="external-form" type="email" name="email" required></label>
<label>Формат
  <input form="external-form" type="radio" name="work_format" value="Office" required>Office
  <input form="external-form" type="radio" name="work_format" value="Hybrid" required>Hybrid
</label>
<button form="external-form" type="submit">Apply</button>
"""


class CareersHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _html(self, body: str, status: int = 200, headers: dict[str, str] | None = None):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        # Отрезаем строку запроса: рекламные метки в адресе не должны делать
        # из знакомой страницы незнакомую.
        self.path = self.path.split("?", 1)[0]
        if self.path == "/application":
            return self._html(APPLICATION_HTML, headers={"Set-Cookie": "jt_e2e=1; Path=/"})
        if self.path == "/unknown":
            return self._html(UNKNOWN_HTML)
        if self.path == "/js-only":
            return self._html(JS_ONLY_HTML)
        if self.path == "/js-rendered":
            return self._html(JS_RENDERED_FORM_HTML)
        if self.path == "/js-intercept":
            return self._html(JS_INTERCEPT_SUBMIT_HTML)
        if self.path == "/js-fetch":
            return self._html(
                JS_FETCH_SUBMIT_HTML,
                headers={"Set-Cookie": "jt_network=1; Path=/"},
            )
        if self.path == "/js-xhr":
            return self._html(JS_XHR_SUBMIT_HTML)
        if self.path == "/js-fetch-external":
            return self._html(JS_FETCH_EXTERNAL_HTML)
        if self.path == "/modern-app":
            return self._html(MODERN_APP_HTML)
        if self.path == "/modern-external-blocked":
            return self._html(MODERN_EXTERNAL_BLOCKED_HTML)
        if self.path == "/dry-slata":
            return self._html(SLATA_DRY_HTML)
        if self.path == "/dry-cdek":
            return self._html(CDEK_DRY_HTML)
        if self.path == "/dry-react":
            return self._html(REACT_DRY_HTML)
        if self.path == "/assets/modern-app.js":
            body = MODERN_EXTERNAL_JS.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/dup-apply":
            return self._html(DUP_APPLY_HTML)
        if self.path == "/drop-apply":
            return self._html(DROP_APPLY_HTML)
        if self.path == "/silent-apply":
            return self._html(SILENT_REJECT_HTML)
        if self.path == "/spa-vacancy":
            return self._html(SPA_VACANCY_HTML)
        if self.path == "/spa-apply":
            return self._html(SPA_APPLY_HTML)
        if self.path == "/spa-dead":
            return self._html(SPA_DEAD_HTML)
        if self.path == "/spa-external":
            return self._html(SPA_EXTERNAL_HTML)
        if self.path == "/wizard":
            return self._html(WIZARD_STEP1_HTML)
        if self.path == "/wizard-stuck":
            return self._html(WIZARD_STUCK_HTML)
        if self.path == "/two-buttons":
            return self._html(TWO_BUTTONS_HTML)
        if self.path == "/fieldset-off":
            return self._html(FIELDSET_OFF_HTML)
        if self.path == "/bad-pattern":
            return self._html(BAD_PATTERN_HTML)
        if self.path == "/multi-select":
            return self._html(MULTI_SELECT_HTML)
        if self.path == "/nested/base-href":
            base = f"http://127.0.0.1:{self.server.server_address[1]}/nested/"
            return self._html(BASE_HREF_HTML.replace("BASE_PLACEHOLDER", base))
        if self.path == "/redirect-external":
            self.send_response(302)
            self.send_header("Location", "http://example.com/application")
            self.end_headers()
            return
        self._html("<h1>Not found</h1>", 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        if self.path == "/dup-submit":
            self.server.state["dup_posts"] += 1
            return self._html("<h1>Application received</h1><p>Спасибо за отклик.</p>")

        if self.path == "/silent-submit":
            # Двести и та же форма обратно: сервер не принял, но и не сказал.
            self.server.state["silent_posts"] += 1
            return self._html(SILENT_REJECT_HTML)

        if self.path == "/drop-submit":
            # Тело прочитано — значит запрос дошёл, — и связь рвётся без
            # ответа. Исход неизвестен, и повторять POST нельзя.
            self.server.state["drop_posts"] += 1
            self.close_connection = True
            try:
                self.connection.close()
            except OSError:
                pass
            return

        if self.path == "/wizard-next":
            self.server.state["wizard_posts"].append(self.path)
            if b"step=1" in body:
                return self._html(WIZARD_STEP2_HTML)
            if b"step=2" in body:
                return self._html(WIZARD_STEP3_HTML)
            return self._html("<h1>Unexpected wizard step</h1>", 400)

        if self.path == "/wizard-submit":
            self.server.state["wizard_posts"].append(self.path)
            self.server.state["wizard_final_body"] = body
            if b"step=3" not in body or b"motivation=" not in body:
                return self._html("<h1>Bad wizard payload</h1>", 400)
            return self._html("<h1>Application received</h1><p>Спасибо за отклик.</p>")

        if self.path == "/wizard-stuck-next":
            # Тот же шаг обратно: так ведёт себя форма, которую сервер не принял.
            self.server.state["wizard_posts"].append(self.path)
            return self._html(WIZARD_STUCK_HTML)

        if self.path in {"/draft", "/apply-now", "/nested/apply-now", "/echo-submit"}:
            self.server.state["echo_path"] = self.path
            self.server.state["echo_body"] = body
            return self._html("<h1>Application received</h1><p>Спасибо за отклик.</p>")

        if self.path == "/json-submit":
            self.server.state["json_post_count"] += 1
            self.server.state["last_json_body"] = body
            self.server.state["last_json_csrf"] = self.headers.get(
                "X-CSRF-Token",
                "",
            )
            self.server.state["last_json_content_type"] = self.headers.get(
                "Content-Type",
                "",
            )
            try:
                payload = json.loads(body.decode("utf-8"))
            except Exception:
                payload = {}
            accepted = (
                "application/json"
                in self.server.state["last_json_content_type"]
                and self.server.state["last_json_csrf"] == "csrf-demo-123"
                and payload.get("email") == "nikita.demo@reply.jobtoo.ru"
                and payload.get("city") == "Москва"
            )
            response = json.dumps(
                {"accepted": accepted},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200 if accepted else 400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return

        if self.path == "/network-submit":
            self.server.state["network_post_count"] += 1
            self.server.state["last_network_body"] = body
            self.server.state["last_network_cookie"] = self.headers.get("Cookie", "")
            self.server.state["last_network_content_type"] = self.headers.get(
                "Content-Type",
                "",
            )
            if "jt_network=1" not in self.server.state["last_network_cookie"]:
                return self._html("<h1>Network cookie missing</h1>", 400)
            if (
                "multipart/form-data"
                not in self.server.state["last_network_content_type"]
                or b'name="email"' not in body
                or b"nikita.demo%40" in body
            ):
                return self._html("<h1>Bad network application payload</h1>", 400)
            return self._html("network accepted")

        if self.path == "/xhr-submit":
            self.server.state["xhr_post_count"] += 1
            self.server.state["last_xhr_body"] = body
            if b'name="email"' not in body:
                return self._html("<h1>Bad XHR payload</h1>", 400)
            return self._html("xhr accepted")

        if self.path == "/submit-js":
            self.server.state["js_post_count"] += 1
            self.server.state["last_js_body"] = body
            if b"email=" not in body:
                return self._html("<h1>Bad JS application payload</h1>", 400)
            return self._html("<h1>Application received</h1><p>JS-rendered form submitted.</p>")

        if self.path != "/submit":
            return self._html("<h1>Not found</h1>", 404)

        self.server.state["post_count"] += 1
        self.server.state["last_body"] = body
        self.server.state["last_content_type"] = self.headers.get("Content-Type", "")
        self.server.state["last_cookie"] = self.headers.get("Cookie", "")

        if "jt_e2e=1" not in self.server.state["last_cookie"]:
            return self._html("<h1>Cookie missing</h1>", 400)

        required = [
            b'name="first_name"',
            b'name="surname"',
            b'name="email"',
            b'name="phone"',
            b'name="city"',
            b'name="experience_years"',
            b'name="work_format"',
            b'name="motivation"',
            b'name="resume"',
            b"Jupiter test resume",
        ]
        if not all(marker in body for marker in required):
            return self._html("<h1>Bad application payload</h1>", 400)

        return self._html("<h1>Application received</h1><p>Thank you for applying.</p>")


class JupiterNativeE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), CareersHandler)
        cls.server.state = {
            "post_count": 0,
            "last_body": b"",
            "last_content_type": "",
            "last_cookie": "",
            "js_post_count": 0,
            "last_js_body": b"",
            "network_post_count": 0,
            "last_network_body": b"",
            "last_network_cookie": "",
            "last_network_content_type": "",
            "xhr_post_count": 0,
            "last_xhr_body": b"",
            "json_post_count": 0,
            "last_json_body": b"",
            "last_json_csrf": "",
            "last_json_content_type": "",
            "echo_path": "",
            "echo_body": b"",
            "wizard_posts": [],
            "wizard_final_body": b"",
            "dup_posts": 0,
            "drop_posts": 0,
            "silent_posts": 0,
        }
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def profile(self, tmp: Path) -> CandidateProfile:
        (tmp / "resume.txt").write_text(
            "Jupiter test resume\nNikita Davydov\n",
            encoding="utf-8",
        )
        profile_path = tmp / "profile.json"
        profile_path.write_text(
            json.dumps(PROFILE, ensure_ascii=False),
            encoding="utf-8",
        )
        return CandidateProfile.load(str(profile_path))

    def run_path(
        self,
        path: str,
        *,
        dry_run: bool = False,
        receipts=None,
    ):
        with tempfile.TemporaryDirectory() as tmp_dir:
            profile = self.profile(Path(tmp_dir))
            agent = JupiterAgent(
                {"127.0.0.1"},
                dry_run=dry_run,
                receipts=receipts,
            )
            result = agent.run(
                f"http://127.0.0.1:{self.port}{path}",
                profile,
            )
            return result, agent

    # ── Безопасность отправки ───────────────────────────────────────────────

    def test_the_same_application_is_not_sent_twice(self):
        store = ReceiptStore()
        self.server.state["dup_posts"] = 0
        first, _ = self.run_path("/dup-apply", receipts=store)
        self.assertEqual(first.status, "submitted", first.reason)

        second, _ = self.run_path("/dup-apply", receipts=store)
        self.assertEqual(second.status, "duplicate", second.reason)
        self.assertEqual(second.reason_code, "DUPLICATE_BLOCKED")
        # Главное здесь — счётчик. Повторный отклик виден человеку на той
        # стороне и выглядит как спам.
        self.assertEqual(self.server.state["dup_posts"], 1)

    def test_campaign_link_does_not_defeat_the_duplicate_guard(self):
        store = ReceiptStore()
        self.server.state["dup_posts"] = 0
        first, _ = self.run_path("/dup-apply", receipts=store)
        self.assertEqual(first.status, "submitted", first.reason)

        second, _ = self.run_path(
            "/dup-apply?utm_source=mail&gclid=xyz", receipts=store
        )
        self.assertEqual(second.status, "duplicate", second.reason)
        self.assertEqual(self.server.state["dup_posts"], 1)

    def test_receipt_survives_between_runs_through_a_file(self):
        self.server.state["dup_posts"] = 0
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = str(Path(tmp_dir) / "receipts.json")
            first, _ = self.run_path("/dup-apply", receipts=ReceiptStore(path))
            self.assertEqual(first.status, "submitted", first.reason)
            # Новый ReceiptStore = новый запуск процесса.
            second, _ = self.run_path("/dup-apply", receipts=ReceiptStore(path))
            self.assertEqual(second.status, "duplicate", second.reason)
        self.assertEqual(self.server.state["dup_posts"], 1)

    def test_dropped_connection_is_unknown_not_failed(self):
        store = ReceiptStore()
        self.server.state["drop_posts"] = 0
        result, _ = self.run_path("/drop-apply", receipts=store)
        self.assertEqual(result.status, "submission_unknown", result.reason)
        self.assertEqual(result.reason_code, "SUBMISSION_UNKNOWN")
        # Ровно один POST: проверка исхода идётGET-ом, который ничего не создаёт.
        self.assertEqual(self.server.state["drop_posts"], 1)
        actions = [item.get("action") for item in result.trajectory]
        self.assertIn("submission_unknown", actions)
        self.assertNotIn("success_detected", actions)

    def test_unknown_outcome_is_never_retried_with_a_post(self):
        store = ReceiptStore()
        self.server.state["drop_posts"] = 0
        self.run_path("/drop-apply", receipts=store)
        second, _ = self.run_path("/drop-apply", receipts=store)
        self.assertEqual(second.status, "submission_unknown", second.reason)
        self.assertEqual(second.reason_code, "SUBMISSION_UNKNOWN")
        self.assertEqual(self.server.state["drop_posts"], 1)

    def test_http_200_with_the_same_form_is_not_a_submitted_application(self):
        self.server.state["silent_posts"] = 0
        result, _ = self.run_path("/silent-apply")
        self.assertNotEqual(result.status, "submitted")
        self.assertEqual(result.reason_code, "SUCCESS_NOT_CONFIRMED")
        self.assertEqual(self.server.state["silent_posts"], 1)
        verdicts = [
            item for item in result.trajectory
            if item.get("action") == "verify_submission"
        ]
        self.assertTrue(verdicts)
        self.assertFalse(verdicts[-1]["confirmed"])
        # HTTP-ответ в доказательствах есть, но веса не имеет.
        http = [
            e for e in verdicts[-1]["evidence"] if e["type"] == "HTTP_RESPONSE"
        ]
        self.assertEqual(http[0]["confidence"], 0.0)

    # ── SPA: состояние страницы вместо разметки ─────────────────────────────

    def test_apply_link_is_taken_from_next_data_when_markup_has_none(self):
        before = self.server.state["post_count"]
        result, _agent = self.run_path("/spa-vacancy", dry_run=True)
        # Раньше здесь был тупик UNSUPPORTED_SCRIPT: ссылки на анкету в
        # разметке нет, её дорисовывает браузер. Адрес при этом лежал открытым
        # текстом в __NEXT_DATA__.
        self.assertEqual(result.status, "ready_to_submit", result.reason)
        self.assertEqual(self.server.state["post_count"], before)
        navigations = [
            item for item in result.trajectory if item.get("action") == "navigate"
        ]
        self.assertTrue(navigations)
        self.assertEqual(navigations[0]["found_in"], "spa_state")
        self.assertTrue(navigations[0]["url"].endswith("/spa-apply"))

    def test_state_without_an_application_link_is_an_honest_dead_end(self):
        result, _agent = self.run_path("/spa-dead", dry_run=True)
        self.assertEqual(result.status, "action_required", result.reason)
        self.assertEqual(result.reason_code, "UNSUPPORTED_SCRIPT")
        # Видно, что состояние читали, а не просто сдались на слове «script».
        handoff = [
            item for item in result.trajectory
            if item.get("action") == "action_required"
        ][-1]
        self.assertEqual(handoff["spa_payloads"], ["next_data"])
        self.assertIn("embedded state was read", result.reason)

    def test_state_cannot_send_jupiter_to_an_unallowed_host(self):
        # Состояние страницы — данные работодателя, а не разрешение. Адрес
        # оттуда проходит ту же проверку хоста, что и обычная ссылка.
        result, _agent = self.run_path("/spa-external", dry_run=True)
        self.assertEqual(result.status, "action_required", result.reason)
        self.assertEqual(result.reason_code, "UNSUPPORTED_SCRIPT")
        self.assertEqual(
            [item.get("url") for item in result.trajectory
             if item.get("action") == "navigate"],
            [],
        )

    def test_json_data_block_is_not_treated_as_a_program(self):
        # <script type="application/json"> браузер не исполняет. Считать его
        # неподдерживаемой программой — значит объявить негодной всякую
        # Next-страницу, где такой блок есть всегда.
        data_only = (
            '<div id="__next"></div>'
            '<script id="__NEXT_DATA__" type="application/json">'
            '{"props":{"pageProps":{"id":"7"}}}</script>'
            '<script type="application/ld+json">{"@type":"JobPosting"}</script>'
        )
        engine = JupiterWebEngine({"127.0.0.1"}, read_only=True)
        page = engine.load_html(data_only, "http://127.0.0.1/spa-dead")
        self.assertTrue(page.has_script)
        self.assertFalse(page.script_unsupported)

    # ── Многошаговая анкета ─────────────────────────────────────────────────

    def test_three_step_form_is_walked_to_the_end_and_only_then_submitted(self):
        self.server.state["wizard_posts"] = []
        result, _agent = self.run_path("/wizard")
        self.assertEqual(result.status, "submitted", result.reason)
        self.assertEqual(
            self.server.state["wizard_posts"],
            ["/wizard-next", "/wizard-next", "/wizard-submit"],
        )
        actions = [item.get("action") for item in result.trajectory]
        # Два перехода и ровно одна отправка. Если «Далее» считать отправкой,
        # отклик будет засчитан трижды и ни разу по делу.
        self.assertEqual(actions.count("click_next"), 2)
        self.assertEqual(actions.count("click_submit"), 1)
        self.assertEqual(actions.count("http_submit"), 1)
        self.assertEqual(actions.count("http_step"), 2)
        self.assertIn("success_detected", actions)
        # Шаги пронумерованы, и номер растёт.
        steps = [
            item["step_index"] for item in result.trajectory
            if item.get("action") == "target_form"
        ]
        self.assertEqual(steps, [0, 1, 2])
        self.assertIn(b"motivation=", self.server.state["wizard_final_body"])

    def test_dry_run_reports_a_step_not_readiness_on_a_multi_step_form(self):
        self.server.state["wizard_posts"] = []
        result, _agent = self.run_path("/wizard", dry_run=True)
        # Честный ответ: первый экран заполнен, но анкета продолжается, а
        # пройти дальше без настоящей отправки нельзя.
        self.assertEqual(result.status, "step_ready", result.reason)
        self.assertEqual(result.reason_code, "MULTI_STEP_DRY_RUN_LIMIT")
        self.assertEqual(self.server.state["wizard_posts"], [])
        actions = [item.get("action") for item in result.trajectory]
        self.assertIn("step_ready", actions)
        self.assertNotIn("ready_to_submit", actions)
        self.assertNotIn("click_next", actions)
        self.assertNotIn("click_submit", actions)

    def test_single_step_form_still_reports_ready_to_submit_in_dry_run(self):
        # Проверка на то, что новый статус не расползся на обычные анкеты.
        result, _agent = self.run_path("/dry-cdek", dry_run=True)
        self.assertEqual(result.status, "ready_to_submit", result.reason)
        self.assertIsNone(result.reason_code)

    def test_step_that_returns_the_same_step_is_reported_not_retried(self):
        self.server.state["wizard_posts"] = []
        result, _agent = self.run_path("/wizard-stuck")
        self.assertEqual(result.status, "action_required", result.reason)
        self.assertEqual(result.reason_code, "STEP_DID_NOT_ADVANCE")
        # Один раз попробовали и остановились, а не заспамили работодателя.
        self.assertEqual(self.server.state["wizard_posts"], ["/wizard-stuck-next"])
        self.assertNotIn(
            "success_detected",
            [item.get("action") for item in result.trajectory],
        )

    # ── Semantic Form Engine v2 ─────────────────────────────────────────────

    def test_apply_button_wins_over_draft_and_its_formaction_is_used(self):
        self.server.state["echo_path"] = ""
        result, _agent = self.run_path("/two-buttons")
        self.assertEqual(result.status, "submitted", result.reason)
        # Адрес формы — /draft. Взять его вместо formaction значило бы
        # сохранить черновик и отчитаться об отклике.
        self.assertEqual(self.server.state["echo_path"], "/apply-now")
        self.assertIn(b"act=apply", self.server.state["echo_body"])
        self.assertNotIn(b"act=draft", self.server.state["echo_body"])

    def test_relative_action_follows_base_href(self):
        self.server.state["echo_path"] = ""
        result, _agent = self.run_path("/nested/base-href")
        self.assertEqual(result.status, "submitted", result.reason)
        self.assertEqual(self.server.state["echo_path"], "/nested/apply-now")

    def test_required_fields_of_a_disabled_fieldset_do_not_block_the_run(self):
        # Браузер такие поля не отправляет и обязательными не считает. Раньше
        # Jupiter считал — и упирался в action_required на ровном месте.
        before = self.server.state["post_count"]
        result, _agent = self.run_path("/fieldset-off", dry_run=True)
        self.assertEqual(result.status, "ready_to_submit", result.reason)
        self.assertEqual(self.server.state["post_count"], before)
        actions = [item.get("action") for item in result.trajectory]
        self.assertIn("ready_to_submit", actions)
        filled = [
            item.get("field", "")
            for item in result.trajectory
            if item.get("action") == "fill"
        ]
        self.assertFalse(
            any("категория" in field.lower() for field in filled),
            filled,
        )

    def test_value_rejected_by_html_pattern_stops_before_submit(self):
        before = self.server.state["post_count"]
        result, _agent = self.run_path("/bad-pattern", dry_run=True)
        self.assertEqual(result.status, "action_required", result.reason)
        self.assertEqual(result.reason_code, "VALIDATION_FAILED")
        self.assertEqual(self.server.state["post_count"], before)
        issue_actions = [
            item for item in result.trajectory
            if item.get("action") == "validation_failed"
        ]
        self.assertTrue(issue_actions)
        rules = [issue["rule"] for issue in issue_actions[0]["issues"]]
        self.assertIn("pattern", rules)
        self.assertNotIn(
            "ready_to_submit",
            [item.get("action") for item in result.trajectory],
        )

    def test_multiple_select_sends_every_selected_option(self):
        self.server.state["echo_body"] = b""
        result, _agent = self.run_path("/multi-select")
        self.assertEqual(result.status, "submitted", result.reason)
        body = self.server.state["echo_body"]
        self.assertIn(b"shifts=day", body)
        self.assertIn(b"shifts=night", body)
        self.assertNotIn(b"shifts=mixed", body)

    def test_dry_run_fills_captcha_form_without_submitting(self):
        before = self.server.state["post_count"]
        result, agent = self.run_path("/dry-slata", dry_run=True)
        self.assertEqual(
            result.status,
            "ready_to_submit",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["post_count"], before)
        actions = [item["action"] for item in result.trajectory]
        self.assertIn("upload", actions)
        self.assertIn("check", actions)
        self.assertIn("ready_to_submit", actions)
        self.assertNotIn("click_submit", actions)
        self.assertIn("CAPTCHA", result.reason or "")
        snapshot = agent.engine.semantic_snapshot()
        controls = snapshot["controls"]
        values = {item["name"]: item for item in controls if item["name"]}
        self.assertEqual(values["birthday"]["value"], "1995-05-09")
        self.assertTrue(values["agreedPersonalData"]["checked"])
        self.assertTrue(values["cv_file"]["file_attached"])
        self.assertEqual(values["cv_url"]["value"], "")

    def test_dry_run_accepts_resume_file_instead_of_required_resume_link(self):
        result, agent = self.run_path("/dry-cdek", dry_run=True)
        self.assertEqual(
            result.status,
            "ready_to_submit",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        controls = agent.engine.semantic_snapshot()["controls"]
        values = {item["name"]: item for item in controls if item["name"]}
        self.assertTrue(values["brief"]["file_attached"])
        self.assertEqual(values["brief_link"]["value"], "")
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

    def test_dry_run_fills_server_rendered_react_fields_without_submit(self):
        result, agent = self.run_path("/dry-react", dry_run=True)
        self.assertEqual(
            result.status,
            "ready_to_submit",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        controls = agent.engine.semantic_snapshot()["controls"]
        values = {item["name"]: item for item in controls if item["name"]}
        self.assertEqual(values["firstName"]["value"], "Nikita")
        self.assertEqual(values["lastName"]["value"], "Davydov")
        self.assertEqual(values["email"]["value"], "nikita.demo@reply.jobtoo.ru")
        self.assertTrue(values["agreedPersonalData"]["checked"])
        self.assertFalse(values["agreedReservation"]["checked"])
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

    def test_audited_site_specific_patterns_fill_without_submit(self):
        cases = [
            (
                "https://vkusvill.ru/job/prodavets-konsultant.html",
                VKUSVILL_DRY_HTML,
                {
                    "JOB_STORE_NAME": "Кассир",
                    "NAME": "Davydov Nikita Александрович",
                    "BORN": "1995-05-09",
                    "PHONE": "+79990000000",
                    "CITIZENSHIP": "Россия",
                },
                {"JOB_POLICY_AGREE": True, "HAS_CAR": True},
            ),
            (
                "https://rabota.lemanapro.ru/vacancy/demo",
                LEMANA_DRY_HTML,
                {
                    "firstName": "Nikita",
                    "lastName": "Davydov",
                    "phone": "+79990000000",
                    "email": "nikita.demo@reply.jobtoo.ru",
                },
                {"consent": True},
            ),
            (
                "https://rabota.teremok.ru/questionary/",
                TEREMOK_DRY_HTML,
                {
                    "PROPERTY[NAME][0]": "Davydov Nikita Александрович",
                    "PROPERTY[101][0]": "+79990000000",
                    "PROPERTY[104][0]": "Кассир",
                },
                {"PROPERTY[105]": True},
            ),
            (
                "https://rabota.coffeemania.ru/",
                COFFEEMANIA_DRY_HTML,
                {
                    "vacancy": "cashier",
                    "lastname": "Davydov",
                    "firstname": "Nikita",
                    "phone": "+79990000000",
                    "email": "nikita.demo@reply.jobtoo.ru",
                    "citizenship": "Россия",
                },
                {"agree": True},
            ),
            (
                "https://rabotavdodo.ru/",
                DODO_DRY_HTML,
                {
                    "name": "Nikita",
                    "lastname": "Davydov",
                    "date": "1995-05-09",
                    "phone": "+79990000000",
                    "email": "nikita.demo@reply.jobtoo.ru",
                },
                {},
            ),
            (
                "https://job.megafon.ru/vacancy/demo/apply",
                MEGAFON_DRY_HTML,
                {
                    "lastName": "Davydov",
                    "firstName": "Nikita",
                    "email": "nikita.demo@reply.jobtoo.ru",
                    "phone": "+79990000000",
                },
                {
                    "agreedPersonalData": True,
                    "agreedReservation": False,
                },
            ),
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            profile = self.profile(Path(tmp_dir))
            for logical_url, html_text, expected_values, expected_checks in cases:
                with self.subTest(url=logical_url):
                    host = logical_url.split("/", 3)[2]
                    agent = JupiterAgent({host}, dry_run=True)
                    result = agent.run_loaded_html(html_text, logical_url, profile)
                    self.assertEqual(
                        result.status,
                        "ready_to_submit",
                        json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
                    )
                    actions = [item["action"] for item in result.trajectory]
                    self.assertNotIn("click_submit", actions)
                    snapshot = agent.engine.semantic_snapshot()
                    controls = {
                        item["name"]: item
                        for item in snapshot["controls"]
                        if item["name"]
                    }
                    for name, value in expected_values.items():
                        self.assertEqual(controls[name]["value"], value, (logical_url, name))
                    for name, checked in expected_checks.items():
                        self.assertEqual(controls[name]["checked"], checked, (logical_url, name))

    def test_form_attribute_and_required_radio_group_work_in_dry_run(self):
        profile = CandidateProfile(values={
            "email": "candidate@example.com",
            "work_format": "Hybrid",
        })
        agent = JupiterAgent({"example.test"}, dry_run=True)
        result = agent.run_loaded_html(
            FORM_ATTR_DRY_HTML,
            "https://example.test/apply",
            profile,
        )
        self.assertEqual(
            result.status,
            "ready_to_submit",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        snapshot = agent.engine.semantic_snapshot()
        controls = snapshot["controls"]
        email = next(item for item in controls if item["name"] == "email")
        radios = [item for item in controls if item["name"] == "work_format"]
        self.assertEqual(email["form_index"], 0)
        self.assertEqual(email["value"], "candidate@example.com")
        self.assertEqual(sum(1 for item in radios if item["checked"]), 1)
        self.assertTrue(next(item for item in radios if item["value"] == "Hybrid")["checked"])

    def test_dry_run_still_refuses_to_invent_unknown_required_data(self):
        result, _agent = self.run_path("/unknown", dry_run=True)
        self.assertEqual(result.status, "action_required")
        self.assertIn("visa", (result.reason or "").lower())
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

    def test_audited_registry_covers_all_62_sources_and_known_apply_hosts(self):
        self.assertEqual(len(AUDITED_SITES), 62)
        self.assertIn("job.wb.ru", trusted_hosts_for("https://career.rwb.ru/vacancies/34863"))
        self.assertIn("hh.ru", trusted_hosts_for("https://career.lenta.com/"))
        self.assertEqual(
            field_override("https://vkusvill.ru/job/prodavets-konsultant.html", "BORN"),
            "birth_date",
        )
        self.assertEqual(
            field_override("https://job.megafon.ru/vacancy/x/apply", "agreedPersonalData"),
            "consent",
        )

    def test_read_only_engine_blocks_direct_post_even_outside_agent(self):
        engine = JupiterWebEngine({"127.0.0.1"}, read_only=True)
        with self.assertRaises(EngineSecurityError):
            engine.request(
                f"http://127.0.0.1:{self.port}/submit",
                method="POST",
                data=b"should-never-leave",
            )

    def test_native_engine_fills_uploads_cookies_and_submits(self):
        result, agent = self.run_path("/application")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        actions = [item["action"] for item in result.trajectory]
        self.assertIn("upload", actions)
        self.assertIn("click_submit", actions)
        self.assertIn("http_submit", actions)
        self.assertIn("success_detected", actions)
        self.assertIn("multipart/form-data", self.server.state["last_content_type"])
        self.assertIn("jt_e2e=1", self.server.state["last_cookie"])
        self.assertIn(b"Nikita", self.server.state["last_body"])
        self.assertEqual(agent.engine.page.status, 200)

    def test_unknown_required_field_stops_before_submit(self):
        before = self.server.state["post_count"]
        result, _agent = self.run_path("/unknown")
        self.assertEqual(result.status, "action_required")
        self.assertIn("visa", (result.reason or "").lower())
        self.assertEqual(self.server.state["post_count"], before)
        self.assertNotIn("click_submit", [x["action"] for x in result.trajectory])

    def test_script_runtime_renders_form_then_native_engine_submits(self):
        before = self.server.state["js_post_count"]
        result, agent = self.run_path("/js-rendered")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["js_post_count"], before + 1)
        self.assertIn(b"email=", self.server.state["last_js_body"])
        snapshot = agent.engine.semantic_snapshot()
        self.assertTrue(
            any(
                item.get("kind") == "dom_mutation"
                for item in snapshot.get("script_history", [])
            ),
            snapshot,
        )
        self.assertIn("success_detected", [x["action"] for x in result.trajectory])

    def test_script_runtime_handles_prevent_default_submit(self):
        before = self.server.state["js_post_count"]
        result, agent = self.run_path("/js-intercept")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["js_post_count"], before)
        self.assertIn("Application received", agent.engine.page.text)
        diagnostics = agent.engine.semantic_snapshot().get("script_diagnostics", [])
        self.assertTrue(
            any(item.get("detail") == "preventDefault" for item in diagnostics),
            diagnostics,
        )

    def test_network_runtime_fetches_formdata_with_cookie(self):
        before = self.server.state["network_post_count"]
        result, agent = self.run_path("/js-fetch")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["network_post_count"], before + 1)
        self.assertIn(
            "multipart/form-data",
            self.server.state["last_network_content_type"],
        )
        self.assertIn("jt_network=1", self.server.state["last_network_cookie"])
        self.assertIn(b"nikita.demo@reply.jobtoo.ru", self.server.state["last_network_body"])
        actions = [item["action"] for item in result.trajectory]
        self.assertIn("script_network_submit", actions)
        history = agent.engine.semantic_snapshot().get("script_history", [])
        self.assertTrue(
            any(item.get("kind") == "network_response" for item in history),
            history,
        )

    def test_network_runtime_handles_xmlhttprequest(self):
        before = self.server.state["xhr_post_count"]
        result, _agent = self.run_path("/js-xhr")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["xhr_post_count"], before + 1)
        self.assertIn(b"nikita.demo@reply.jobtoo.ru", self.server.state["last_xhr_body"])
        self.assertIn(
            "script_network_submit",
            [item["action"] for item in result.trajectory],
        )

    def test_network_runtime_cannot_escape_allow_list(self):
        result, _agent = self.run_path("/js-fetch-external")
        self.assertEqual(result.status, "action_required")
        self.assertIn("blocked", (result.reason or "").lower())
        self.assertIn("example.com", result.reason or "")

    def test_modern_runtime_external_script_json_csrf_and_response_json(self):
        before = self.server.state["json_post_count"]
        result, agent = self.run_path("/modern-app")
        self.assertEqual(
            result.status,
            "submitted",
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
        )
        self.assertEqual(self.server.state["json_post_count"], before + 1)
        self.assertEqual(self.server.state["last_json_csrf"], "csrf-demo-123")
        self.assertIn(
            "application/json",
            self.server.state["last_json_content_type"],
        )
        payload = json.loads(self.server.state["last_json_body"].decode("utf-8"))
        self.assertEqual(payload["email"], "nikita.demo@reply.jobtoo.ru")
        self.assertEqual(payload["city"], "Москва")
        history = agent.engine.semantic_snapshot().get("script_history", [])
        self.assertTrue(
            any(item.get("kind") == "external_script" for item in history),
            history,
        )
        self.assertTrue(
            any(item.get("kind") == "network_response" for item in history),
            history,
        )
        self.assertIn(
            "script_network_submit",
            [item["action"] for item in result.trajectory],
        )

    def test_external_script_must_be_same_origin(self):
        result, agent = self.run_path("/modern-external-blocked")
        self.assertEqual(result.status, "action_required")
        history = agent.engine.semantic_snapshot().get("script_history", [])
        self.assertTrue(
            any(
                item.get("kind") == "unsupported"
                and "external script blocked" in item.get("detail", "")
                for item in history
            ),
            history,
        )

    def test_js_only_page_is_explicitly_handed_off(self):
        result, _agent = self.run_path("/js-only")
        self.assertEqual(result.status, "action_required")
        self.assertIn("javascript", (result.reason or "").lower())

    def test_redirect_cannot_escape_allow_list(self):
        result, _agent = self.run_path("/redirect-external")
        self.assertEqual(result.status, "action_required")
        self.assertIn("blocked", (result.reason or "").lower())
        self.assertIn("example.com", result.reason or "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
