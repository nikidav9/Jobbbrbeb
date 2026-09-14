#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).parent.parent
nginx = (root / "infra" / "nginx-site.conf").read_text()
health = (root / "php-proxy" / "health.php").read_text()

start = nginx.index("location = /health")
end = nginx.index("\n    }", start)
route = nginx[start:end]

assert "return 200" not in route
assert "fastcgi_pass 127.0.0.1:9000" in route
assert "SCRIPT_FILENAME /var/www/api/health.php" in route
assert "http://127.0.0.1:3000/" in health
assert "CURLOPT_TIMEOUT => 3" in health
assert "http_response_code($ok ? 200 : 503)" in health
assert "json_encode(['ok' => $ok]" in health
assert "curl_error" not in health

print("health endpoint: OK")
