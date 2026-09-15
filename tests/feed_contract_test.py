#!/usr/bin/env python3
"""Договор между сборщиками и приёмником: писать те же ключи, что читаются.

Сборщик и ingest.php связаны не типом, а именем ключа в массиве. Ошибка в
имени ничего не ломает и ничего не печатает: поле просто молча пропадает,
и заметить это можно только по пустой колонке через месяц.

Именно так уже случилось: headhunter.php писал `metro_station`, а
ing_normalize читает `metro` — станция метро терялась у каждой вакансии
hh.ru. На сводных страницах «работа у метро» это означало бы, что источник
не даёт ни одной станции.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ingest = (root / "php-proxy/ingest.php").read_text(encoding="utf-8")

# Что приёмник вообще умеет прочитать из присланного элемента.
known = set(re.findall(r"\$it\['([a-z_]+)'\]", ingest))
assert "title" in known and "metro" in known, "не разобрали ing_normalize"

adapters = ["headhunter.php", "superjob.php", "arbihunter.php"]

failures = []
for name in adapters:
    text = (root / "php-proxy" / name).read_text(encoding="utf-8")
    # Дописывания в собираемый элемент: $item['key'] = ...
    written = set(re.findall(r"\$item\['([a-z_]+)'\]\s*=", text))
    # И литерал, которым элемент заводится: $item = [ 'key' => ..., ];
    for block in re.findall(r"\$item\s*=\s*\[(.*?)\];", text, re.S):
        written |= set(re.findall(r"'([a-z_]+)'\s*=>", block))
    if not written:
        failures.append(f"{name}: не нашли, из чего собирается элемент — проверка ослепла")
    for key in sorted(written - known):
        failures.append(f"{name}: ключ '{key}' никто не читает в ingest.php")

if failures:
    print("feed contract: ПРОВАЛЫ")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("feed contract: ok")
