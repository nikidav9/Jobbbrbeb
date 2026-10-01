"""infra/recon-browser-run.sh: браузерная разведка на сервере — только dry-run,
честная подпись, окружение браузерного воркера, итог туда, где его читает
site_compat."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
run = (ROOT / "infra" / "recon-browser-run.sh").read_text(encoding="utf-8")
worker_run = (ROOT / "infra" / "jupiter-browser-run.sh").read_text(encoding="utf-8")
site_compat = (ROOT / "jupiter" / "site_compat.py").read_text(encoding="utf-8")
recon_browser = (ROOT / "jupiter" / "recon_browser.py").read_text(encoding="utf-8")

subprocess.run(["bash", "-n", str(ROOT / "infra" / "recon-browser-run.sh")], check=True)
assert run.startswith("#!/usr/bin/env bash\n")
assert "set -Eeuo pipefail" in run

# Итог — ровно тот файл, который по умолчанию читает site_compat.
assert "OUT=${OUT:-/var/www/html/jupiter-recon-browser.json}" in run
assert '"JUPITER_RECON_BROWSER_FILE", "/var/www/html/jupiter-recon-browser.json"' in site_compat
assert "HTTP_RECON=${HTTP_RECON:-/var/www/html/jupiter-recon.json}" in run
# Запись атомарная: tmp рядом с итогом, затем mv.
assert 'tmp=$(mktemp "$OUT.XXXXXX")' in run and 'mv -f "$tmp" "$OUT"' in run
assert "os.replace(tmp, target)" in recon_browser

# Окружение — venv браузерного воркера: тот же каталог, тот же Chromium.
for line in ("BASE=${BASE:-/opt/jupiter-browser}", 'VENV="$BASE/venv"',
             "export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$BASE/ms-playwright}"):
    assert line in worker_run, line
    assert line in run, line
assert '"$VENV/bin/python" recon_browser.py' in run
assert 'jupiter-browser-run.sh" setup' in run
# Браузер открывает чужие сайты — не от root.
assert "setpriv --reuid=nobody" in run

# Режим сервера: только не пройденные HTTP разделы, один браузер, срок.
assert 'recon_browser.py --from-http "$WORK/http.json"' in run
assert "--workers 1" in run
assert '--max-minutes "$MAX_MINUTES"' in run
assert "jt-recon.service" in run  # ждёт окончания HTTP-разведки
assert "flock -n 9" in run

# Только чтение: код обхода — только на чтение, никаких боевых переключателей.
assert 'dry_run=True' in recon_browser and 'read_only=True' in recon_browser
for forbidden in ("dry_run=False", "read_only=False", "--live", "JUPITER_ENGINE", "run_worker"):
    assert forbidden not in run, forbidden
# Подпись — честная, движка: своей подписи и подмены UA здесь нет.
assert not re.search(r"user[-_]?agent|--ua\b|BROWSER_UA", run, re.I)
# Секреты разведке не передаются — кроме ключа YandexGPT (решение владельца
# 01.10.2026: ночью Алиса подсказывает разведке, как боевому Юпитеру). Ключ —
# ровно две переменные из файла ключа, только в окружение обхода, не в журнал.
for name in ("TOKEN", "SECRET", "EnvironmentFile"):
    assert name not in run, name
assert "YGPT_ENV=/etc/jobtoo/yandex-gpt.env" in run
assert 'case "$k" in YANDEX_GPT_API_KEY|YANDEX_GPT_FOLDER_ID) YGPT_VARS+=("$k=$v") ;; esac' in run
assert "read -r k v || [ -n \"$k\" ]" in run, "последняя строка файла ключа без перевода строки"
assert '"${YGPT_VARS[@]}"' in run and '--llm-sites "$LLM_SITES"' in run
# Репетиция отправки: нажатие есть, но обход по-прежнему read_only (сеть
# обрывает не-GET) — боевых переключателей в скрипте нет, см. выше.
assert "--rehearse" in run
# Вакансии ленты: HTTP-разведка выгружает их из базы (только компания и
# адрес вакансии), браузерная читает копию от nobody.
recon_run = (ROOT / "infra" / "recon-run.sh").read_text(encoding="utf-8")
assert "from jm_ext_vacancies where active" in recon_run and 'export JUPITER_FEED_VACANCIES="$FEED"' in recon_run
assert "select company, url" in recon_run and "email" not in recon_run and "user_id" not in recon_run
assert 'JUPITER_FEED_VACANCIES="$WORK/feed.json"' in run
# Разведчик источников: после HTTP-разведки, ключ — из файла, только 40 компаний.
assert "scripts/career_search_scout.py" in recon_run and "--limit 40" in recon_run
assert "/career-search-scout.json" in (ROOT / "infra" / "nginx-tls.conf").read_text(encoding="utf-8")
assert "rehearsal_markers=rehearsal_markers(TEST_CANDIDATE)" in recon_browser
assert 'if rehearsal_markers and not read_only:' in (ROOT / "jupiter" / "browser_engine.py").read_text(encoding="utf-8")
assert not re.search(r"(say|echo|printf)[^\n]*(\$v|YGPT_VARS|YANDEX_GPT_API_KEY)", run), "ключ не пишется в журнал"

print("recon-browser infra: ok")
