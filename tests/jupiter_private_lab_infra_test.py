import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
compose = (ROOT / "infra" / "docker-compose.yml").read_text(encoding="utf-8")
nginx = (ROOT / "infra" / "nginx-site.conf").read_text(encoding="utf-8")
bootstrap = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")
engine = (ROOT / "jupiter" / "engine.py").read_text(encoding="utf-8")
script_runtime = (ROOT / "jupiter" / "script_runtime.py").read_text(encoding="utf-8")
network_runtime = (ROOT / "jupiter" / "network_runtime.py").read_text(encoding="utf-8")
site_compat = (ROOT / "jupiter" / "site_compat.py").read_text(encoding="utf-8")
agent = (ROOT / "jupiter" / "agent.py").read_text(encoding="utf-8")
server = (ROOT / "jupiter" / "test_server.py").read_text(encoding="utf-8")
e2e = (ROOT / "jupiter" / "test_e2e.py").read_text(encoding="utf-8")
requirements = (ROOT / "jupiter" / "requirements.txt").read_text(encoding="utf-8")

assert "jupiter-lab:" in compose
assert "127.0.0.1:8123:8123" in compose
assert "JOBTOO_APP_SECRET:" in compose
assert "JUPITER_SESSION_SECRET:" in compose
assert "../jupiter:/app:ro" in compose
assert "image: python:3.12-slim" in compose
assert 'command: ["python", "test_server.py"]' in compose

# Jupiter runtime must remain independent of browser automation packages.
runtime = "\n".join([engine, script_runtime, network_runtime, site_compat, agent, server, e2e, requirements])
for forbidden in (
    "from playwright",
    "import playwright",
    "from selenium",
    "import selenium",
    "from pyppeteer",
    "import pyppeteer",
):
    assert forbidden not in runtime.lower(), forbidden
assert "playwright==" not in requirements.lower()

jupiter_compose = compose[compose.index("  jupiter-lab:"):compose.index("\nvolumes:", compose.index("  jupiter-lab:"))]
assert "mcr.microsoft.com/playwright" not in jupiter_compose.lower()
assert "chromium" not in jupiter_compose.lower()
assert "pip install" not in jupiter_compose.lower()

# Native engine owns HTTP, cookies, redirects, parsing and multipart uploads.
assert "class JupiterWebEngine" in engine
assert "http.cookiejar.CookieJar" in engine
assert "class _SemanticParser" in engine
assert "class _SafeRedirectHandler" in engine
assert "multipart/form-data" in engine
assert "self.assert_allowed(resolved)" not in engine or "_SafeRedirectHandler" in engine
assert "JupiterWebEngine" in agent
# Метку движка в траектории даёт сам движок; HTTP-движок — по умолчанию.
assert '"engine": getattr(self.engine, "name", "jupiter-web-engine")' in agent
assert 'name = "jupiter-browser-engine"' in (ROOT / "jupiter" / "browser_engine.py").read_text(encoding="utf-8")
assert "class JupiterScriptRuntime" in script_runtime
assert "addEventListener" in script_runtime
assert "preventDefault" in script_runtime
assert "eval(" in script_runtime
assert "fetch(" in script_runtime
assert "script_submit" in agent
assert "class NetworkRequest" in network_runtime
assert "execute_network_program" in network_runtime
assert "XMLHttpRequest" in network_runtime
assert "NetworkResponse" in engine
assert "script_network_submit" in agent
assert "--dry-run" in agent
assert "ready_to_submit" in agent
assert "AUDITED_SITES" in site_compat
assert "Wildberries / РВБ" in site_compat
assert "МегаФон" in site_compat
assert "json_form" in network_runtime
assert "response.json()" in network_runtime
assert "meta_headers" in network_runtime
assert "_load_external_script" in engine
assert "External scripts must be same-origin" in engine

admin_anchor = "listen 8443 ssl http2;"
assert admin_anchor in nginx
public_part, admin_part = nginx.split(admin_anchor, 1)

# Jupiter lives on the normal origin, but is absent from the public app UI.
assert "location ^~ /jupiter/" in public_part
assert "proxy_pass http://127.0.0.1:8123/" in public_part
assert 'X-Robots-Tag "noindex, nofollow, noarchive"' in public_part

# Technical admin port stays fully behind its own Basic Auth.
assert 'auth_basic "JobToo";' in admin_part
assert "location ^~ /jupiter/" not in admin_part
assert "auth_basic off;" not in admin_part

# Private lab: вход кодом из письма JobToo, только почта владельца (пароля в
# JobToo нет с 03.10.2026). В публичном репозитории — хеш адреса, не сам адрес.
assert "ADMIN_EMAIL_SHA256 = " in server and "@" not in server.split("ADMIN_EMAIL_SHA256 = ", 1)[1].split("\n", 1)[0]
assert '_jobtoo_call("dbAuthSendCode", [email.strip().lower(), "login"])' in server
assert '_jobtoo_call("dbAuthVerifyCode", [email, "login", code.strip()])' in server
assert 'str(user.get("email", "")).strip().lower() != email' in server
assert "dbLogin" not in server and "nikidav" not in server
# Новый код лаборатории подхватывается: перезапуск по отпечатку jupiter/*.py.
assert 'restart jupiter-lab' in bootstrap and "jupiter-lab.sha" in bootstrap
assert "if not self._session()" in server
assert '"/api/live-dry-run"' in server
assert "profile_for_url" in server
assert "dry_run=True" in server
assert "Live dry-run" in server
assert "HttpOnly; Secure; SameSite=Strict" in server

# Lab browser boundary remains loopback-only.
assert "8123" in bootstrap
assert 'JupiterAgent({"127.0.0.1"}' in server
assert 'X-Robots-Tag' in server
assert 'JUPITER_SESSION_SECRET' in bootstrap
assert 'career-test' in server and 'career-script' in server and 'career-network' in server and 'career-modern' in server and 'career-unknown' in server
assert 'action="/career-submit"' in server

# Ежедневная разведка анкет с московского адреса: только чтение, честная
# подпись (с боевого адреса браузером не притворяемся), итог — открытым файлом.
recon_run = (ROOT / "infra" / "recon-run.sh").read_text(encoding="utf-8")
assert "jt-recon.timer" in bootstrap and "/usr/local/bin/jt-recon" in bootstrap
assert "recon.py" in recon_run and "--ua-retry" not in recon_run.replace("(--ua-retry)", "")
assert "--via-proxy" not in recon_run
# Первый прогон не зависит от OnActiveSec: bootstrap перечитывает systemd
# каждую минуту, поэтому стартуем службу сами, пока журнал пуст.
assert "OnActiveSec" not in bootstrap.split("jt-recon.timer", 1)[1].split("systemctl enable --now jt-recon.timer", 1)[0]
assert "systemctl start --no-block jt-recon.service" in bootstrap
assert 'start" >>"$LOG"' in recon_run
assert '"recon_state"' in (ROOT / "infra" / "migrate.sh").read_text(encoding="utf-8")
assert "location = /jupiter-recon.json" in (ROOT / "infra" / "nginx-tls.conf").read_text(encoding="utf-8")

# Разовый замер браузером (решение владельца 27.09.2026): только чтение.
# В скрипте нет ни ввода, ни отправки; переход не GET обрывается; капча не
# решается; подпись честная; браузер — только в контейнере, не в Jupiter.
probe = (ROOT / "scripts" / "browser-probe.mjs").read_text(encoding="utf-8")
probe_run = (ROOT / "infra" / "browser-probe-run.sh").read_text(encoding="utf-8")
for forbidden in (".fill(", ".type(", ".press(", "setInputFiles", "submit()", ".check(", "requestSubmit"):
    assert forbidden not in probe, forbidden
assert "type === 'document' && !['GET', 'HEAD'].includes(req.method())" in probe
assert "route.abort()" in probe
assert "JobToo/1.0; +https://jobtoo.ru" in probe
assert "type') === 'submit'" in probe  # кнопку отправки формы не нажимаем
assert "mcr.microsoft.com/playwright" in probe_run and "--memory 1g" in probe_run
assert "PROBE_VERSION=" in bootstrap and "/opt/jobtoo-state/browser-probe.$PROBE_VERSION" in bootstrap
assert "jt-browser-probe.timer" not in bootstrap  # разовый, не по расписанию
assert "location = /jupiter-browser-probe.json" in (ROOT / "infra" / "nginx-tls.conf").read_text(encoding="utf-8")
# С 28.09.2026 (решение владельца) браузерный движок — отдельные модули
# browser_*.py (и их тесты, recon_browser.py): Playwright разрешён только там и
# только как необязательный импорт. HTTP-движок, агент и воркер — без браузера;
# Selenium не нужен нигде.
BROWSER_MODULES = re.compile(r"^(browser_|test_browser_|recon_browser)")
for path in (ROOT / "jupiter").glob("*.py"):
    text = path.read_text(encoding="utf-8")
    assert not re.search(r"^\s*(import|from)\s+selenium", text, re.M), path
    if BROWSER_MODULES.match(path.name):
        continue
    assert not re.search(r"^(import|from)\s+playwright", text, re.M), path
engine_src = (ROOT / "jupiter" / "browser_engine.py").read_text(encoding="utf-8")
assert "except ImportError" in engine_src and "sync_playwright = None" in engine_src

print("jupiter native engine infra: ok")

# SSH-ключи владельца едут кодом: только публичные и только дописываются.
keys = (ROOT / "infra" / "ssh-authorized-keys").read_text(encoding="utf-8")
assert "PRIVATE KEY" not in keys
assert all(line.startswith(("#", "ssh-ed25519 ", "ssh-rsa ", "ecdsa-sha2-")) for line in keys.splitlines() if line.strip())
assert "infra/ssh-authorized-keys" in bootstrap and ">> /root/.ssh/authorized_keys" in bootstrap
assert "> /root/.ssh/authorized_keys" not in bootstrap.replace(">> /root/.ssh/authorized_keys", "")
