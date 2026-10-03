"""Сторож разового удаления людей (infra/wipe-users.sh, 03.10.2026).

Проверяет то, что нельзя перепутать: каталог в TRUNCATE не входит, таблицы
очищаются раньше ящика, файлов и копий, а при сбое таблиц сценарий выходит,
не дойдя до них. Только чтение исходника — ничего не запускает.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / "infra" / "wipe-users.sh").read_text(encoding="utf-8")
BOOT = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")
fails = []


def check(name, ok):
    if not ok:
        fails.append(name)


check("синтаксис bash", subprocess.run(["bash", "-n", str(ROOT / "infra" / "wipe-users.sh")]).returncode == 0)

tables = re.search(r'TABLES="([^"]+)"', SRC).group(1).split()
for keep in ("jm_ext_vacancies", "jm_ext_sources", "jm_ext_ingest_runs", "jm_it_companies",
             "jm_company_logos", "jm_jupiter_field_hints", "jm_support_knowledge",
             "jm_api_keys", "jm_migrations", "jm_settings"):
    check(f"каталог не удаляется: {keep}", keep not in tables)
for gone in ("jm_users", "jm_jupiter_applications", "jm_resume_files", "jm_messages", "jm_ext_swipes"):
    check(f"люди удаляются: {gone}", gone in tables)
check("TRUNCATE без CASCADE", "cascade" not in SRC.lower().split("truncate", 1)[1].split(";", 1)[0])

pos = {k: SRC.find(v) for k, v in {
    "tables": "truncate $existing", "exit": 'step stopped "таблицы не очистились', "imap": "imaplib.IMAP4_SSL",
    "buckets": "/storage/v1/bucket/", "files": "rm -f /var/lib/jupiter/receipts.json",
    "backups": "rm -f /opt/jobtoo-backups/",
}.items()}
check("все шаги на месте", all(v >= 0 for v in pos.values()))
check("таблицы — первыми, сбой — выход до остального",
      pos["tables"] < pos["exit"] < min(pos["imap"], pos["buckets"], pos["files"], pos["backups"]))
check("бакет логотипов не трогаем", "company-logos" not in SRC.split("for b in", 1)[1].split("done", 1)[0])
check("отметки импорта не трогаем", "jm_migrations" not in tables)

check("bootstrap: по новому содержимому wipe-users-now", "wipe-users.sha" in BOOT and 'WU_FILE="$REPO/infra/wipe-users-now"' in BOOT)
check("bootstrap: только после удачных миграций", '[ "$MIGRATIONS_READY" = 1 ] && [ -f "$WU_FILE" ]' in BOOT)

if fails:
    print("wipe users: ПРОВАЛЫ")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("wipe users: OK")
