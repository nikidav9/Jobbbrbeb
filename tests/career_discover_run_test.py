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
      "entry['company'] = key[0]" in run and "entry['discovered_at'] = now_iso" in run)
check("перепроверка ведёт счётчик fails и роняет источник после двух подряд провалов",
      "entry['fails'] = 0" in run and "fails = int(prev.get('fails') or 0) + 1" in run
      and "if fails < 2:" in run)
check("предохранитель от сбоя проверки целиком считает старые записи",
      "verify_failed = len(old_checked) >= 3 and old_ok == 0" in run)
check("removed доходит до каталога: читается третьей строкой",
      "read -r removed" in run and "read -r verify_guard" in run)
check("removed печатается сервером и виден в say",
      "print(removed)" in run and 'удалено $removed' in run)
check("sync-career-catalog.sh запускается и при removed>0",
      '[ "$accepted" -gt 0 ] || [ "$removed" -gt 0 ]' in run)
check("removed попадает в статус-файл", "'removed': int(removed)" in run)
check("устаревший $OUT.partial убирается при пустом частичном результате",
      'rm -f "$tmp" "$OUT.partial"' in run)
check("устаревший $OUT.partial убирается после успешного прогона",
      'rm -f "$OUT.partial"' in run and 'mv -f "$tmp" "$OUT"' in run)

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
LATER = "2026-10-02T00:00:00Z"

# Запись, которую в этот прогон вообще не присылали на проверку (не попала ни
# в candidates, ни в verify_rows), остаётся нетронутой — её просто не трогали.
existing = [{"company": "Ростелеком", "url": "https://old.example/a", "discovered_at": "2026-01-01T00:00:00Z"}]
merged, guard, removed = merge_discovered(existing, [], [], NOW)
check("непроверенная запись не тронута", any(e.get("company") == "Ростелеком" and e.get("url") == "https://old.example/a" for e in merged))
check("без перепроверки предохранитель молчит", guard == "")
check("без перепроверки removed=0", removed == 0)

# Новая принятая находка добавляется с company/discovered_at/verified_at/fails=0,
# поля самого endpoint (mode и т.п.) сохраняются.
candidates_new = [{"company": "МТС", "endpoint": {"url": "https://mts.example/api", "mode": "json"}}]
verify_new = [{"company": "МТС", "url": "https://mts.example/api", "ok": True}]
merged_new, _, _ = merge_discovered([], candidates_new, verify_new, NOW)
mts_rows = [e for e in merged_new if e.get("company") == "МТС"]
check("новая находка добавлена", len(mts_rows) == 1)
check("company проставлен", mts_rows and mts_rows[0].get("company") == "МТС")
check("discovered_at проставлен", mts_rows and mts_rows[0].get("discovered_at") == NOW)
check("verified_at проставлен", mts_rows and mts_rows[0].get("verified_at") == NOW)
check("fails=0 у новой записи", mts_rows and mts_rows[0].get("fails") == 0)
check("поля endpoint (mode) не потеряны при слиянии", mts_rows and mts_rows[0].get("mode") == "json")

# Новая находка, которую career_verify.php отклонил, вообще не добавляется.
candidates_bad = [{"company": "Плохие", "endpoint": {"url": "https://bad.example/api", "mode": "json"}}]
verify_bad = [{"company": "Плохие", "url": "https://bad.example/api", "ok": False}]
merged_bad, _, _ = merge_discovered([], candidates_bad, verify_bad, NOW)
check("отклонённая новая находка не добавлена", not any(e.get("company") == "Плохие" for e in merged_bad))

# ── Перепроверка уже накопленных записей: счётчик fails ─────────────────────
def rerun(existing_rows, ok):
    company = existing_rows[0]["company"]
    url = existing_rows[0]["url"]
    candidates = [{"company": company, "endpoint": {"url": url}}]
    verify = [{"company": company, "url": url, "ok": ok}]
    merged, _, _ = merge_discovered(existing_rows, candidates, verify, LATER)
    return merged

base = [{"company": "Магнит", "url": "https://magnit.example/api", "mode": "json",
         "discovered_at": "2026-01-01T00:00:00Z", "verified_at": "2026-01-01T00:00:00Z", "fails": 0}]

# Успех сбрасывает fails и обновляет verified_at, discovered_at не трогает.
ok_merged = rerun(base, True)
ok_row = next(e for e in ok_merged if e.get("company") == "Магнит")
check("успех: fails сброшен", ok_row.get("fails") == 0)
check("успех: verified_at обновлён", ok_row.get("verified_at") == LATER)
check("успех: discovered_at не тронут", ok_row.get("discovered_at") == "2026-01-01T00:00:00Z")

# Один провал — запись остаётся, fails=1.
once_failed = rerun(base, False)
check("провал 1 раз: запись осталась", any(e.get("company") == "Магнит" for e in once_failed))
once_row = next(e for e in once_failed if e.get("company") == "Магнит")
check("провал 1 раз: fails=1", once_row.get("fails") == 1)

# Второй подряд провал — запись удаляется, и это учтено в removed.
twice_failed_merged, twice_guard, twice_removed = merge_discovered(
    once_failed,
    [{"company": "Магнит", "endpoint": {"url": "https://magnit.example/api"}}],
    [{"company": "Магнит", "url": "https://magnit.example/api", "ok": False}],
    LATER,
)
check("провал 2 раза подряд: запись удалена", not any(e.get("company") == "Магнит" for e in twice_failed_merged))
check("провал 2 раза подряд: removed=1", twice_removed == 1)
check("провал 2 раза подряд: предохранитель не сработал (одна запись)", twice_guard == "")

# ── Предохранитель: сбой career_verify.php целиком, а не смерть источников ──
# Три СТАРЫЕ записи, все три ok=false: это не «все три источника сдохли
# разом», а похоже на сбой самой проверки (например, у php-контейнера
# пропала сеть). fails не должны расти, записи должны остаться как были.
guard_existing = [
    {"company": "А", "url": "https://a.example/api", "fails": 0},
    {"company": "Б", "url": "https://b.example/api", "fails": 1},
    {"company": "В", "url": "https://v.example/api", "fails": 0},
]
guard_candidates = [{"company": e["company"], "endpoint": {"url": e["url"]}} for e in guard_existing]
guard_verify_all_fail = [{"company": e["company"], "url": e["url"], "ok": False} for e in guard_existing]
guard_merged, guard_msg, guard_removed = merge_discovered(
    guard_existing, guard_candidates, guard_verify_all_fail, LATER
)
check("предохранитель: ни одна запись не удалена", len(guard_merged) == len(guard_existing))
check("предохранитель: fails не выросли",
      all(next(e for e in guard_merged if e["company"] == g["company"]).get("fails") == g["fails"]
          for g in guard_existing))
check("предохранитель: флаг сбоя поднят", bool(guard_msg))
check("предохранитель: текст про 0 из N ok", guard_msg == "перепроверка не засчитана: 0 из 3 ok")
check("предохранитель: removed=0", guard_removed == 0)

# Контрольный случай: три старые записи, одна ok, две нет — предохранитель НЕ
# срабатывает (проверка явно работает, раз хоть один источник прошёл), у двух
# fails растёт как обычно.
guard_verify_one_ok = [
    {"company": "А", "url": "https://a.example/api", "ok": True},
    {"company": "Б", "url": "https://b.example/api", "ok": False},
    {"company": "В", "url": "https://v.example/api", "ok": False},
]
mixed_merged, mixed_msg, mixed_removed = merge_discovered(
    guard_existing, guard_candidates, guard_verify_one_ok, LATER
)
check("предохранитель не срабатывает при частичном успехе", mixed_msg == "")
mixed_v = next(e for e in mixed_merged if e["company"] == "В")
check("частичный успех: у Б fails+1 (было 1 → 2, удалена)",
      not any(e["company"] == "Б" for e in mixed_merged))
check("частичный успех: у В fails+1 (было 0 → 1, осталась)", mixed_v.get("fails") == 1)
check("частичный успех: removed=1 (Б удалена)", mixed_removed == 1)

if failures:
    print("career discover run: ПРОВАЛЫ")
    for item in failures:
        print("  -", item)
    sys.exit(1)
print("career discover run: ok")
