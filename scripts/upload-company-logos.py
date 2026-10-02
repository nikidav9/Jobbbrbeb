#!/usr/bin/env python3
"""Заливает проверенные логотипы компаний в базу (миграция 144).

Источник правды — data/company-logos/manifest.json и PNG рядом: каждый
логотип 256×256 просмотрен глазами (решение владельца 02.10.2026: сайт
компании, иначе Викисклад). Сервер называет файл по ключу компании и
содержимому — сравниваем с тем, что он уже отдаёт (dbCompanyLogos), и шлём
только новое или изменившееся (adminCompanyLogoPut). Только stdlib.

Окружение: APP_SECRET, ADMIN_TOKEN; API — https://jobtoo.ru/api/db.php.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = os.environ.get("JOBTOO_API", "https://jobtoo.ru/api/db.php")
ROOT = Path(__file__).resolve().parent.parent / "data" / "company-logos"


def key_of(company: str) -> str:
    """Как jt_company_logo_key на сервере."""
    return re.sub(r"\s+", " ", company.strip()).lower()


def path_of(key: str, png: bytes) -> str:
    """Как jt_company_logo_path на сервере."""
    return hashlib.sha1(key.encode()).hexdigest()[:12] + "-" + hashlib.sha1(png).hexdigest()[:10] + ".png"


def call(fn: str, args: list, admin: bool = False) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json", "X-App-Secret": os.environ["APP_SECRET"]}
    if admin:
        headers["X-Admin-Token"] = os.environ["ADMIN_TOKEN"]
    req = urllib.request.Request(API, json.dumps({"fn": fn, "args": args}).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def todo(manifest: list[dict], served: dict[str, str]) -> list[dict]:
    """Записи, которых на сервере нет или которые там другие."""
    out = []
    for item in manifest:
        png = (ROOT / item["file"]).read_bytes()
        key = key_of(item["company"])
        if not served.get(key, "").endswith("/" + path_of(key, png)):
            out.append({**item, "png": png})
    return out


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for attempt in range(6):  # сервер мог ещё не накатить миграцию 144
        code, body = call("dbCompanyLogos", [])
        if code == 200 and isinstance(body.get("logos"), dict):
            break
        print(f"dbCompanyLogos: {code} {str(body)[:200]} — ждём выкладку", flush=True)
        time.sleep(60)
    else:
        return 1
    queue = todo(manifest, body["logos"])
    print(f"В наборе {len(manifest)}, залить {len(queue)}", flush=True)
    failed = 0
    for item in queue:
        code, resp = call("adminCompanyLogoPut", [item["company"], base64.b64encode(item["png"]).decode(),
                                                  item["source"], item["source_url"]], admin=True)
        ok = code == 200 and resp.get("ok")
        failed += 0 if ok else 1
        print(("ok   " if ok else f"FAIL {code} {resp} ") + item["company"], flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
