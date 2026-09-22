#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from agent import CandidateProfile, JupiterAgent
from site_compat import profile_for_url


HOST = "0.0.0.0"
PORT = 8123
RUN_LOCK = threading.Lock()
MAX_BODY = 32 * 1024
MAX_APPLICATION_BODY = 3 * 1024 * 1024
SESSION_TTL = 4 * 60 * 60
SESSION_COOKIE = "jt_jupiter_lab"
API_ORIGIN = os.environ.get(
    "JOBTOO_API_ORIGIN",
    "https://147.45.184.99.sslip.io",
).rstrip("/")
APP_SECRET = os.environ.get("JOBTOO_APP_SECRET", "")
SESSION_SECRET = os.environ.get("JUPITER_SESSION_SECRET", "")
ADMIN_PHONE = "89933431523"

ALLOWED_USER_IDS = {
    value.strip()
    for value in os.environ.get("JUPITER_ALLOWED_USER_IDS", "").split(",")
    if value.strip()
}


TEST_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Jupiter Test Careers</title>
  <style>
    body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 20px}
    label{display:block;margin:14px 0 5px}
    input,textarea,select,button{width:100%;padding:10px;box-sizing:border-box}
    button{margin-top:20px}
  </style>
</head>
<body>
  <h1>Backend Developer</h1>
  <p>Тестовая карьерная страница JobToo.</p>
  <form action="/career-submit" method="post" enctype="multipart/form-data">
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
</body>
</html>"""

UNKNOWN_HTML = """<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Jupiter Action Required Test</title></head>
<body>
  <h1>QA Engineer</h1>
  <p>Сценарий с неизвестным обязательным вопросом.</p>
  <form action="/career-submit" method="post">
    <label>Email <input type="email" name="email" required></label>
    <label>Do you require visa sponsorship? <input name="visa_sponsorship" required></label>
    <button type="submit">Submit application</button>
  </form>
</body>
</html>"""

SUCCESS_HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Success</title></head>
<body><h1>Application received</h1><p>Thank you for applying.</p></body></html>"""


SCRIPT_HTML = """<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Jupiter Script Runtime Test</title></head>
<body>
  <h1>Frontend Engineer</h1>
  <form id="application-form">
    <label>Email <input type="email" name="email" required></label>
    <button type="submit">Submit application</button>
  </form>
  <div id="success" hidden>
    <h1>Application received</h1>
    <p>Handled by Jupiter Script Runtime.</p>
  </div>
  <script>
    const form = document.getElementById('application-form');
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      document.getElementById('application-form').hidden = true;
      document.getElementById('success').hidden = false;
    });
  </script>
</body>
</html>"""


NETWORK_HTML = """<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Jupiter Network Runtime Test</title></head>
<body>
  <h1>Platform Engineer</h1>
  <form id="network-form">
    <label>Email <input type="email" name="email" required></label>
    <button type="submit">Submit application</button>
  </form>
  <div id="network-success" hidden>
    <h1>Application received</h1>
    <p>Handled by Jupiter Network Runtime.</p>
  </div>
  <script>
    const form = document.getElementById('network-form');
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const response = await fetch('/career-network-submit', {
        method: 'POST',
        body: new FormData(form)
      });
      if (response.ok) {
        document.getElementById('network-form').hidden = true;
        document.getElementById('network-success').hidden = false;
      }
    });
  </script>
</body>
</html>"""


MODERN_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="csrf-token" content="lab-csrf-456">
  <title>Jupiter Modern Runtime Test</title>
</head>
<body>
  <h1>Modern Full Stack Engineer</h1>
  <form id="modern-form">
    <label>Email <input type="email" name="email" required></label>
    <label>Город <input name="city" required></label>
    <button type="submit">Submit application</button>
  </form>
  <div id="modern-success" hidden>
    <h1>Application received</h1>
    <p>External script + JSON + CSRF + response.json completed.</p>
  </div>
  <script src="/career-modern.js"></script>
</body>
</html>"""

MODERN_JS = """
const form = document.getElementById('modern-form');
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const response = await fetch('/career-modern-submit', {
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

LOGIN_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jupiter — вход</title>
  <style>
    :root{font-family:Inter,system-ui,sans-serif;color:#171717;background:#f5f5f5}
    *{box-sizing:border-box}body{margin:0}.wrap{max-width:460px;margin:8vh auto;padding:20px}
    .card{background:#fff;border:1px solid #e5e5e5;border-radius:20px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.05)}
    h1{font-size:30px;margin:0 0 8px}.muted{color:#666}
    label{display:block;font-size:13px;color:#555;margin-top:14px}
    input{width:100%;margin-top:6px;padding:12px;border:1px solid #d6d6d6;border-radius:10px;font:inherit}
    button{width:100%;margin-top:18px;border:0;border-radius:12px;padding:13px 16px;font-weight:800;background:#111;color:#fff;cursor:pointer}
    .err{color:#b42318;margin-top:12px;min-height:20px}
  </style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Jupiter Private Lab</h1>
  <p class="muted">Войди тем же телефоном и паролем, которыми входишь в JobToo.</p>
  <label>Телефон<input id="phone" inputmode="tel" autocomplete="username"></label>
  <label>Пароль<input id="password" type="password" autocomplete="current-password"></label>
  <button id="login">Войти</button><div class="err" id="err"></div>
</div></div>
<script>
const b=document.getElementById('login'),e=document.getElementById('err');
b.onclick=async()=>{b.disabled=true;e.textContent='';
try{
  const r=await fetch('api/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({phone:document.getElementById('phone').value,password:document.getElementById('password').value})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось войти');location.reload()
}catch(x){e.textContent=x.message||String(x)}finally{b.disabled=false}};
</script>
</body></html>"""

UI_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jupiter Private Lab</title>
  <style>
    :root{font-family:Inter,system-ui,sans-serif;color:#171717;background:#f5f5f5}
    *{box-sizing:border-box}body{margin:0}.wrap{max-width:980px;margin:0 auto;padding:32px 18px 60px}
    .top{display:flex;justify-content:space-between;gap:12px;align-items:start}
    .card{background:#fff;border:1px solid #e5e5e5;border-radius:20px;padding:22px;margin:14px 0;box-shadow:0 8px 30px rgba(0,0,0,.04)}
    h1{font-size:32px;margin:0 0 8px}.muted{color:#666}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    label{display:block;font-size:13px;color:#555}input,select,textarea{width:100%;margin-top:6px;padding:11px 12px;border:1px solid #d6d6d6;border-radius:10px;font:inherit}
    textarea{min-height:90px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
    button{border:0;border-radius:12px;padding:12px 16px;font-weight:700;cursor:pointer}.primary{background:#111;color:#fff}.secondary{background:#eee}
    .status{font-weight:800;font-size:18px}.ok{color:#0a7f42}.warn{color:#9a6700}.bad{color:#b42318}
    pre{background:#111;color:#e7e7e7;padding:16px;border-radius:14px;overflow:auto;max-height:460px;font-size:12px}
    code{background:#eee;padding:2px 5px;border-radius:5px}
    @media(max-width:720px){.grid{grid-template-columns:1fr}.top{display:block}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>Jupiter Private Lab</h1>
      <p class="muted">Jupiter Web Engine работает без Chromium, Playwright и внешнего AI. Он сам читает HTML, заполняет форму и отправляет HTTP-запрос.</p>
    </div>
    <button class="secondary" id="logout">Выйти</button>
  </div>
  <div class="card">
    <div class="grid">
      <label>Имя<input id="first_name" value="Nikita"></label>
      <label>Фамилия<input id="last_name" value="Davydov"></label>
      <label>Отчество<input id="patronymic" value="Александрович"></label>
      <label>Дата рождения<input id="birth_date" value="09.05.1995"></label>
      <label>Email<input id="email" value="nikita.demo@reply.jobtoo.ru"></label>
      <label>Телефон<input id="phone" value="+79990000000"></label>
      <label>Город<input id="city" value="Москва"></label>
      <label>Метро / район<input id="location_detail" value=""></label>
      <label>Гражданство<input id="citizenship" value="Россия"></label>
      <label>Образование<input id="education" value="Высшее"></label>
      <label>Желаемая роль<input id="desired_role" value="Кассир"></label>
      <label>Занятость<input id="employment" value="Полная"></label>
      <label>Опыт, лет<input id="experience_years" value="4"></label>
      <label>Формат<select id="work_format"><option>Hybrid</option><option>Remote</option><option>Office</option></select></label>
      <label>Есть автомобиль<select id="has_car"><option value="false">Нет</option><option value="true">Да</option></select></label>
      <label>Согласие на обработку данных<select id="consent"><option value="true">Да</option><option value="false">Нет</option></select></label>
      <label>Ссылка на резюме<input id="resume_url" value=""></label>
      <label>Сценарий<select id="scenario"><option value="success">Успешный отклик</option><option value="script">JS submit через Jupiter Runtime</option><option value="network">fetch через Jupiter Network Runtime</option><option value="modern">External JS + JSON + CSRF</option><option value="unknown">Неизвестный обязательный вопрос</option></select></label>
    </div>
    <label style="margin-top:12px">Сопроводительный текст<textarea id="cover_letter">Мне интересна роль, потому что мой опыт соответствует задачам команды.</textarea></label>
    <label style="margin-top:12px">URL вакансии/анкеты из аудированных 62 сайтов<input id="live_url" placeholder="https://..."></label>
    <div class="actions"><button class="primary" id="liveRun">Live dry-run — заполнить, не отправлять</button><button class="secondary" id="run">Синтетический тест</button><button class="secondary" id="reset">Сбросить результат</button></div>
  </div>
  <div class="card" id="result" hidden>
    <div id="status" class="status"></div><p id="reason" class="muted"></p>
    <h3>Semantic page после работы</h3><pre id="snapshot"></pre>
    <h3>Траектория</h3><pre id="trace"></pre>
  </div>
  <div class="card"><strong>Граница теста</strong>
    <p class="muted">Синтетические сценарии остаются на <code>127.0.0.1</code>. Live dry-run разрешён только для 62 аудированных работодателей и их явно доверенных apply-переходов. В live-режиме HTTP-движок read-only: POST/submit запрещены независимо от planner. CAPTCHA не обходится.</p>
  </div>
</div>
<script>
const ids=['first_name','last_name','patronymic','birth_date','email','phone','city','location_detail','citizenship','education','desired_role','employment','experience_years','work_format','has_car','consent','resume_url','cover_letter','scenario'];
const run=document.getElementById('run'),liveRun=document.getElementById('liveRun'),result=document.getElementById('result'),status=document.getElementById('status'),reason=document.getElementById('reason'),trace=document.getElementById('trace'),snapshot=document.getElementById('snapshot');
const payload=()=>{const p={};ids.forEach(id=>p[id]=document.getElementById(id).value);return p};
const show=async(endpoint,body,button,label)=>{button.disabled=true;button.textContent='Jupiter работает…';result.hidden=false;status.className='status';status.textContent='Запускаю Jupiter Web Engine…';reason.textContent='';trace.textContent='';snapshot.textContent='';
try{
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d=await r.json();if(r.status===401){location.reload();return}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
 status.textContent=d.status==='submitted'?'Отклик отправлен':d.status==='ready_to_submit'?'Готово к отправке — не отправляли':d.status==='action_required'?'Нужен ответ пользователя':'Ошибка';
 status.className='status '+(d.status==='submitted'||d.status==='ready_to_submit'?'ok':d.status==='action_required'?'warn':'bad');
 reason.textContent=(d.site?('Сайт: '+d.site+'. '):'')+(d.reason||'');trace.textContent=JSON.stringify(d.trajectory,null,2);snapshot.textContent=JSON.stringify(d.snapshot,null,2)
}catch(e){status.textContent='Ошибка стенда';status.className='status bad';reason.textContent=String(e)}
finally{button.disabled=false;button.textContent=label}};
run.onclick=()=>show('api/run',payload(),run,'Синтетический тест');
liveRun.onclick=()=>{const p=payload();p.url=document.getElementById('live_url').value;show('api/live-dry-run',p,liveRun,'Live dry-run — заполнить, не отправлять')};
document.getElementById('reset').onclick=()=>{result.hidden=true;trace.textContent='';snapshot.textContent=''};
document.getElementById('logout').onclick=async()=>{await fetch('api/logout',{method:'POST'});location.reload()};
</script>
</body></html>"""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def make_session(user_id: str) -> str:
    if not SESSION_SECRET:
        raise RuntimeError("JUPITER_SESSION_SECRET is missing")
    payload = json.dumps(
        {"uid": user_id, "exp": int(time.time()) + SESSION_TTL},
        separators=(",", ":"),
    ).encode("utf-8")
    body = _b64url(payload)
    sig = _b64url(
        hmac.new(
            SESSION_SECRET.encode("utf-8"),
            body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    return body + "." + sig


def verify_session(token: str | None) -> dict[str, Any] | None:
    if not token or not SESSION_SECRET or "." not in token:
        return None
    body, sig = token.split(".", 1)
    expected = _b64url(
        hmac.new(
            SESSION_SECRET.encode("utf-8"),
            body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except Exception:
        return None
    if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
        return None
    uid = str(payload.get("uid", "")).strip()
    if not uid:
        return None
    if ALLOWED_USER_IDS and uid not in ALLOWED_USER_IDS:
        return None
    return payload


def authenticate_jobtoo(phone: str, password: str) -> dict[str, Any] | None:
    normalized_phone = "".join(ch for ch in phone if ch.isdigit())
    if normalized_phone != ADMIN_PHONE:
        return None
    if not APP_SECRET:
        raise RuntimeError("JOBTOO_APP_SECRET is missing")

    body = json.dumps(
        {"fn": "dbLogin", "args": [phone, password]},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        API_ORIGIN + "/api/db.php",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-App-Secret": APP_SECRET,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            return None
        raise

    payload = json.loads(raw)
    data = payload.get("data") if isinstance(payload, dict) else None
    user = data.get("user") if isinstance(data, dict) else None
    if not isinstance(user, dict) or not data.get("session_token"):
        return None

    returned_phone = "".join(
        ch for ch in str(user.get("phone", "")) if ch.isdigit()
    )
    if returned_phone != ADMIN_PHONE:
        return None

    uid = str(user.get("id", "")).strip()
    if not uid:
        return None
    if ALLOWED_USER_IDS and uid not in ALLOWED_USER_IDS:
        return None
    return user


def _clip(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def _as_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "да", "on"}


def validate_payload(raw: dict[str, Any]) -> tuple[dict[str, Any], str]:
    scenario = _clip(raw.get("scenario"), 20)
    if scenario not in {"success", "script", "network", "modern", "unknown"}:
        raise ValueError("Unknown scenario")
    values: dict[str, Any] = {
        "first_name": _clip(raw.get("first_name"), 100),
        "last_name": _clip(raw.get("last_name"), 100),
        "patronymic": _clip(raw.get("patronymic"), 100),
        "birth_date": _clip(raw.get("birth_date"), 40),
        "email": _clip(raw.get("email"), 200),
        "phone": _clip(raw.get("phone"), 80),
        "city": _clip(raw.get("city"), 120),
        "location_detail": _clip(raw.get("location_detail"), 120),
        "citizenship": _clip(raw.get("citizenship"), 120),
        "education": _clip(raw.get("education"), 160),
        "desired_role": _clip(raw.get("desired_role"), 160),
        "employment": _clip(raw.get("employment"), 80),
        "experience_years": _clip(raw.get("experience_years"), 20),
        "work_format": _clip(raw.get("work_format"), 40),
        "resume_url": _clip(raw.get("resume_url"), 500),
        "cover_letter": _clip(raw.get("cover_letter"), 1200),
        "has_car": _as_bool(raw.get("has_car")),
        "consent": _as_bool(raw.get("consent")),
    }
    return values, scenario


def validate_live_url(raw: Any) -> tuple[str, str]:
    url = _clip(raw, 2000)
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Live dry-run принимает только HTTPS URL")
    site = profile_for_url(url)
    if site is None:
        raise ValueError("URL не относится к 62 аудированным работодателям")
    return url, site.name


def run_live_dry_run(values: dict[str, Any], url: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    with tempfile.TemporaryDirectory(prefix="jupiter-live-dry-") as tmp:
        resume_path = Path(tmp) / "resume.txt"
        resume_path.write_text(
            "Jupiter private lab dry-run resume\n",
            encoding="utf-8",
        )
        profile = CandidateProfile(values=values, resume_path=str(resume_path))
        agent = JupiterAgent({host}, max_steps=30, dry_run=True)
        result = agent.run(url, profile)
        payload = result.as_dict()
        payload["engine"] = "jupiter-web-engine"
        payload["snapshot"] = agent.engine.semantic_snapshot()
        return payload


def run_demo(values: dict[str, str], scenario: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="jupiter-lab-") as tmp:
        resume_path = Path(tmp) / "resume.txt"
        resume_path.write_text(
            "Jupiter private lab test resume\n",
            encoding="utf-8",
        )
        profile = CandidateProfile(values=values, resume_path=str(resume_path))
        agent = JupiterAgent({"127.0.0.1"}, max_steps=30)
        page_name = {
            "success": "career-test",
            "script": "career-script",
            "network": "career-network",
            "modern": "career-modern",
            "unknown": "career-unknown",
        }[scenario]
        target = f"http://127.0.0.1:{PORT}/{page_name}"
        result = agent.run(target, profile)
        payload = result.as_dict()
        payload["engine"] = "jupiter-web-engine"
        payload["snapshot"] = agent.engine.semantic_snapshot()
        return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "JupiterPrivateLab/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.client_address[0]} {fmt % args}")

    def _session(self) -> dict[str, Any] | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        return verify_session(morsel.value if morsel else None)

    def _headers(
        self,
        status: int,
        content_type: str,
        extra: list[tuple[str, str]] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in extra or []:
            self.send_header(key, value)
        self.end_headers()

    def _html(self, body: str, status: int = HTTPStatus.OK) -> None:
        self._headers(status, "text/html; charset=utf-8")
        self.wfile.write(body.encode("utf-8"))

    def _json(
        self,
        status: int,
        obj: dict[str, Any],
        extra: list[tuple[str, str]] | None = None,
    ) -> None:
        self._headers(status, "application/json; charset=utf-8", extra)
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid content length") from exc
        if length <= 0 or length > MAX_BODY:
            raise ValueError("request too large")
        raw = json.loads(self.rfile.read(length))
        if not isinstance(raw, dict):
            raise ValueError("JSON object expected")
        return raw

    def _is_loopback(self) -> bool:
        return self.client_address[0] in {"127.0.0.1", "::1"}

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"/", "/index.html"}:
            return self._html(UI_HTML if self._session() else LOGIN_HTML)
        if path == "/career-test":
            return (
                self._html(TEST_HTML)
                if self._is_loopback()
                else self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            )
        if path == "/career-script":
            return (
                self._html(SCRIPT_HTML)
                if self._is_loopback()
                else self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            )
        if path == "/career-network":
            return (
                self._html(NETWORK_HTML)
                if self._is_loopback()
                else self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            )
        if path == "/career-modern":
            return (
                self._html(MODERN_HTML)
                if self._is_loopback()
                else self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            )
        if path == "/career-modern.js":
            if not self._is_loopback():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            body = MODERN_JS.encode("utf-8")
            self._headers(HTTPStatus.OK, "application/javascript; charset=utf-8")
            self.wfile.write(body)
            return
        if path == "/career-unknown":
            return (
                self._html(UNKNOWN_HTML)
                if self._is_loopback()
                else self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            )
        if path == "/health":
            return self._json(
                HTTPStatus.OK,
                {"ok": True, "service": "jupiter-private-lab", "engine": "native"},
            )
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]

        if path == "/career-modern-submit":
            if not self._is_loopback():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._json(HTTPStatus.BAD_REQUEST, {"accepted": False})
            if length <= 0 or length > MAX_APPLICATION_BODY:
                return self._json(HTTPStatus.BAD_REQUEST, {"accepted": False})
            try:
                payload = json.loads(self.rfile.read(length))
            except Exception:
                return self._json(HTTPStatus.BAD_REQUEST, {"accepted": False})
            accepted = (
                "application/json" in (self.headers.get("Content-Type") or "").lower()
                and self.headers.get("X-CSRF-Token") == "lab-csrf-456"
                and payload.get("email") == "nikita.demo@reply.jobtoo.ru"
                and payload.get("city") == "Москва"
            )
            return self._json(
                HTTPStatus.OK if accepted else HTTPStatus.BAD_REQUEST,
                {"accepted": accepted},
            )

        if path == "/career-network-submit":
            if not self._is_loopback():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._html("<h1>Invalid payload</h1>", HTTPStatus.BAD_REQUEST)
            if length <= 0 or length > MAX_APPLICATION_BODY:
                return self._html("<h1>Invalid payload</h1>", HTTPStatus.BAD_REQUEST)
            body = self.rfile.read(length)
            content_type = (self.headers.get("Content-Type") or "").lower()
            if (
                "multipart/form-data" not in content_type
                or b'name="email"' not in body
            ):
                return self._html(
                    "<h1>Network payload rejected</h1>",
                    HTTPStatus.BAD_REQUEST,
                )
            return self._html("<p>network accepted</p>")

        if path == "/career-submit":
            if not self._is_loopback():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._html("<h1>Invalid payload</h1>", HTTPStatus.BAD_REQUEST)
            if length <= 0 or length > MAX_APPLICATION_BODY:
                return self._html("<h1>Invalid payload</h1>", HTTPStatus.BAD_REQUEST)
            body = self.rfile.read(length)
            content_type = (self.headers.get("Content-Type") or "").lower()
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
                b"Jupiter private lab test resume",
            ]
            if "multipart/form-data" not in content_type or not all(
                marker in body for marker in required
            ):
                return self._html(
                    "<h1>Application payload rejected</h1>",
                    HTTPStatus.BAD_REQUEST,
                )
            return self._html(SUCCESS_HTML)

        if path == "/api/login":
            try:
                raw = self._read_json()
                phone = _clip(raw.get("phone"), 80)
                password = str(raw.get("password") or "")[:256]
                if not phone or not password:
                    raise ValueError("Введите телефон и пароль")
                user = authenticate_jobtoo(phone, password)
            except ValueError as exc:
                return self._json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(exc)},
                )
            except Exception:
                return self._json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": "Не удалось проверить вход через JobToo"},
                )
            if not user:
                return self._json(
                    HTTPStatus.UNAUTHORIZED,
                    {"error": "Неверный телефон или пароль JobToo"},
                )
            token = make_session(str(user["id"]))
            cookie = (
                f"{SESSION_COOKIE}={token}; Path=/jupiter/; Max-Age={SESSION_TTL}; "
                "HttpOnly; Secure; SameSite=Strict"
            )
            return self._json(
                HTTPStatus.OK,
                {"ok": True},
                [("Set-Cookie", cookie)],
            )

        if path == "/api/logout":
            cookie = (
                f"{SESSION_COOKIE}=; Path=/jupiter/; Max-Age=0; "
                "HttpOnly; Secure; SameSite=Strict"
            )
            return self._json(
                HTTPStatus.OK,
                {"ok": True},
                [("Set-Cookie", cookie)],
            )

        if path not in {"/api/run", "/api/live-dry-run"}:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        if not self._session():
            return self._json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "Войдите в JobToo"},
            )

        try:
            raw = self._read_json()
            values, scenario = validate_payload(raw)
            live_url = None
            site_name = None
            if path == "/api/live-dry-run":
                live_url, site_name = validate_live_url(raw.get("url"))
        except (json.JSONDecodeError, ValueError) as exc:
            return self._json(
                HTTPStatus.BAD_REQUEST,
                {"error": str(exc)},
            )

        if not RUN_LOCK.acquire(blocking=False):
            return self._json(
                HTTPStatus.CONFLICT,
                {"error": "Jupiter is already running"},
            )
        try:
            if path == "/api/live-dry-run":
                payload = run_live_dry_run(values, live_url or "")
                payload["site"] = site_name
            else:
                payload = run_demo(values, scenario)
            self._json(HTTPStatus.OK, payload)
        except Exception as exc:
            self._json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Jupiter run failed: {type(exc).__name__}"},
            )
        finally:
            RUN_LOCK.release()


def main() -> None:
    if not SESSION_SECRET:
        raise SystemExit("JUPITER_SESSION_SECRET is required")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Jupiter Private Lab listening on {HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
