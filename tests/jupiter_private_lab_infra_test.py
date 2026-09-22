from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
compose = (ROOT / "infra" / "docker-compose.yml").read_text(encoding="utf-8")
nginx = (ROOT / "infra" / "nginx-site.conf").read_text(encoding="utf-8")
bootstrap = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")
server = (ROOT / "jupiter" / "test_server.py").read_text(encoding="utf-8")

assert "jupiter-lab:" in compose
assert "127.0.0.1:8123:8123" in compose
assert "JOBTOO_APP_SECRET:" in compose
assert "JUPITER_SESSION_SECRET:" in compose
assert "../jupiter:/app:ro" in compose
assert "mcr.microsoft.com/playwright/python:v1.57.0-noble" in compose

admin_anchor = "listen 8443 ssl http2;"
assert admin_anchor in nginx
public_part, admin_part = nginx.split(admin_anchor, 1)

# Jupiter живёт на обычном origin, чтобы не требовать технический Basic Auth.
assert "location ^~ /jupiter/" in public_part
assert "proxy_pass http://127.0.0.1:8123/" in public_part
assert 'X-Robots-Tag "noindex, nofollow, noarchive"' in public_part

# На техническом порту исключений больше нет: вся панель остаётся за .htpasswd.
assert 'auth_basic "JobToo";' in admin_part
assert "location ^~ /jupiter/" not in admin_part
assert "auth_basic off;" not in admin_part

# Сам Jupiter принимает обычный dbLogin, но только для установленного
# админского номера; запуск без своей короткой сессии запрещён.
assert 'ADMIN_PHONE = "89933431523"' in server
assert 'normalized_phone != ADMIN_PHONE' in server
assert 'returned_phone != ADMIN_PHONE' in server
assert '"fn": "dbLogin"' in server
assert 'if not self._session()' in server
assert 'HttpOnly; Secure; SameSite=Strict' in server

assert "8123" in bootstrap
assert 'JupiterAgent({"127.0.0.1"}' in server
assert 'X-Robots-Tag' in server
assert 'JUPITER_SESSION_SECRET' in bootstrap
assert 'career-test' in server and 'career-unknown' in server

print("jupiter private lab infra: ok")
