#!/usr/bin/env python3
"""Новые id безопасны, старые пользователи не отрезаны."""
import sys
from pathlib import Path

db = (Path(__file__).resolve().parents[1] / "php-proxy/db.php").read_text(encoding="utf-8")
failures = []


def check(name: str, condition: bool) -> None:
    if not condition:
        failures.append(name)


check("проверка формата вынесена в одно правило", "function jt_new_user_id_is_valid" in db)
check("разрешены только строчные латинские буквы и цифры",
      "\\A[a-z0-9]{8,32}\\z" in db)

start = db.index("case 'dbUpsertUser': {")
end = db.index("case 'dbLogin': {", start)
block = db[start:end]
existing = block.index("$existing = sb_single")
guard = block.index("if (!$existing && !jt_new_user_id_is_valid($uid))")
write = block.index("sb_upsert('jm_users'")

check("сначала выясняется, существует ли пользователь", existing < guard)
check("негодный новый id отсекается до записи", guard < write)
check("проверка касается только новых пользователей", "if (!$existing &&" in block)

if failures:
    print("user id contract: ПРОВАЛЫ")
    for failure in failures:
        print("  -", failure)
    sys.exit(1)
print("user id contract: ok")
