#!/usr/bin/env python3
"""Заслон от секретов в коде: токены и ключи не должны попасть в публичный репозиторий.

03.10.2026 в описании телеграм-бота появилась реклама VPN: токен бота лежал в
публичной истории git. Из истории секрет не вычистить, остаётся не пускать новые.

Проверяются только ДОБАВЛЕННЫЕ строки (разница с базовой веткой) либо, с --all,
всё дерево. Нашёл — код возврата 1, значения в вывод не попадают (только файл,
строка и вид). Если строка нарочно содержит образец (тест, документация), в
конце строки ставится метка `secret-scan:allow`. Библиотеки скиллов
(.agents/, .claude/) и lock-файлы не проверяются: там образцы по замыслу.

    python3 scripts/secret-scan.py --base origin/main     # то, что добавил PR
    python3 scripts/secret-scan.py --all                  # всё дерево
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys

ALLOW_MARK = "secret-scan:allow"
SKIP_PREFIXES = (".agents/", ".claude/", "node_modules/")
SKIP_NAMES = ("package-lock.json", "skills-lock.json", "deno.lock")

PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("токен телеграм-бота", re.compile(r"(?<![\w:])\d{8,10}:[A-Za-z0-9_-]{35}(?![\w-])")),
    ("закрытый ключ", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("ключ AWS", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("токен GitHub", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    ("ключ Яндекс Облака", re.compile(r"\b(?:AQVN[A-Za-z0-9_-]{30,}|y0_[A-Za-z0-9_-]{40,}|t1\.[A-Za-z0-9_.-]{60,})")),
    ("токен Slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{20,}")),
)
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}")
# Роль в JWT: anon публична по замыслу (она в каждой сборке приложения),
# service_role и прочие серверные — нет.
PUBLIC_ROLES = {"anon"}


def jwt_role(payload: str) -> str | None:
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:
        return None
    return str(data.get("role")) if isinstance(data, dict) and data.get("role") else None


def scan_line(line: str) -> list[str]:
    """Виды секретов в строке (значения не возвращаются)."""
    if ALLOW_MARK in line:
        return []
    found = [name for name, rx in PATTERNS if rx.search(line)]
    for m in JWT.finditer(line):
        role = jwt_role(m.group(1))
        if role and role not in PUBLIC_ROLES:
            found.append(f"ключ Supabase с ролью {role}")
    return found


def skipped(path: str) -> bool:
    return path.startswith(SKIP_PREFIXES) or path.rsplit("/", 1)[-1] in SKIP_NAMES


def added_lines(base: str) -> list[tuple[str, int, str]]:
    out = subprocess.run(
        ["git", "diff", "--unified=0", "--no-color", f"{base}...HEAD"],
        capture_output=True, text=True, errors="replace", check=True,
    ).stdout
    res, path, line_no = [], "", 0
    for raw in out.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
        elif raw.startswith("+++ "):
            path = ""
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            line_no = int(m.group(1)) - 1 if m else 0
        elif raw.startswith("+") and path:
            line_no += 1
            res.append((path, line_no, raw[1:]))
    return res


def all_lines() -> list[tuple[str, int, str]]:
    files = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    res = []
    for path in filter(None, files):
        try:
            with open(path, encoding="utf-8", errors="strict") as fh:
                res.extend((path, n, text.rstrip("\n")) for n, text in enumerate(fh, 1))
        except (OSError, UnicodeDecodeError):
            continue
    return res


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="origin/main", help="с чем сравнивать (добавленные строки)")
    parser.add_argument("--all", action="store_true", help="проверить всё дерево, а не разницу")
    args = parser.parse_args(argv[1:])
    lines = all_lines() if args.all else added_lines(args.base)
    hits = [(p, n, kind) for p, n, text in lines if not skipped(p) for kind in scan_line(text)]
    for path, n, kind in hits:
        print(f"{path}:{n}: {kind} (значение не показано)")
    if hits:
        print(f"\nНайдено секретов: {len(hits)}. Уберите их из кода: токен живёт только в GitHub Secrets;"
              " если он уже был в коммите — отзовите его (для бота: BotFather → Revoke).")
        return 1
    print("secret-scan: секретов в добавленном коде нет")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
