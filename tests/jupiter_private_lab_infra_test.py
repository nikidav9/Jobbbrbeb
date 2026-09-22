from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
compose = (ROOT / "infra" / "docker-compose.yml").read_text(encoding="utf-8")
nginx = (ROOT / "infra" / "nginx-site.conf").read_text(encoding="utf-8")
bootstrap = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")
server = (ROOT / "jupiter" / "test_server.py").read_text(encoding="utf-8")

assert "jupiter-lab:" in compose
assert "127.0.0.1:8123:8123" in compose
assert "../jupiter:/app:ro" in compose
assert "mcr.microsoft.com/playwright/python:v1.57.0-noble" in compose

admin_anchor = "listen 8443 ssl http2;"
assert admin_anchor in nginx
public_part, admin_part = nginx.split(admin_anchor, 1)
assert "/jupiter/" not in public_part
assert 'auth_basic "JobToo";' in admin_part
assert "location ^~ /jupiter/" in admin_part
assert 'X-Robots-Tag "noindex, nofollow, noarchive"' in admin_part
assert "proxy_pass http://127.0.0.1:8123/" in admin_part

assert "8123" in bootstrap
assert 'JupiterAgent({"127.0.0.1"}' in server
assert 'X-Robots-Tag' in server
assert 'career-test' in server and 'career-unknown' in server

print("jupiter private lab infra: ok")
