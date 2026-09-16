#!/usr/bin/env python3
"""Разведка карьерных сайтов с московского сервера.

Зачем она там, если такая же уже есть в GitHub Actions. Потому что Actions
стоит на американских адресах, а за вакансиями потом ходит сервер, из Москвы, —
и они видят разный интернет. Замерено в обе стороны: из Actions Альфа-Банк,
Точка, НСПК и Positive Technologies отдают ошибку сертификата, а отсюда,
наоборот, 403 отдают Пятёрочка, Ростелеком, Wildberries и МТС.

Проверки ниже стерегут то, что ломается молча: несовпадение версий браузера и
пакета, потерянный результат, забитый диск, параллельные запуски.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
runner = (root / "infra/career-discover-local.sh").read_text(encoding="utf-8")
deploy = (root / "infra/local-web-deploy.sh").read_text(encoding="utf-8")
nginx = (root / "infra/nginx-tls.conf").read_text(encoding="utf-8")
workflow = (root / ".github/workflows/career-discover.yml").read_text(encoding="utf-8")

failures = []


def check(name: str, ok: bool) -> None:
    if not ok:
        failures.append(name)


# ── Версия браузера и версия пакета обязаны совпадать ────────────────────────
# Иначе playwright не найдёт Chromium внутри образа, и прогон упадёт уже в сети.
pinned = re.search(r"playwright@([0-9.]+)", workflow)
local = re.search(r"^PW=\$\{PW:-([0-9.]+)\}", runner, re.M)
check("версия playwright закреплена в workflow", pinned is not None)
check("версия playwright закреплена в скрипте сервера", local is not None)
if pinned and local:
    check(f"версии совпадают ({pinned.group(1)} vs {local.group(1)})",
          pinned.group(1) == local.group(1))
    check("образ берётся той же версии",
          f'mcr.microsoft.com/playwright:v${{PW}}-jammy' in runner)
check("браузеры ищутся внутри образа",
      "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" in runner)

# ── Пакет должен находиться, иначе прогон умирает молча ─────────────────────
# Первая версия полагалась на NODE_PATH. Для ES-модулей он не работает вовсе:
# по имени 'playwright' Node идёт вверх по node_modules от файла, который
# делает import. Прогон умирал на ERR_MODULE_NOT_FOUND, не написав ни строки.
check("на NODE_PATH не полагаемся", "NODE_PATH=" not in runner)
check("скрипт запускается рядом с node_modules",
      "cd /deps/run && node career-discover.mjs" in runner)
# Проверяем саму команду копирования, а не упоминание имени: в первой редакции
# проверка проходила и тогда, когда файл выпал из cp, — имя оставалось в
# комментарии выше.
_cp = re.search(r"cp /repo/scripts/.*?/deps/run/", runner, re.S)
_cp_text = _cp.group(0) if _cp else ""
for _needed in ("career-discover.mjs", "career-discover-lib.mjs", "career-sites.tsv"):
    check(f"копируется {_needed}", _needed in _cp_text)
check("копируется именно в каталог запуска", _cp_text.rstrip().endswith("/deps/run/"))

# ── Результат не должен теряться и не должен появляться недописанным ────────
check("пишем во временный файл", 'tmp="$OUT.tmp"' in runner)
check("готовый файл появляется одним движением", 'mv -f "$tmp" "$OUT"' in runner)
check("пустой результат не подменяет прежний",
      '[ -s "$tmp" ]' in runner and 'rm -f "$tmp"; fail "пустой результат"' in runner)

# ── Забитый диск: образ весит около полутора гигабайт ────────────────────────
check("свободное место проверяется до выкачки образа",
      "df -Pm" in runner and runner.index("df -Pm") < runner.index("docker pull"))
check("порог места задан", "-lt 4096" in runner)

# ── Два прогона разом положили бы сервер ────────────────────────────────────
check("параллельный запуск отсекается", "flock -n 9" in runner)

# ── Репозиторий монтируем только на чтение ──────────────────────────────────
# Внутри контейнера выполняется наш же скрипт, но писать в рабочую копию ему
# незачем, а испорченный git на сервере чинится дольше, чем прогон.
check("репозиторий монтируется только на чтение", '-v "$REPO:/repo:ro"' in runner)

# ── Запуск и расписание ─────────────────────────────────────────────────────
check("юнит заведён", "jt-career-discover.service" in deploy)
check("расписание недельное", "OnUnitInactiveSec=1w" in deploy)
check("первый прогон не ждёт неделю",
      "systemctl start --no-block jt-career-discover.service" in deploy)
# Прогон тянет браузер и ходит по ста семидесяти сайтам: приложение важнее.
check("разведка уступает приложению", "Nice=15" in deploy)
check("у прогона есть предел по времени", "TimeoutStartSec=45min" in deploy)

# ── Отказ не должен быть невидимым ──────────────────────────────────────────
# Первый же запуск это и показал: лог лежит в /var/log, куда со стороны не
# заглянешь, и отличить «ещё идёт» от «молча упала» было нечем. Тот самый изъян,
# за который в этот же день ругали источник career_owner.
check("состояние пишется рядом с результатом", "STATUS=${STATUS:-/var/www/html/career-discovery-status.json}" in runner)
check("о начале работы сообщается", 'state running' in runner)
check("об успехе сообщается", 'state done' in runner)
check("любой отказ пишет состояние", "fail() { say \"$1\"; state error \"$1\"; exit 1; }" in runner)
for reason in ("docker не установлен", "мало места на диске", "пустой результат", "разведка упала"):
    check(f"отказ «{reason}» виден снаружи", f'fail "{reason}' in runner)
check("nginx отдаёт состояние", "location = /career-discovery-status.json {" in nginx)

# ── Результат можно прочитать снаружи ───────────────────────────────────────
check("nginx отдаёт результат", "location = /career-discovery.json {" in nginx)
check("результат не кэшируется",
      re.search(r"location = /career-discovery\.json \{.*?no-store", nginx, re.S) is not None)

if failures:
    print("career discovery (local): ПРОВАЛЫ")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("career discovery (local): ok")
