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

Режим сервера (infra/recon-browser-run.sh, раз в сутки после HTTP-разведки):
    python3 recon_browser.py --from-http jupiter-recon.json --max-minutes 150 \
        --workers 1 --out jupiter-recon-browser.json
Берутся только разделы, где HTTP-итог не dry_run_ok, а упёрся в spa, captcha,
form_unmapped, no_vacancy или отказ в доступе (blocked с 401/403/429/503 —
часто проверка браузера): остальное браузер не улучшит (dry_run_ok уже есть,
aggregator, сертификат, сеть — не про движок). Сначала — подтвердить вчерашние
dry_run_ok браузера (иначе они выпадут из live_ready), потом — ещё не
виденные, потом остальные. По исчерпании --max-minutes новые разделы не
начинаются. Итог пишется атомарно (tmp + rename): site_compat никогда не
увидит полфайла.

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
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from recon import (
    CLASSES, ENDPOINTS_JSON, TEST_CANDIDATE, ReconResult, NetOptions, site_adapter,
    _aggregator_links, _form_snapshot, block_kind, classify, endpoint_for, feed_vacancy_for,
    load_feed_vacancies,
    load_sites, make_engine, vacancy_from_endpoint,
)
from site_compat import normalize_host, profile_for_url

MAX_BROWSERS = 2
DEFAULT_OUT = "jupiter-recon-browser.json"
DEFAULT_BASELINE = os.environ.get("JUPITER_RECON_FILE", "jupiter-recon.json")
RESULT_MARK = "@@RECON_RESULT@@"
# Классы HTTP-разведки, которые браузер может перевести в dry_run_ok.
BROWSER_RETRY_CLASSES = ("spa", "captcha", "form_unmapped", "no_vacancy")
# Из «blocked» — только отказ в доступе: за ним часто стоит проверка браузера,
# которую Chromium проходит сам (browser_engine.CHALLENGE_WAIT_MS). Сертификат,
# сеть и 404 браузер не исправит.
BROWSER_RETRY_BLOCKS = ("доступ (401)", "доступ (403)", "доступ (429)", "доступ (503)")


@dataclass
class BrowserReconResult(ReconResult):
    engine: str = "browser"
    browser_actions: list[dict[str, Any]] = field(default_factory=list)
    # Подсказки YandexGPT на этом сайте (01.10.2026): была ли модель и что она
    # сделала — выбрала кнопку отклика, сопоставила поля, пояснила вопросы.
    llm_used: bool = False
    llm_actions: list[dict[str, Any]] = field(default_factory=list)
    # Репетиция отправки (01.10.2026): анкета, дошедшая до «Отправить»,
    # проходится ещё раз с нажатием; сеть обрывает запрос. verdict:
    # would_send — анкета ушла бы (в оборванном запросе данные кандидата);
    # request_without_candidate — запрос был, но без анкеты; no_request —
    # нажатие ничего не отправило (поле не принято, не та кнопка).
    rehearsal: dict[str, Any] = field(default_factory=dict)
    # База знаний Алисы (knowledge.py): что выучено на сайте, пригодилось ли
    # прежнее знание и сколько стоило вызовов модели.
    learned: dict[str, Any] = field(default_factory=dict)
    knowledge_used: bool = False
    llm_calls: int = 0
    # Вид CAPTCHA на анкете (01.10.2026): картинку с текстом человек вводит в
    # приложении — такой сайт подключается (site_compat._recon_ready).
    captcha: dict[str, Any] = field(default_factory=dict)


# С 01.10.2026 YandexGPT — на всех сайтах (решение владельца), расход держит
# потолок вызовов --llm-calls и база знаний. Порядок — сперва работодатели,
# чьи вакансии есть в ленте (у них есть источник).
DEFAULT_LLM_SITES = 1000


def llm_sites(sites: list[tuple[str, str]], endpoints: list[dict], limit: int) -> set[str]:
    """Адреса разделов, где ночью работает YandexGPT: сперва с источником вакансий."""
    if limit <= 0:
        return set()
    feed = load_feed_vacancies()
    ranked = sorted(sites, key=lambda s: 0 if (feed_vacancy_for(s[0], s[1], feed)
                                               or endpoint_for(s[0], s[1], endpoints)) else 1)
    return {url for _, url in ranked[:limit]}


def rehearsal_markers(candidate: dict[str, Any]) -> list[str]:
    """Метки синтетического кандидата в теле или адресе запроса — в разных кодировках."""
    import urllib.parse
    out: list[str] = []
    for value in (candidate.get("email"), candidate.get("last_name")):
        if not value:
            continue
        text = str(value)
        out += [text, urllib.parse.quote(text), urllib.parse.quote_plus(text),
                json.dumps(text)[1:-1]]
    return list(dict.fromkeys(out))


def rehearsal_verdict(log: list[dict[str, Any]]) -> str:
    if any(item.get("carries_candidate") for item in log):
        return "would_send"
    return "request_without_candidate" if log else "no_request"


def _llm_trace(engine_actions: list[dict], trajectory: list[dict]) -> list[dict[str, Any]]:
    """Что сделала модель: из журнала движка и траектории агента, без значений."""
    out = [a for a in engine_actions if str(a.get("action", "")).startswith("llm_")]
    for step in trajectory or []:
        action = str(step.get("action", ""))
        if action.startswith("llm") or action == "explain_questions":
            out.append({k: step[k] for k in ("action", "field", "key", "questions") if k in step})
    return out[:40]


def recon_site_browser(
    name: str, url: str, endpoints: list[dict], resume: str,
    *, timeout: float = 30.0, chromium: str | None = None, llm: Any = None,
    rehearse: bool = False,
) -> BrowserReconResult:
    """Один сайт в этом процессе. Вызывать из потока, где живёт Playwright.

    llm — клиент YandexGPT: с ним разведка проходит сайт так же, как боевой
    Юпитер (кнопка отклика, поля, вопросы — browser_planner).
    """
    import knowledge
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
    feed_vacancy = feed_vacancy_for(name, url, load_feed_vacancies())
    if feed_vacancy:  # та же вакансия, что у людей в ленте
        result.start_url = feed_vacancy
    elif endpoint:  # адрес живой вакансии — HTTP-разведкой, это всего лишь GET
        probe = make_engine({normalize_host(url)}, NetOptions(min(timeout, 15.0)))
        try:
            result.start_url = vacancy_from_endpoint(probe, endpoint) or url
        except Exception:
            pass
    hosts = {normalize_host(result.start_url), normalize_host(url)}
    # Сначала база знаний, Алиса — только о новом (knowledge.Advisor).
    counting = knowledge.CountingLLM(llm) if llm is not None else None
    advisor = knowledge.Advisor(knowledge.Knowledge.load(), normalize_host(result.start_url), counting)
    hooks = knowledge.advisor_hooks(advisor)
    extra: dict[str, Any] = {}
    for hook, part in (("apply_advisor", "apply"), ("field_mapper", "fields"),
                       ("question_explainer", "questions"),
                       ("outcome_judge", "judge"), ("fix_advisor", "fix")):
        if llm is not None or advisor.entry.get(part):
            extra[hook] = hooks[hook]
    try:
        engine = JupiterBrowserEngine(
            hosts, read_only=True, timeout=timeout, executable_path=chromium,
            apply_advisor=extra.get("apply_advisor"),
        )
    except EngineError as exc:
        result.reason = f"browser: {exc}"[:300]
        return result
    try:
        result.llm_used = llm is not None
        agent = JupiterAgent(
            set(hosts), max_steps=10, engine=engine, dry_run=True,
            receipts=ReceiptStore(None), **{k: v for k, v in extra.items() if k != "apply_advisor"},
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
        result.llm_actions = _llm_trace(engine.actions, outcome.trajectory)
        result.klass = classify(outcome.status, outcome.reason_code, page, result.aggregator_links,
                                site_adapter(outcome.trajectory))
        if result.klass == "blocked":
            result.block_kind = block_kind(result.reason)
        if result.klass == "captcha":
            info = engine.captcha()
            if info is not None:
                result.captcha = {"vendor": info.vendor, "kind": info.kind,
                                  "transferable": info.transferable}
    finally:
        engine.close()
    if rehearse and result.klass == "dry_run_ok":
        result.rehearsal = _rehearse(result.start_url, hosts, resume, timeout, chromium, extra)
    result.learned = {k: v for k, v in advisor.learned.items() if v}
    result.knowledge_used = advisor.used
    result.llm_calls = counting.calls if counting is not None else 0
    return result


def _rehearse(url: str, hosts: set[str], resume: str, timeout: float,
              chromium: str | None, extra: dict[str, Any]) -> dict[str, Any]:
    """Та же анкета с нажатием «Отправить». read_only: сеть обрывает отправку."""
    from agent import CandidateProfile, JupiterAgent
    from browser_engine import JupiterBrowserEngine
    from engine import EngineError
    from submission import ReceiptStore

    try:
        engine = JupiterBrowserEngine(
            hosts, read_only=True, timeout=timeout, executable_path=chromium,
            rehearsal_markers=rehearsal_markers(TEST_CANDIDATE),
            apply_advisor=extra.get("apply_advisor"),
        )
    except EngineError as exc:
        return {"verdict": "error", "reason": f"browser: {exc}"[:200]}
    try:
        agent = JupiterAgent(
            set(hosts), max_steps=12, engine=engine, dry_run=False,
            receipts=ReceiptStore(None),
            **{k: v for k, v in extra.items() if k != "apply_advisor"},
        )
        candidate = CandidateProfile(values=dict(TEST_CANDIDATE), resume_path=resume)
        try:
            outcome = agent.run(url, candidate)
        except Exception as exc:  # noqa: BLE001 - репетиция не роняет разведку
            return {"verdict": "error", "reason": f"crash: {type(exc).__name__}: {exc}"[:200]}
        page = engine.page
        return {
            "verdict": rehearsal_verdict(engine.rehearsal_log),
            "requests": engine.rehearsal_log[:5],
            "status": outcome.status,
            "reason_code": outcome.reason_code or "",
            "reason": (outcome.reason or "")[:200],
            # Что сайт показал после нажатия: ошибка поля, «спасибо»…
            "page_text": " ".join(((page.text if page else "") or "").split())[:300],
            # Почему форма не ушла (01.10.2026): поля, которые сайт пометил
            # неверными, и вывод сайта/модели (outcome_judged).
            "invalid_fields": [f.get("label", "") for f in
                               ((getattr(engine, "last_submit_feedback", None) or {}).get("invalid") or [])][:10],
            "judged": next((t for t in reversed(outcome.trajectory) if t.get("action") == "outcome_judged"), None),
        }
    finally:
        engine.close()


def _run_child(name: str, url: str, timeout: float, deadline: float, chromium: str | None,
               use_llm: bool = False, rehearse: bool = False) -> BrowserReconResult:
    """Сайт в отдельном процессе с жёстким сроком."""
    cmd = [sys.executable, os.path.abspath(__file__), "--_one", name, url,
           "--timeout", str(timeout)]
    if chromium:
        cmd += ["--chromium", chromium]
    if use_llm:
        cmd.append("--_llm")
    if rehearse:
        cmd.append("--_rehearse")
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
                # Дочерний процесс читает файлы заново: если посреди обхода
                # выложили новую версию, незнакомые поля не ломают итог.
                known = set(BrowserReconResult.__dataclass_fields__)
                return BrowserReconResult(**{k: v for k, v in data.items() if k in known})
            except (ValueError, TypeError):
                break
    result.reason = f"crash: процесс разведки завершился кодом {proc.returncode}: {proc.stderr[-200:]}"
    result.klass = "no_vacancy"
    return result


def run_recon(
    sites: list[tuple[str, str]], *, timeout: float = 30.0, site_deadline: float = 120.0,
    workers: int = MAX_BROWSERS, chromium: str | None = None,
    max_seconds: float | None = None, with_llm: set[str] | None = None,
    rehearse: bool = False, progress: Any = None, llm_calls: int | None = None,
) -> list[BrowserReconResult]:
    """Обход. С max_seconds новые разделы после срока не начинаются (начатый
    доживает до site_deadline) и в итог не попадают. progress(result) — после
    каждого пройденного раздела (файл хода, база знаний). llm_calls — потолок
    вызовов YandexGPT на обход: когда истрачен, следующие сайты идут без модели
    (начатый может превысить его на несколько вызовов)."""
    workers = max(1, min(workers, MAX_BROWSERS))
    stop_at = time.monotonic() + max_seconds if max_seconds is not None else None
    spent = [0]

    def one(site: tuple[str, str]) -> BrowserReconResult | None:
        if stop_at is not None and time.monotonic() >= stop_at:
            return None
        use_llm = site[1] in (with_llm or set()) and (llm_calls is None or spent[0] < llm_calls)
        res = _run_child(site[0], site[1], timeout, site_deadline, chromium,
                         use_llm=use_llm, rehearse=rehearse)
        spent[0] += res.llm_calls
        if progress is not None:
            progress(res)
        return res

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return [r for r in pool.map(one, sites) if r is not None]


def _load_list(path: str | None) -> list[dict]:
    if not path:
        return []
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [i for i in data if isinstance(i, dict)] if isinstance(data, list) else []


def sites_needing_browser(http_items: list[dict]) -> list[tuple[str, str]]:
    """Разделы, где HTTP-разведка не дошла до dry_run_ok по причине, которую
    браузер может снять. Хост, уже прошедший HTTP-движком, пропускается."""
    ok_hosts = {
        normalize_host(str(i.get(k) or ""))
        for i in http_items if i.get("klass") == "dry_run_ok" for k in ("url", "start_url")
    }
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for item in http_items:
        url = str(item.get("url") or "")
        retry = item.get("klass") in BROWSER_RETRY_CLASSES or (
            item.get("klass") == "blocked" and item.get("block_kind") in BROWSER_RETRY_BLOCKS
        )
        if not retry or not url or url in seen:
            continue
        if normalize_host(url) in ok_hosts:
            continue
        seen.add(url)
        out.append((str(item.get("name") or normalize_host(url) or url), url))
    return out


def sites_to_rehearse(http_items: list[dict]) -> list[tuple[str, str]]:
    """Разделы, которые HTTP-движок довёл до «Отправить»: их браузер раньше не
    смотрел, а поломки отправки (поле не принято, не та кнопка) видны только
    при нажатии."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for item in http_items:
        url = str(item.get("url") or "")
        if item.get("klass") != "dry_run_ok" or not url or url in seen:
            continue
        seen.add(url)
        out.append((str(item.get("name") or normalize_host(url) or url), url))
    return out


def order_by_previous(sites: list[tuple[str, str]], previous: list[dict]) -> list[tuple[str, str]]:
    """Вчерашние dry_run_ok браузера — первыми (подтвердить, пока не протухли),
    затем не виденные, затем прочие. Порядок внутри группы сохраняется."""
    prev = {str(i.get("url") or ""): i.get("klass") for i in previous}

    def rank(site: tuple[str, str]) -> int:
        klass = prev.get(site[1])
        return 0 if klass == "dry_run_ok" else 1 if klass is None else 2

    return sorted(sites, key=rank)


class Progress:
    """Открытый файл хода обхода (01.10.2026): итог пишется только в конце,
    а обход идёт до четырёх часов — снаружи казалось, что он не кончается.
    Только числа, классы и имена работодателей — ничего о людях."""

    def __init__(self, path: str, total: int, max_seconds: float | None, site_deadline: float,
                 now: Any = time.time) -> None:
        import threading
        self.path, self.total, self.now = path, total, now
        self.started = now()
        self.deadline = self.started + max_seconds + site_deadline if max_seconds is not None else None
        self.done = 0
        self.klass: dict[str, int] = {}
        self.rehearsal: dict[str, int] = {}
        self.llm_used = 0
        self.llm_calls = 0
        self.last = ""
        self._lock = threading.Lock()

    @staticmethod
    def _iso(ts: float) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))

    def snapshot(self, state: str = "идёт") -> dict[str, Any]:
        now = self.now()
        left = self.total - self.done
        data: dict[str, Any] = {
            "state": state, "started_at": self._iso(self.started), "updated_at": self._iso(now),
            "total": self.total, "done": self.done, "left": left, "last": self.last,
            "classes": dict(self.klass), "rehearsal": dict(self.rehearsal), "llm_used": self.llm_used,
            "llm_calls": self.llm_calls,
        }
        if self.deadline is not None:
            data["deadline_at"] = self._iso(self.deadline)
        if state == "идёт" and self.done and left:
            eta = now + (now - self.started) / self.done * left
            data["eta_at"] = self._iso(min(eta, self.deadline) if self.deadline is not None else eta)
        return data

    def __call__(self, res: BrowserReconResult) -> None:
        with self._lock:
            self.done += 1
            self.last = res.name
            self.klass[res.klass] = self.klass.get(res.klass, 0) + 1
            verdict = (res.rehearsal or {}).get("verdict")
            if verdict:
                self.rehearsal[verdict] = self.rehearsal.get(verdict, 0) + 1
            self.llm_used += 1 if res.llm_used else 0
            self.llm_calls += res.llm_calls
            self.write()

    def write(self, state: str = "идёт") -> None:
        try:
            write_atomic(self.path, self.snapshot(state))
        except OSError:
            pass  # ход — подсказка человеку, обход из-за него не падает


def write_atomic(path: str, data: Any) -> None:
    """tmp в том же каталоге + rename: читатель видит старый или новый файл."""
    target = Path(path)
    fd, tmp = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent or "."))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


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
    parser.add_argument(
        "--from-http", metavar="FILE",
        help="итог HTTP-разведки: обойти только его разделы с классами " + ", ".join(BROWSER_RETRY_CLASSES),
    )
    parser.add_argument("--max-minutes", type=float, help="после срока новые разделы не начинаются")
    parser.add_argument(
        "--llm-sites", type=int, default=0,
        help="на скольких разделах подключать YandexGPT (ключ — YANDEX_GPT_* в окружении); "
             f"на сервере {DEFAULT_LLM_SITES}",
    )
    parser.add_argument("--progress", metavar="FILE", help="файл хода: пройдено, осталось, примерный конец")
    parser.add_argument("--knowledge", metavar="FILE",
                        help="база знаний Алисы (knowledge.py): читается сайтами, пополняется после каждого")
    parser.add_argument("--llm-calls", type=int, help="потолок вызовов YandexGPT на обход")
    parser.add_argument("--_one", nargs=2, metavar=("NAME", "URL"), help=argparse.SUPPRESS)
    parser.add_argument("--_llm", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--rehearse", action="store_true",
        help="репетиция отправки: дошедшие до «Отправить» анкеты нажимаются, сеть обрывает отправку; "
             "с --from-http — и разделы, которые HTTP-движок уже прошёл",
    )
    parser.add_argument("--_rehearse", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    if args._one:
        endpoints = json.loads(ENDPOINTS_JSON.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            resume = Path(tmp) / "resume.pdf"
            resume.write_bytes(b"%PDF-1.4\n% JobToo recon: synthetic resume\n%%EOF\n")
            llm = None
            if args._llm:
                import yandex_gpt
                llm = yandex_gpt.YandexGPT.from_env()
            res = recon_site_browser(
                args._one[0], args._one[1], endpoints, str(resume),
                timeout=args.timeout, chromium=args.chromium, llm=llm, rehearse=args._rehearse,
            )
        print(RESULT_MARK + json.dumps(asdict(res), ensure_ascii=False))
        return 0

    if args.urls:
        sites = [(normalize_host(u) or u, u) for u in args.urls]
    elif args.from_http:
        http_items = _load_list(args.from_http)
        if not http_items:
            print(f"Итог HTTP-разведки {args.from_http} пуст или не читается — выхожу.", file=sys.stderr)
            return 1
        sites = order_by_previous(sites_needing_browser(http_items), _load_list(args.out))
        if args.rehearse:
            sites += [s for s in sites_to_rehearse(http_items) if s not in sites]
    else:
        sites = load_sites()
    sites = select_sites(sites, args.only_hosts, args.limit)
    with_llm: set[str] = set()
    if args.llm_sites > 0 and os.environ.get("YANDEX_GPT_API_KEY"):
        endpoints = json.loads(ENDPOINTS_JSON.read_text(encoding="utf-8"))
        with_llm = llm_sites(sites, endpoints, args.llm_sites)
    max_seconds = args.max_minutes * 60 if args.max_minutes is not None else None
    progress = Progress(args.progress, len(sites), max_seconds, args.site_deadline) if args.progress else None
    if progress is not None:
        progress.write()
    after = progress
    if args.knowledge:
        import knowledge
        kb = knowledge.Knowledge.load(args.knowledge)
        os.environ[knowledge.ENV] = args.knowledge  # дочерние процессы читают тот же файл

        def after(res: BrowserReconResult) -> None:
            kb.learn(normalize_host(res.start_url), res.learned, used=res.knowledge_used,
                     klass=res.klass, verdict=str((res.rehearsal or {}).get("verdict") or ""))
            try:
                kb.save(args.knowledge)
            except OSError as exc:
                print(f"база знаний не записана: {exc}", file=sys.stderr)
            if progress is not None:
                progress(res)
    results = run_recon(
        sites, timeout=args.timeout, site_deadline=args.site_deadline,
        workers=args.workers, chromium=args.chromium, max_seconds=max_seconds,
        with_llm=with_llm, rehearse=args.rehearse, progress=after, llm_calls=args.llm_calls,
    )
    if progress is not None:
        progress.write("готово" if len(results) == len(sites) else "срок вышел")
    if len(results) < len(sites):
        print(f"Срок вышел: пройдено {len(results)} из {len(sites)} разделов.", file=sys.stderr)
    for item in results:
        print(f"{item.klass:14} {item.reason_code or item.status:28} {item.name}", file=sys.stderr)
    data = [asdict(item) for item in results]
    write_atomic(args.out, data)
    baseline = Path(args.from_http or args.baseline)
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
