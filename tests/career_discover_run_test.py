#!/usr/bin/env python3
"""Недельная разведка карьерных сайтов на сервере: скрипт и systemd-таймер."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "infra/career-discover-run.sh"
BOOTSTRAP = ROOT / "infra/bootstrap.sh"

run = RUN.read_text(encoding="utf-8")
bootstrap = BOOTSTRAP.read_text(encoding="utf-8")

failures = []


def check(name: str, ok: bool) -> None:
    if not ok:
        failures.append(name)


# ── career-discover-run.sh: текстовые проверки ──────────────────────────────
check("защита от параллельного запуска", "flock -n 9" in run)
check("сохранена проверка места на диске", "мало места на диске" in run)
check("set -Eeuo pipefail сохранён", "set -Eeuo pipefail" in run)

check("компании с активными вакансиями читаются из базы",
      "select distinct company from jm_ext_vacancies where active" in run)
check("список компаний уходит в контейнер как DISCOVER_SKIP_FILE",
      "-e DISCOVER_SKIP_FILE=/deps/run/discover-skip.txt" in run)
check("список компаний лежит в /deps/run рядом со скриптом",
      'run_dir="$(dirname "$MODULES")/run"' in run)

check("контейнер разведки ограничен по памяти", "--memory 1g" in run)
check("контейнер разведки ограничен по CPU", "--cpus 1" in run)
check("DISCOVER_CONCURRENCY по умолчанию 2",
      'DISCOVER_CONCURRENCY="${DISCOVER_CONCURRENCY:-2}"' in run)

check("найденное проверяется career_verify.php",
      "docker compose exec -T php php /var/www/api/career_verify.php" in run)
check("отсутствие career_verify.php в контейнере — понятная ошибка",
      "career_verify.php не развёрнут в контейнере php" in run
      and "test -f /var/www/api/career_verify.php" in run)

check("discovered.json пишется атомарно (tmp + переименование)",
      "tmp = discovered_path + '.tmp'" in run and "os.replace(tmp, discovered_path)" in run)
check("перед перезаписью снимается резервная копия",
      "shutil.copy2(discovered_path, discovered_path + '.bak')" in run)
check("в discovered.json проставляются company и discovered_at",
      "entry['company'] = row['company']" in run and "entry['discovered_at'] = now_iso" in run)

check("при найденных endpoints запускается sync-career-catalog.sh",
      'bash "$REPO/infra/sync-career-catalog.sh"' in run)
check("сбой sync-career-catalog.sh не должен терять результат разведки",
      "sync-career-catalog.sh упал, результат разведки сохранён" in run)

check("итоговый статус несёт полную схему отчёта",
      all(key in run for key in (
          "'state': 'done'", "'targets'", "'ready'", "'closed'",
          "'accepted'", "'rejected'", "'live_companies'", "'live_vacancies'",
      )))
check("живые числа берутся из базы после прогона",
      "select count(distinct company), count(*) from jm_ext_vacancies where active" in run)
check("публичные файлы открыты (chmod 644)",
      run.count("chmod 0644") >= 2 or ("chmod(status_path, 0o644)" in run and "chmod 0644" in run))

# ── bootstrap.sh: недельный таймер ──────────────────────────────────────────
check("bootstrap ставит jt-career-discover из infra/career-discover-run.sh",
      'if [ -f "$REPO/infra/career-discover-run.sh" ]' in bootstrap
      and "/usr/local/bin/jt-career-discover" in bootstrap)

unit = bootstrap[bootstrap.index("jt-career-discover.service <<'EOF'"):
                  bootstrap.index("jt-career-discover.timer <<'EOF'")]
check("сервис — oneshot", "Type=oneshot" in unit)
check("у сервиса щедрый TimeoutStartSec (браузер на 62+ сайта не мгновенен)",
      "TimeoutStartSec=6h" in unit)
check("сервис ждёт docker", "After=docker.service" in unit and "Wants=docker.service" in unit)

timer = bootstrap[bootstrap.index("jt-career-discover.timer <<'EOF'"):]
timer = timer[:timer.index("EOF", timer.index("[Timer]"))]
check("таймер недельный (по воскресеньям)", re.search(r"OnCalendar=Sun ", timer) is not None)
check("таймер переживает выключенную машину", "Persistent=true" in timer)

check("первый прогон запускается сразу, если лога ещё нет",
      "/var/log/jt-career-discover.log" in bootstrap and "systemctl start --no-block" in bootstrap)

# ── Синтаксис обоих shell-скриптов ──────────────────────────────────────────
for script in (RUN, BOOTSTRAP):
    result = subprocess.run(["bash", "-n", str(script)], capture_output=True, text=True)
    check(f"bash -n {script.name}", result.returncode == 0)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)

# ── Логика слияния discovered.json — реальный прогон, а не текст ───────────
begin = run.index("# ── career-discover-merge:begin")
end = run.index("# ── career-discover-merge:end") + len("# ── career-discover-merge:end")
marker_end = run.index("\n", end) + 1
merge_src = run[run.index("def merge_discovered", begin):marker_end]
# До первого встреченного маркера конца комментария отрезаем хвостовой текст,
# оставляя только тело функции.
merge_src = merge_src[:merge_src.index("# ── career-discover-merge:end")]

namespace: dict = {}
exec(merge_src, namespace)  # noqa: S102 — доверенный код из своего же репозитория
merge_discovered = namespace["merge_discovered"]

NOW = "2026-09-25T00:00:00Z"

# Старая запись другой компании сохраняется нетронутой.
existing = [{"company": "Ростелеком", "url": "https://old.example/a", "discovered_at": "2026-01-01T00:00:00Z"}]
accepted_rows = [{"company": "МТС", "endpoint": {"url": "https://mts.example/api", "mode": "json"}}]
merged = merge_discovered(existing, accepted_rows, NOW)
check("запись другой компании не тронута", any(e.get("company") == "Ростелеком" and e.get("url") == "https://old.example/a" for e in merged))
check("новая компания добавлена", any(e.get("company") == "МТС" and e.get("url") == "https://mts.example/api" for e in merged))

# Запись той же компании заменяется, а не копится рядом со старой.
existing2 = [{"company": "МТС", "url": "https://mts.example/old", "discovered_at": "2025-01-01T00:00:00Z"}]
accepted_rows2 = [{"company": "МТС", "endpoint": {"url": "https://mts.example/new", "mode": "json"}}]
merged2 = merge_discovered(existing2, accepted_rows2, NOW)
mts_rows = [e for e in merged2 if e.get("company") == "МТС"]
check("старый endpoint той же компании не остаётся рядом с новым", len(mts_rows) == 1)
check("заменённая запись — это новый endpoint", mts_rows and mts_rows[0].get("url") == "https://mts.example/new")

# company и discovered_at проставлены в каждой новой записи.
check("company проставлен", mts_rows and mts_rows[0].get("company") == "МТС")
check("discovered_at проставлен", mts_rows and mts_rows[0].get("discovered_at") == NOW)
# Поля самого endpoint (mode и т.п.) должны сохраниться внутри записи.
check("поля endpoint (mode) не потеряны при слиянии", mts_rows and mts_rows[0].get("mode") == "json")

if failures:
    print("career discover run: ПРОВАЛЫ")
    for item in failures:
        print("  -", item)
    sys.exit(1)
print("career discover run: ok")
