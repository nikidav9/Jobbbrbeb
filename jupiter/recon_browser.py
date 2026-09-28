#!/usr/bin/env python3
"""Разведка форм отклика браузерным движком.

То же, что recon.py, но вместо HTTP-клиента — Chromium (browser_engine.py):
он сам нажимает «Откликнуться» и видит анкеты, которые рисует скрипт. Агент —
JupiterAgent(dry_run=True) с синтетическим кандидатом, движок read_only=True:
любой не-GET запрос обрывается в самом браузере, заявки не уходят.

Итог — список в том же формате, что у recon.py (klass, reason_code,
form_fields…, поэтому site_compat.recon_ok_hosts читает его так же), плюс
engine="browser" и browser_actions (что движок сделал сам). Каждый сайт идёт в
отдельном процессе: жёсткий таймаут на сайт и зависший Chromium не роняют обход.
Одновременно — не больше двух браузеров.

Запуск:
    python3 recon_browser.py --limit 5 --out /tmp/recon-browser.json
    python3 recon_browser.py --only-hosts vkusvill.ru magnit.ru
    python3 recon_browser.py --urls https://a.example/jobs --baseline ../jupiter-recon.json
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from recon import (
    CLASSES, ENDPOINTS_JSON, TEST_CANDIDATE, ReconResult, NetOptions,
    _aggregator_links, _form_snapshot, block_kind, classify, endpoint_for,
    load_sites, make_engine, vacancy_from_endpoint,
)
from site_compat import normalize_host, profile_for_url

MAX_BROWSERS = 2
DEFAULT_OUT = "jupiter-recon-browser.json"
DEFAULT_BASELINE = os.environ.get("JUPITER_RECON_FILE", "jupiter-recon.json")
RESULT_MARK = "@@RECON_RESULT@@"


@dataclass
class BrowserReconResult(ReconResult):
    engine: str = "browser"
    browser_actions: list[dict[str, Any]] = field(default_factory=list)


def recon_site_browser(
    name: str, url: str, endpoints: list[dict], resume: str,
    *, timeout: float = 30.0, chromium: str | None = None,
) -> BrowserReconResult:
    """Один сайт в этом процессе. Вызывать из потока, где живёт Playwright."""
    from agent import CandidateProfile, JupiterAgent
    from browser_engine import JupiterBrowserEngine
    from engine import EngineError, EngineSecurityError
    from submission import ReceiptStore

    profile = profile_for_url(url)
    result = BrowserReconResult(
        name=name, url=url, start_url=url, klass="blocked",
        has_profile=profile is not None,
        has_overrides=bool(profile and profile.field_overrides),
    )
    endpoint = endpoint_for(name, url, endpoints)
    if endpoint:  # адрес живой вакансии — HTTP-разведкой, это всего лишь GET
        probe = make_engine({normalize_host(url)}, NetOptions(min(timeout, 15.0)))
        try:
            result.start_url = vacancy_from_endpoint(probe, endpoint) or url
        except Exception:
            pass
    hosts = {normalize_host(result.start_url), normalize_host(url)}
    try:
        engine = JupiterBrowserEngine(
            hosts, read_only=True, timeout=timeout, executable_path=chromium,
        )
    except EngineError as exc:
        result.reason = f"browser: {exc}"[:300]
        return result
    try:
        agent = JupiterAgent(
            set(hosts), max_steps=10, engine=engine, dry_run=True,
            receipts=ReceiptStore(None),
        )
        candidate = CandidateProfile(values=dict(TEST_CANDIDATE), resume_path=resume)
        try:
            outcome = agent.run(result.start_url, candidate)
        except EngineSecurityError as exc:
            result.reason = f"security: {exc}"
            return result
        except Exception as exc:
            result.reason = f"crash: {type(exc).__name__}: {exc}"[:300]
            result.klass = "no_vacancy"
            return result
        page = engine.page
        result.status = outcome.status
        result.reason_code = outcome.reason_code or ""
        result.reason = (outcome.reason or "")[:300]
        result.final_url = page.url if page else ""
        result.http_status = page.status if page else None
        result.aggregator_links = _aggregator_links(page)
        result.form_fields = _form_snapshot(page)
        result.browser_actions = list(engine.actions)[:50]
        result.klass = classify(outcome.status, outcome.reason_code, page, result.aggregator_links)
        if result.klass == "blocked":
            result.block_kind = block_kind(result.reason)
        return result
    finally:
        engine.close()


def _run_child(name: str, url: str, timeout: float, deadline: float, chromium: str | None) -> BrowserReconResult:
    """Сайт в отдельном процессе с жёстким сроком."""
    cmd = [sys.executable, os.path.abspath(__file__), "--_one", name, url,
           "--timeout", str(timeout)]
    if chromium:
        cmd += ["--chromium", chromium]
    result = BrowserReconResult(name=name, url=url, start_url=url, klass="blocked")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=deadline)
    except subprocess.TimeoutExpired:
        result.reason = f"timeout: сайт не уложился в {deadline:.0f} с"
        result.block_kind = "таймаут"
        return result
    for line in reversed(proc.stdout.splitlines()):
        if line.startswith(RESULT_MARK):
            try:
                data = json.loads(line[len(RESULT_MARK):])
                return BrowserReconResult(**data)
            except (ValueError, TypeError):
                break
    result.reason = f"crash: процесс разведки завершился кодом {proc.returncode}: {proc.stderr[-200:]}"
    result.klass = "no_vacancy"
    return result


def run_recon(
    sites: list[tuple[str, str]], *, timeout: float = 30.0, site_deadline: float = 120.0,
    workers: int = MAX_BROWSERS, chromium: str | None = None,
) -> list[BrowserReconResult]:
    workers = max(1, min(workers, MAX_BROWSERS))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(
            lambda s: _run_child(s[0], s[1], timeout, site_deadline, chromium), sites,
        ))


def select_sites(
    sites: list[tuple[str, str]], only_hosts: list[str] | None, limit: int | None,
) -> list[tuple[str, str]]:
    if only_hosts:
        wanted = {normalize_host(h) if "/" in h else h.lower().removeprefix("www.") for h in only_hosts}
        sites = [s for s in sites if normalize_host(s[1]) in wanted]
    return sites[:limit] if limit else sites


def compare(old: list[dict], new: list[dict]) -> str:
    """Отчёт «было/стало» по классам; по разделам — только сменившиеся."""
    def key(item: dict) -> str:
        return item.get("url") or item.get("start_url") or ""
    old_by = {key(i): i.get("klass", "") for i in old}
    new_by = {key(i): i.get("klass", "") for i in new}
    common = [u for u in new_by if u in old_by]
    lines = ["Класс                было  стало  (по %d общим разделам)" % len(common)]
    for klass in CLASSES:
        was = sum(1 for u in common if old_by[u] == klass)
        now = sum(1 for u in common if new_by[u] == klass)
        lines.append(f"{klass:18} {was:6} {now:6}")
    changed = [u for u in common if old_by[u] != new_by[u]]
    lines.append(f"Сменили класс: {len(changed)}")
    for u in changed:
        lines.append(f"  {old_by[u]} -> {new_by[u]}  {u}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--urls", nargs="*", help="список URL вместо career-sites.tsv")
    parser.add_argument("--only-hosts", nargs="*", help="только разделы с этими хостами")
    parser.add_argument("--limit", type=int, help="не больше N разделов")
    parser.add_argument("--out", default=DEFAULT_OUT, help="итоговый JSON (по умолчанию не трогает боевой jupiter-recon.json)")
    parser.add_argument("--baseline", default=DEFAULT_BASELINE, help="прежний jupiter-recon.json для сравнения")
    parser.add_argument("--workers", type=int, default=MAX_BROWSERS, help=f"не больше {MAX_BROWSERS}")
    parser.add_argument("--timeout", type=float, default=30.0, help="таймаут навигации, с")
    parser.add_argument("--site-deadline", type=float, default=120.0, help="жёсткий срок на сайт, с")
    parser.add_argument("--chromium", default=os.environ.get("JUPITER_CHROMIUM"))
    parser.add_argument("--_one", nargs=2, metavar=("NAME", "URL"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args._one:
        endpoints = json.loads(ENDPOINTS_JSON.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\n% JobToo recon: synthetic resume\n%%EOF\n")
            res = recon_site_browser(
                args._one[0], args._one[1], endpoints, str(resume),
                timeout=args.timeout, chromium=args.chromium,
            )
        print(RESULT_MARK + json.dumps(asdict(res), ensure_ascii=False))
        return 0

    if args.urls:
        sites = [(normalize_host(u) or u, u) for u in args.urls]
    else:
        sites = load_sites()
    sites = select_sites(sites, args.only_hosts, args.limit)
    results = run_recon(
        sites, timeout=args.timeout, site_deadline=args.site_deadline,
        workers=args.workers, chromium=args.chromium,
    )
    for item in results:
        print(f"{item.klass:14} {item.reason_code or item.status:28} {item.name}", file=sys.stderr)
    data = [asdict(item) for item in results]
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    baseline = Path(args.baseline)
    if baseline.is_file():
        try:
            old = json.loads(baseline.read_text(encoding="utf-8"))
        except ValueError:
            old = []
        print(compare(old, data))
    else:
        print(f"Прежней разведки ({baseline}) нет — сравнивать не с чем.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
