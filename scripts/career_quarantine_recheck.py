#!/usr/bin/env python3
"""Повторная проверка источников вакансий в карантине (01.10.2026).

scripts/career-runtime-quarantine.json — источники, которые сбор отключил
16.09: сервер получал от них 403/404/405 или ошибку сертификата. Среди них
Пятёрочка, Wildberries, МегаФон, Ростелеком, Lamoda — крупные работодатели,
которых сейчас нет в ленте. Сайты меняются: здесь каждую ночь с сервера тот же
первый запрос, что сделал бы сбор (адрес, метод и тело из
scripts/career-endpoints.json, подпись JobToo), и подсчёт, сколько вакансий он
дал бы. Итог — открытый JSON: только адреса работодателей и числа. Из
карантина источник выпускается через PR, после проверки.

    python3 career_quarantine_recheck.py --out /var/www/html/career-quarantine-check.json
Только stdlib.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
QUARANTINE = ROOT / "scripts" / "career-runtime-quarantine.json"
ENDPOINTS = ROOT / "scripts" / "career-endpoints.json"
# Та же честная подпись, что у сбора (php-proxy/career_unit.php).
USER_AGENT = "JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)"
MAX_BYTES = 3_000_000


def dig(data: Any, path: str) -> Any:
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(data, dict):
            data = data.get(part)
        elif isinstance(data, list) and part.isdigit() and int(part) < len(data):
            data = data[int(part)]
        else:
            return None
    return data


def count_items(body: str, endpoint: dict | None) -> int | None:
    """Сколько вакансий дал бы первый ответ: JSON — длина списка по map.list,
    страница со ссылками — ссылки с link_path. Не знаем как — None."""
    if not endpoint:
        return None
    mapping = endpoint.get("map") or {}
    mode = endpoint.get("mode", "json")
    if mode == "json":
        try:
            data = json.loads(body)
        except ValueError:
            return 0
        items = dig(data, mapping.get("list", ""))
        return len(items) if isinstance(items, list) else 0
    if mode == "html_links" and mapping.get("link_path"):
        hrefs = re.findall(r"href=[\"']([^\"'#]+)", body)
        needle = mapping["link_path"]
        return len({h for h in hrefs if needle in h and not h.rstrip("/").endswith(needle.rstrip("/"))})
    return None


def probe(entry: dict, endpoint: dict | None, timeout: float = 25.0, opener=None) -> dict[str, Any]:
    url = str(entry.get("url") or "")
    method = (endpoint or {}).get("method", "GET").upper()
    data = None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.9, */*;q=0.1"}
    if method == "POST":
        data = json.dumps((endpoint or {}).get("body") or {}).encode("utf-8")
        headers["Content-Type"] = "application/json"
    result: dict[str, Any] = {
        "company": entry.get("company"), "url": url, "was": entry.get("reason"),
        "observed_at": entry.get("observed_at"),
    }
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    started = time.monotonic()
    try:
        with (opener or urllib.request.urlopen)(req, timeout=timeout) as resp:
            body = resp.read(MAX_BYTES).decode("utf-8", "replace")
            result["status"] = resp.status
            result["items"] = count_items(body, endpoint)
    except urllib.error.HTTPError as exc:
        result["status"] = exc.code
    except ssl.SSLError as exc:
        result["status"] = "tls"
        result["error"] = str(exc)[:160]
    except (urllib.error.URLError, OSError) as exc:
        result["status"] = "сеть"
        result["error"] = f"{type(exc).__name__}: {exc}"[:160]
    result["seconds"] = round(time.monotonic() - started, 1)
    # Можно выпускать: ответ 200 и вакансии есть (или счёт неприменим).
    result["looks_ok"] = result.get("status") == 200 and (result.get("items") is None or result["items"] > 0)
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    quarantine = json.loads(QUARANTINE.read_text(encoding="utf-8"))
    endpoints = {e["url"]: e for e in json.loads(ENDPOINTS.read_text(encoding="utf-8"))}
    results = [probe(entry, endpoints.get(entry.get("url"))) for entry in quarantine]
    payload = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "ok": sum(1 for r in results if r["looks_ok"]), "total": len(results), "sources": results}
    tmp = args.out + ".tmp"
    Path(tmp).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(tmp, 0o644)
    os.replace(tmp, args.out)
    print(f"карантин: {payload['ok']} из {payload['total']} источников снова отвечают с вакансиями")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
