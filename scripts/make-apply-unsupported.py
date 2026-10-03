#!/usr/bin/env python3
"""Список компаний, где автоотклик не получился ни на одном адресе (03.10.2026).

Берёт итог браузерной разведки (jupiter-recon-browser.json) и пишет
php-proxy/apply_unsupported.php. Компания попадает в список, только если на
КАЖДОМ её адресе разведка вернула VACANCY_NOT_FOUND с кодом 200 — то есть
страница открылась, а анкеты и кнопки отклика на ней нет. Не попадают:
  - снятые вакансии (текст «вакансия не найдена/снята…»): это беда одной вакансии;
  - проверка браузера, «Loading», таймауты: сайт мог быть недоступен временно;
  - любые другие исходы (сеть, капча, почта, неразобранная анкета).
Запуск: python3 scripts/make-apply-unsupported.py путь/к/jupiter-recon-browser.json
"""
import json
import re
import sys
from collections import defaultdict

GONE = re.compile(r"(вакансия не найдена|вакансия снята|снята с публикации|вакансия закрыта|в архиве|"
                  r"больше недоступна|страница не найдена)", re.I)
TEMP = re.compile(r"(проверк|cloudflare|timed out|loading|just a moment)", re.I)


def base_name(name: str) -> str:
    """«Самокат · /» и «Самокат» — одна компания."""
    return re.split(r"\s+·\s+", name)[0].strip()


def unsupported(records: list[dict]) -> list[str]:
    by = defaultdict(list)
    for r in records:
        by[base_name(r.get("name", ""))].append(r)
    out = []
    for name, rows in by.items():
        if not name:
            continue
        ok = True
        for r in rows:
            text = ((r.get("diagnostic") or {}).get("text_head") or "")
            if (r.get("reason_code") != "VACANCY_NOT_FOUND"
                    or str(r.get("http_status")) != "200"
                    or GONE.search(text) or TEMP.search(text)):
                ok = False
                break
        if ok:
            out.append(name)
    return sorted(set(out), key=str.lower)


def render(names: list[str]) -> str:
    lines = [
        "<?php",
        "// Сгенерировано scripts/make-apply-unsupported.py по итогу браузерной разведки",
        "// 03.10.2026. Не править руками: перегенерировать после новой разведки.",
        "// Компании, у которых на каждом адресе нет анкеты и кнопки отклика.",
        "return [",
    ]
    for n in names:
        lines.append("    " + json.dumps(n.lower(), ensure_ascii=False) + ",")
    lines.append("];")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    names = unsupported(json.load(open(sys.argv[1], encoding="utf-8")))
    open("php-proxy/apply_unsupported.php", "w", encoding="utf-8").write(render(names))
    print(f"компаний без автоотклика: {len(names)}")
