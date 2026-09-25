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
assert '"engine": "jupiter-web-engine"' in agent
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

# Private lab accepts normal JobToo login but only for the existing admin.
assert 'ADMIN_PHONE = "89933431523"' in server
assert "normalized_phone != ADMIN_PHONE" in server
assert "returned_phone != ADMIN_PHONE" in server
assert '"fn": "dbLogin"' in server
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

print("jupiter native engine infra: ok")
