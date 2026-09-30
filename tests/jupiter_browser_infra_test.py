"""Инфраструктура браузерного воркера Jupiter: включение из репозитория,
Playwright в отдельном venv, лимиты, секреты, доверие к УЦ Минцифры через
политику Chromium, флаг серверу PHP, браузерная разведка, отчёт состояния."""
import base64
import importlib.util
import json
import re
import ssl
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
run = (ROOT / "infra" / "jupiter-browser-run.sh").read_text(encoding="utf-8")
bootstrap = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")
compose = (ROOT / "infra" / "docker-compose.yml").read_text(encoding="utf-8")

start = bootstrap.index("# ── Jupiter: браузерный воркер")
end = bootstrap.index("# Dedicated catch-all mailbox.", start)
section = bootstrap[start:end]

# ── Переключатель в репозитории ─────────────────────────────────────────────
# Решение владельца 29.09.2026: включено. Флаг на сервере следует за файлом.
assert (ROOT / "infra" / "jupiter-browser.enabled").is_file()
assert '[ -f "$REPO/infra/jupiter-browser.enabled" ]' in section
assert 'touch "$JB_FLAG"' in section and 'rm -f "$JB_FLAG"' in section
assert "JB_FLAG=/etc/jobtoo/jupiter-browser.enabled" in section
# Без флага юнит не стартует; выключение — stop и disable.
assert "ConditionPathExists=$JB_FLAG" in section
assert "systemctl stop jt-jupiter-browser.service" in section
assert "systemctl disable jt-jupiter-browser.service" in section
assert 'FLAG=${FLAG:-/etc/jobtoo/jupiter-browser.enabled}' in run
assert '[ -f "$FLAG" ] ||' in run
# Юнит переписывается при изменении (раньше создавался один раз и застревал).
assert "cmp -s /tmp/jt-jupiter-browser.service /etc/systemd/system/jt-jupiter-browser.service" in section

# ── Playwright: закреплённая версия, отдельный venv, Chromium с зависимостями ─
assert re.search(r"^PW=\$\{PW:-1\.63\.0\}$", run, re.M)
assert "latest" not in run.lower()
assert 'VENV="$BASE/venv"' in run and "BASE=${BASE:-/opt/jupiter-browser}" in run
assert '"$VENV/bin/pip" install' in run and '"playwright==$PW"' in run
assert "pip install" not in run.replace('"$VENV/bin/pip" install', "")  # не системный pip
assert '"$VENV/bin/python" -m playwright install --with-deps chromium' in run
# Идемпотентно: отметка версии Playwright и requirements.txt.
assert 'want="playwright=$PW req=' in run and 'echo "$want" > "$mark"' in run
assert "flock 8" in run  # setup зовут и воркер, и разведка
assert 'exec "$VENV/bin/python" run_worker.py' in run
assert "docker" not in run  # браузер больше не в контейнере

# ── Служба ──────────────────────────────────────────────────────────────────
for line in (
    "ExecStartPre=+/usr/local/bin/jt-jupiter-browser setup",
    "ExecStart=/usr/local/bin/jt-jupiter-browser run",
    "MemoryMax=1500M", "MemorySwapMax=0", "Restart=on-failure",
    "DynamicUser=yes",  # Chromium без песочницы — не от root
    "Environment=JUPITER_ENGINE=browser",
    "Environment=JUPITER_WORKER_ID=jupiter-browser-%H",
    "Environment=JOBTOO_URL=https://jobtoo.ru",
    "Environment=PLAYWRIGHT_BROWSERS_PATH=$JB_BASE/ms-playwright",
    "StandardOutput=append:/var/log/jt-jupiter-browser.log",
):
    assert line in section, line
# Одна служба — один браузер: 1500 МБ вмещают один браузер по оценке
# browser_limits (600 МБ), но не два.
spec = importlib.util.spec_from_file_location("browser_limits", ROOT / "jupiter" / "browser_limits.py")
bl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bl)
assert bl.PER_BROWSER_MB <= 1500 < 2 * bl.PER_BROWSER_MB + 400

# ── Секреты: те же, что у обычного воркера, YandexGPT — отдельным файлом ─────
assert "EnvironmentFile=$SECRETS" in section
assert "EnvironmentFile=-$YGPT_ENV" in section
assert "YGPT_ENV=/etc/jobtoo/yandex-gpt.env" in section
assert "jt-jupiter.service.d/yandex-gpt.conf" in section  # и обычному воркеру
assert "EnvironmentFile=-%s" in section
assert 'chmod 600 "$YGPT_ENV"' in section and 'chown root:root "$YGPT_ENV"' in section
for text in (run, section):
    for name in ("YANDEX_GPT_API_KEY", "YANDEX_GPT_FOLDER_ID"):
        assert not re.search(rf"{name}=\S", text), name
    assert not re.search(r"(api[-_]?key|token|secret|password)\s*=\s*['\"]?[A-Za-z0-9_\-]{16,}", text, re.I)

# ── Серверу PHP: JUPITER_BROWSER_ENABLED, как JUPITER_MAIL_VERIFIED ──────────
assert 'echo "JUPITER_BROWSER_ENABLED=$JB_PHP" >> "$SECRETS"' in section
assert "JB_PHP=1; else JB_PHP=0" in section
assert "JUPITER_BROWSER_ENABLED: ${JUPITER_BROWSER_ENABLED:-0}" in compose, (
    "infra/docker-compose.yml: в environment сервиса php нужна строка "
    "JUPITER_BROWSER_ENABLED: ${JUPITER_BROWSER_ENABLED:-0}")
# Синхронизация стоит до общего docker compose up — контейнер PHP
# пересоздаётся с новым значением в тот же заход.
assert bootstrap.index("JUPITER_BROWSER_ENABLED=$JB_PHP") < bootstrap.index(
    'docker compose --env-file "$SECRETS" up -d --remove-orphans')

# ── Доверие к УЦ Минцифры: политика Chromium, не флаг ────────────────────────
assert "JB_POLICY=/etc/chromium/policies/managed/jobtoo-ru-ca.json" in section
# Chrome for Testing (Playwright 1.63 «chromium») читает только свою папку.
assert "JB_POLICY_CFT=/etc/opt/chrome_for_testing/policies/managed/jobtoo-ru-ca.json" in section
assert 'for jb_pol in "$JB_POLICY" "$JB_POLICY_CFT"' in section
assert 'install -m 644 -o root -g root /tmp/jt-ru-ca.json "$jb_pol"' in section
assert 'rm -f "$jb_pol"' in section
for text in (run, section, bootstrap,
             (ROOT / "infra" / "jupiter-browser-ca-policy.py").read_text(encoding="utf-8").split('"""')[2]):
    assert "ignore-certificate" not in text.lower()
    assert "ignore_https_errors" not in text
out = subprocess.run(
    ["python3", str(ROOT / "infra" / "jupiter-browser-ca-policy.py"), str(ROOT / "jupiter" / "ru_trusted_ca.pem")],
    check=True, capture_output=True, text=True).stdout
policy = json.loads(out)
pem = (ROOT / "jupiter" / "ru_trusted_ca.pem").read_text(encoding="utf-8")
ders = [base64.b64encode(ssl.PEM_cert_to_DER_cert(m)).decode()
        for m in re.findall(r"-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----", pem, re.S)]
assert len(ders) == 2
assert [x["certificate"] for x in policy["CACertificatesWithConstraints"]] == ders
assert all("constraints" not in x for x in policy["CACertificatesWithConstraints"])  # без доменов
assert policy["CACertificates"] == ders
assert set(policy) == {"CACertificates", "CACertificatesWithConstraints"}

# ── Браузерная разведка: после jt-recon и только при включённом браузере ─────
assert "/usr/local/bin/jt-recon-browser" in section
assert 'if [ -f "$REPO/infra/recon-browser-run.sh" ] && [ -f "$JB_FLAG" ]; then' in section
assert "After=network-online.target jt-recon.service" in section
assert "OnCalendar=*-*-* 05:10" in section
assert "systemctl disable --now jt-recon-browser.timer" in section
assert "OnCalendar=*-*-* 04:40" in bootstrap  # HTTP-разведка раньше

# ── Сторож памяти и отчёт состояния ──────────────────────────────────────────
head = bootstrap[: bootstrap.index("say() {")]
assert "jt-jupiter-browser.service jt-recon-browser.service" in head
assert 'systemctl kill -s KILL "$u"' in head
assert "/var/www/html/jupiter-browser-status.json" in section
for key in ('"включён"', '"служба"', '"перезапуски"', '"установлено"', '"php_флаг"',
            '"политика_ca"', '"yandex_gpt"', '"http_воркер"'):
    assert key in section, key

# Файл статуса пишется в /var/www/html, но наружу его отдаёт только явный
# location: без него запрос уходил в SPA, и проверить воркер было нечем.
nginx = (ROOT / "infra" / "nginx-tls.conf").read_text(encoding="utf-8")
assert "location = /jupiter-browser-status.json" in nginx
assert "alias /var/www/html/jupiter-browser-status.json;" in nginx
assert "location = /jupiter-recon-browser.json" in nginx
assert "alias /var/www/html/jupiter-recon-browser.json;" in nginx

# Инвариант проекта: обычный Jupiter браузер не получает.
assert "jt-jupiter.service" in bootstrap
assert "playwright" not in (ROOT / "jupiter" / "requirements.txt").read_text(encoding="utf-8").lower()

for path in ("infra/jupiter-browser-run.sh", "infra/bootstrap.sh"):
    subprocess.run(["bash", "-n", str(ROOT / path)], check=True)

print("jupiter browser infra ok")
