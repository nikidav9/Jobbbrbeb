#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import base64
import json
import tempfile
import threading
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright

from agent import CandidateProfile, JupiterAgent

HOST = "0.0.0.0"
PORT = 8123
RUN_LOCK = threading.Lock()
MAX_BODY = 32 * 1024

TEST_HTML = """<!doctype html>
<html lang=\"ru\"><head><meta charset=\"utf-8\"><title>Jupiter Test Careers</title>
<style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 20px}label{display:block;margin:14px 0 5px}input,textarea,select,button{width:100%;padding:10px;box-sizing:border-box}button{margin-top:20px}</style></head>
<body><h1>Backend Developer</h1><p>Тестовая карьерная страница JobToo.</p>
<form id=\"application-form\">
<label>First name <input name=\"first_name\" required></label>
<label>Фамилия <input name=\"surname\" required></label>
<label>Email <input type=\"email\" name=\"email\" required></label>
<label>Телефон <input type=\"tel\" name=\"phone\" required></label>
<label>Город <input name=\"city\" required></label>
<label>Сколько лет опыта? <input name=\"experience_years\" required></label>
<label>Формат работы <select name=\"work_format\" required><option value=\"\">Выберите</option><option value=\"Office\">Office</option><option value=\"Hybrid\">Hybrid</option><option value=\"Remote\">Remote</option></select></label>
<label>Why are you interested in this role? <textarea name=\"motivation\" required></textarea></label>
<label>Resume <input type=\"file\" name=\"resume\" required></label>
<button type=\"submit\">Submit application</button>
</form><div id=\"success\" hidden><h1>Application received</h1><p>Jupiter test success.</p></div>
<script>document.getElementById('application-form').addEventListener('submit',function(e){e.preventDefault();this.hidden=true;document.getElementById('success').hidden=false})</script>
</body></html>"""

UNKNOWN_HTML = """<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>Jupiter Action Required Test</title>
<style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 20px}label{display:block;margin:14px 0 5px}input,button{width:100%;padding:10px;box-sizing:border-box}button{margin-top:20px}</style></head>
<body><h1>QA Engineer</h1><p>Сценарий с неизвестным обязательным вопросом.</p><form>
<label>Email <input type=\"email\" name=\"email\" required></label>
<label>Do you require visa sponsorship? <input name=\"visa_sponsorship\" required></label>
<button type=\"submit\">Submit application</button></form></body></html>"""

UI_HTML = """<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow,noarchive\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Jupiter Private Lab</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#171717;background:#f5f5f5}*{box-sizing:border-box}body{margin:0}.wrap{max-width:980px;margin:0 auto;padding:32px 18px 60px}.card{background:#fff;border:1px solid #e5e5e5;border-radius:20px;padding:22px;margin:14px 0;box-shadow:0 8px 30px rgba(0,0,0,.04)}h1{font-size:32px;margin:0 0 8px}.muted{color:#666}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;font-size:13px;color:#555}input,select,textarea{width:100%;margin-top:6px;padding:11px 12px;border:1px solid #d6d6d6;border-radius:10px;font:inherit}textarea{min-height:90px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}button{border:0;border-radius:12px;padding:12px 16px;font-weight:700;cursor:pointer}.primary{background:#111;color:#fff}.secondary{background:#eee}.status{font-weight:800;font-size:18px}.ok{color:#0a7f42}.warn{color:#9a6700}.bad{color:#b42318}pre{background:#111;color:#e7e7e7;padding:16px;border-radius:14px;overflow:auto;max-height:420px;font-size:12px}img{max-width:100%;border-radius:14px;border:1px solid #ddd}code{background:#eee;padding:2px 5px;border-radius:5px}@media(max-width:720px){.grid{grid-template-columns:1fr}}
</style></head><body><div class=\"wrap\"><h1>Jupiter Private Lab</h1><p class=\"muted\">Закрытый стенд JobToo. Jupiter запускает настоящий Chromium, но может открыть только локальную тестовую карьерную страницу.</p>
<div class=\"card\"><div class=\"grid\"><label>Имя<input id=\"first_name\" value=\"Nikita\"></label><label>Фамилия<input id=\"last_name\" value=\"Davydov\"></label><label>Email<input id=\"email\" value=\"nikita.demo@reply.jobtoo.ru\"></label><label>Телефон<input id=\"phone\" value=\"+79990000000\"></label><label>Город<input id=\"city\" value=\"Москва\"></label><label>Опыт, лет<input id=\"experience_years\" value=\"4\"></label><label>Формат<select id=\"work_format\"><option>Hybrid</option><option>Remote</option><option>Office</option></select></label><label>Сценарий<select id=\"scenario\"><option value=\"success\">Успешный отклик</option><option value=\"unknown\">Неизвестный обязательный вопрос</option></select></label></div><label style=\"margin-top:12px\">Сопроводительный текст<textarea id=\"cover_letter\">Мне интересна роль, потому что мой опыт соответствует задачам команды.</textarea></label><div class=\"actions\"><button class=\"primary\" id=\"run\">Запустить Jupiter</button><button class=\"secondary\" id=\"reset\">Сбросить результат</button></div></div>
<div class=\"card\" id=\"result\" hidden><div id=\"status\" class=\"status\"></div><p id=\"reason\" class=\"muted\"></p><h3>Что увидел браузер после работы</h3><img id=\"shot\" alt=\"Скриншот результата Jupiter\"><h3>Траектория</h3><pre id=\"trace\"></pre></div>
<div class=\"card\"><strong>Граница теста</strong><p class=\"muted\">Никаких реальных откликов. Разрешён только <code>127.0.0.1</code> внутри контейнера. CAPTCHA и обход защит не используются.</p></div></div>
<script>
const ids=['first_name','last_name','email','phone','city','experience_years','work_format','cover_letter','scenario'];
const run=document.getElementById('run'), result=document.getElementById('result'), status=document.getElementById('status'), reason=document.getElementById('reason'), trace=document.getElementById('trace'), shot=document.getElementById('shot');
run.onclick=async()=>{run.disabled=true;run.textContent='Jupiter работает…';result.hidden=false;status.className='status';status.textContent='Запускаю Chromium…';reason.textContent='';trace.textContent='';shot.removeAttribute('src');const payload={};ids.forEach(id=>payload[id]=document.getElementById(id).value);try{const r=await fetch('api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||('HTTP '+r.status));status.textContent=d.status==='submitted'?'Отклик отправлен':d.status==='action_required'?'Нужен ответ пользователя':'Ошибка';status.className='status '+(d.status==='submitted'?'ok':d.status==='action_required'?'warn':'bad');reason.textContent=d.reason||'';trace.textContent=JSON.stringify(d.trajectory,null,2);if(d.screenshot)shot.src='data:image/png;base64,'+d.screenshot;}catch(e){status.textContent='Ошибка стенда';status.className='status bad';reason.textContent=String(e)}finally{run.disabled=false;run.textContent='Запустить Jupiter'}};
document.getElementById('reset').onclick=()=>{result.hidden=true;trace.textContent='';shot.removeAttribute('src')};
</script></body></html>"""


def _clip(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def validate_payload(raw: dict[str, Any]) -> tuple[dict[str, str], str]:
    scenario = _clip(raw.get("scenario"), 20)
    if scenario not in {"success", "unknown"}:
        raise ValueError("Unknown scenario")
    values = {
        "first_name": _clip(raw.get("first_name"), 100),
        "last_name": _clip(raw.get("last_name"), 100),
        "email": _clip(raw.get("email"), 200),
        "phone": _clip(raw.get("phone"), 80),
        "city": _clip(raw.get("city"), 120),
        "experience_years": _clip(raw.get("experience_years"), 20),
        "work_format": _clip(raw.get("work_format"), 40),
        "cover_letter": _clip(raw.get("cover_letter"), 1200),
    }
    return values, scenario


async def run_demo(values: dict[str, str], scenario: str, *, inline: bool = False) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="jupiter-lab-") as tmp:
        resume_path = Path(tmp) / "resume.txt"
        resume_path.write_text("Jupiter private lab test resume\n", encoding="utf-8")
        profile = CandidateProfile(values=values, resume_path=str(resume_path))
        agent = JupiterAgent({"127.0.0.1"}, max_steps=60)
        target = f"http://127.0.0.1:{PORT}/career-{'test' if scenario == 'success' else 'unknown'}"

        async with async_playwright() as p:
            launch_args: dict[str, Any] = {"headless": True, "args": ["--no-sandbox"]}
            system_chromium = shutil.which("chromium") or shutil.which("chromium-browser")
            if system_chromium:
                launch_args["executable_path"] = system_chromium
            browser = await p.chromium.launch(**launch_args)
            page = await browser.new_page(viewport={"width": 1280, "height": 1000})
            if inline:
                await page.set_content(TEST_HTML if scenario == "success" else UNKNOWN_HTML)
                result = await agent.run_loaded_page(page, target, profile)
            else:
                result = await agent.run(page, target, profile)
            screenshot = await page.screenshot(full_page=True)
            await browser.close()

        payload = result.as_dict()
        payload["screenshot"] = base64.b64encode(screenshot).decode("ascii")
        return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "JupiterPrivateLab/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Never log profile payloads. Basic request line only.
        print(f"{self.client_address[0]} {fmt % args}")

    def _headers(self, status: int, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()

    def _html(self, body: str) -> None:
        data = body.encode("utf-8")
        self._headers(HTTPStatus.OK, "text/html; charset=utf-8")
        self.wfile.write(data)

    def _json(self, status: int, obj: dict[str, Any]) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8")
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"/", "/index.html"}:
            return self._html(UI_HTML)
        if path == "/career-test":
            return self._html(TEST_HTML)
        if path == "/career-unknown":
            return self._html(UNKNOWN_HTML)
        if path == "/health":
            return self._json(HTTPStatus.OK, {"ok": True, "service": "jupiter-private-lab"})
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/api/run":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid content length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request too large"})
        try:
            raw = json.loads(self.rfile.read(length))
            if not isinstance(raw, dict):
                raise ValueError("JSON object expected")
            values, scenario = validate_payload(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        if not RUN_LOCK.acquire(blocking=False):
            return self._json(HTTPStatus.CONFLICT, {"error": "Jupiter is already running"})
        try:
            payload = asyncio.run(run_demo(values, scenario))
            self._json(HTTPStatus.OK, payload)
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Jupiter run failed: {type(exc).__name__}"})
        finally:
            RUN_LOCK.release()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Jupiter Private Lab listening on {HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
