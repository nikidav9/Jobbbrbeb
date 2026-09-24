#!/usr/bin/env python3
"""Разведка форм отклика на карьерных сайтах из каталога.

Разведчик — сам Jupiter в dry-run: движок с read_only=True не пропускает ни
одного запроса, кроме GET и HEAD, поэтому ни одна заявка отсюда не уходит.
Агент получает синтетического кандидата со всеми полями, какие знает профиль,
и доходит по сайту до анкеты сам — так же, как пойдёт в бою. Итог по каждому
разделу — один класс из CLASSES и снимок полей последней формы: по нему
пишется карта полей в site_compat.py.

Почему отдельный заход за вакансией. Со страницы списка агент часто не находит
вакансию: список рисует скрипт. Но адрес вакансии известен из
scripts/career-endpoints.json — его и берём стартом, если он есть.

Запуск:
    python3 recon.py                       # все разделы каталога
    python3 recon.py --only ВкусВилл Слата # выборочно
    python3 recon.py --out /tmp/recon.json --markdown ../docs/разведка-форм.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from agent import CandidateProfile, JupiterAgent, Reason
from engine import (
    EngineError, EngineSecurityError, JupiterWebEngine, PageState,
    _SafeRedirectHandler,
)
from site_compat import normalize_host, profile_for_url
from submission import ReceiptStore

ROOT = Path(__file__).resolve().parent.parent
SITES_TSV = ROOT / "scripts" / "career-sites.tsv"
ENDPOINTS_JSON = ROOT / "scripts" / "career-endpoints.json"

AGGREGATOR_HOSTS = ("hh.ru", "superjob.ru", "avito.ru", "rabota.ru", "zarplata.ru")

# Порядок — порядок сводки: от «работает» к «ничего не знаем».
CLASSES = {
    "dry_run_ok": "dry-run пройден: форма заполнена целиком, отправка остановлена движком",
    "form_unmapped": "серверная форма есть, но обязательные поля не заполнились — нужна карта",
    "captcha": "форма за CAPTCHA — только с передачей человеку",
    "aggregator": "отклик уходит на агрегатор (hh.ru, SuperJob и т. п.)",
    "spa": "страница рисуется скриптом, серверной формы нет",
    "no_vacancy": "вакансию или анкету найти не удалось",
    "blocked": "сайт не отдал страницу (код ответа, DNS, TLS)",
}

TEST_CANDIDATE: dict[str, Any] = {
    "first_name": "Тест",
    "last_name": "Тестов",
    "patronymic": "Тестович",
    "birth_date": "1995-05-15",
    "phone": "+79000000000",
    "email": "recon@example.com",
    "city": "Москва",
    "location_detail": "Тверская",
    "citizenship": "Россия",
    "education": "Высшее",
    "desired_role": "Продавец-кассир",
    "employment": "Полная занятость",
    "cover_letter": "Тестовый прогон разведки, заявка не отправляется.",
    "resume_url": "https://example.com/resume.pdf",
    "has_car": False,
    "consent": True,
    "personal_data_consent": True,
    "privacy_consent": True,
    "terms_consent": True,
}


@dataclass
class ReconResult:
    name: str
    url: str
    start_url: str
    klass: str
    status: str = ""
    reason_code: str = ""
    reason: str = ""
    final_url: str = ""
    http_status: int | None = None
    aggregator_links: list[str] = field(default_factory=list)
    has_profile: bool = False
    has_overrides: bool = False
    block_kind: str = ""
    # Класс при повторе с браузерной подписью: отличает «режут Jupiter» от
    # «режут облачный IP».
    browser_ua_klass: str = ""
    form_fields: list[dict[str, Any]] = field(default_factory=list)


def load_sites(path: Path = SITES_TSV) -> list[tuple[str, str]]:
    sites = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, url = line.split("\t")[:2]
        sites.append((name.strip(), url.strip()))
    return sites


def _base_name(name: str) -> str:
    return re.sub(r"\s*\(.*\)\s*$", "", name).strip().lower()


def endpoint_for(name: str, url: str, endpoints: list[dict]) -> dict | None:
    """Endpoint того же работодателя: по имени, а без имени — по хосту."""
    wanted = _base_name(name)
    host = normalize_host(url)
    for endpoint in endpoints:
        names = {
            _base_name(str(endpoint.get("company_hint") or "")),
            _base_name(str(endpoint["map"].get("company_const") or "")),
        }
        if wanted in names:
            return endpoint
    for endpoint in endpoints:
        template = endpoint["map"].get("url_template") or endpoint["url"]
        if normalize_host(template) == host:
            return endpoint
    return None


def _dig(data: Any, path: str) -> Any:
    for part in path.split(".") if path else []:
        if isinstance(data, list) and part.isdigit():
            data = data[int(part)] if int(part) < len(data) else None
        elif isinstance(data, dict):
            data = data.get(part)
        else:
            return None
    return data


def _from_item(item: Any, mapping: dict) -> str | None:
    if not isinstance(item, dict):
        return None
    if mapping.get("url") and isinstance(_dig(item, mapping["url"]), str):
        return _dig(item, mapping["url"])
    template = mapping.get("url_template")
    if not template:
        return None
    # Как cf_json_url в php-proxy/career_feed.php: {поле} — любое поле строки.
    values = {key: str(_dig(item, key) or "") for key in re.findall(r"\{([A-Za-z0-9_.]+)\}", template)}
    if not all(values.values()):
        return None
    return re.sub(
        r"\{([A-Za-z0-9_.]+)\}",
        lambda m: "/".join(urllib.parse.quote(part, safe="") for part in values[m.group(1)].split("/")),
        template,
    )


_NEXT_DATA_RE = re.compile(
    r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S
)


def vacancy_from_endpoint(engine: JupiterWebEngine, endpoint: dict) -> str | None:
    """Адрес одной живой вакансии. None — endpoint ничего не дал."""
    if (endpoint.get("method") or "GET").upper() != "GET":
        return None  # POST-поиск в read_only не пройдёт, и это правильно
    mapping = endpoint["map"]
    mode = endpoint.get("mode", "json")
    url = endpoint["url"]
    engine.allowed_hosts.add(normalize_host(url))
    try:
        if mode == "json":
            status, body = engine.request_json(url)
            if status >= 400:
                return None
            items = _dig(body, mapping.get("list", ""))
        elif mode == "embedded":
            page = engine.open(url)
            match = _NEXT_DATA_RE.search(page.html)
            items = _dig(json.loads(match.group(1)), mapping["list"]) if match else None
        else:
            page = engine.open(url)
            pattern = mapping.get("link_regex")
            for href in re.findall(r'href="([^"#]+)"', page.html):
                full = page.resolve(href)
                if pattern and re.search(pattern, full):
                    return full
                if not pattern and mapping.get("link_path", "\0") in urllib.parse.urlparse(full).path:
                    if urllib.parse.urlparse(full).path.rstrip("/") != urllib.parse.urlparse(url).path.rstrip("/"):
                        return full
            return None
    except (EngineError, ValueError):
        return None
    for item in items if isinstance(items, list) else []:
        found = _from_item(item, mapping)
        if found:
            return found
    return None


def _aggregator_links(page: PageState | None) -> list[str]:
    if page is None:
        return []
    found = set()
    for href in re.findall(r'href="([^"]+)"', page.html or ""):
        host = normalize_host(page.resolve(href))
        for aggregator in AGGREGATOR_HOSTS:
            if host == aggregator or host.endswith("." + aggregator):
                found.add(aggregator)
    return sorted(found)


def _form_snapshot(page: PageState | None) -> list[dict[str, Any]]:
    """Поля форм последней страницы: из них пишется field_overrides."""
    if page is None:
        return []
    fields = []
    for control in page.controls:
        if control.form_index is None or control.type in {"hidden", "submit", "button", "reset", "image"}:
            continue
        fields.append({
            "form": control.form_index,
            "tag": control.tag,
            "type": control.type,
            "name": control.name,
            "label": (control.label or control.placeholder or control.aria)[:80],
            "required": control.required,
            # У галочки value без атрибута — "on", поэтому только checked.
            "filled": control.checked if control.type in {"checkbox", "radio"}
            else bool(control.value or control.file_path),
        })
    return fields


_CONTACT_RE = re.compile(r"phone|tel|mail|телефон|почт|e-mail|contact|контакт", re.I)
# Форма для клиента, а не для кандидата: компания, ИНН, организация. Или
# подписка на рассылку вакансий — адрес почты в ней тоже есть.
_NOT_APPLICATION_RE = re.compile(r"company|organi[sz]ation|organ\b|компани|организац|\bинн\b|\binn\b|subscri", re.I)


def _describe(control) -> str:
    return " ".join((control.name, control.id, control.label, control.placeholder, control.autocomplete, control.type))


def _is_application_form(page: PageState | None, *, filled_only: bool) -> bool:
    """На странице есть анкета кандидата, а не фильтр и не форма для клиентов.

    Без этой проверки агент «заполнял» фильтр вакансий, настройки cookie или
    одну галочку согласия и докладывал о готовности. Анкетой считаем форму,
    где есть контакт кандидата (телефон или почта) и нет обязательной
    «компании»/ИНН. Имя не требуем: у Перекрёстка быстрый отклик — телефон и
    дата рождения.
    """
    if page is None:
        return False
    forms: dict[int, list] = {}
    for control in page.controls:
        if control.form_index is not None:
            forms.setdefault(control.form_index, []).append(control)
    for controls in forms.values():
        if any(
            c.type not in {"checkbox", "radio"} and (
                c.required and _NOT_APPLICATION_RE.search(_describe(c))
                or c.name.lower().startswith("subscri")
            )
            for c in controls
        ):
            continue
        for control in controls:
            if control.type in {"hidden", "submit", "button", "checkbox", "radio"}:
                continue
            if _CONTACT_RE.search(_describe(control)) and (not filled_only or control.value):
                return True
    return False


def _starred_empty(page: PageState | None) -> list[str]:
    """Пустые поля со звёздочкой в подписи в той форме, что агент заполнял.

    Звёздочку сайты ставят вместо атрибута required: браузер её не проверит,
    а сервер отклонит. Для «dry-run пройден» такая форма не готова.
    """
    if page is None:
        return []
    # Заполненная агентом форма — та, где стоит контакт кандидата. Любое
    # непустое поле не годится: у RedLab сайт сам кладёт form_id в каждую
    # форму, и соседняя форма со звёздочками выглядела заполненной.
    filled_forms = {
        c.form_index for c in page.controls
        if c.form_index is not None and c.value
        and c.type not in {"hidden", "checkbox", "radio", "submit", "button"}
        and _CONTACT_RE.search(_describe(c))
    }
    return [
        c.label or c.placeholder or c.name
        for c in page.controls
        if c.form_index in filled_forms
        and c.type not in {"hidden", "checkbox", "radio", "submit", "button", "file"}
        and "*" in " ".join((c.label, c.placeholder, c.aria))
        and not c.value
        and not c.disabled
    ]


def classify(status: str, code: str | None, page: PageState | None, aggregators: list[str]) -> str:
    if page is not None and any(
        normalize_host(page.url) == host or normalize_host(page.url).endswith("." + host)
        for host in AGGREGATOR_HOSTS
    ):
        return "aggregator"
    application = _is_application_form(page, filled_only=status == "ready_to_submit")
    # Заполненная форма за капчей — не «готово»: без человека она не уйдёт.
    captcha = page is not None and JupiterAgent.detect_captcha(page)
    if application and (code == Reason.CAPTCHA_REQUIRED or (status == "ready_to_submit" and captcha)):
        return "captcha"
    if status == "ready_to_submit" and application:
        return "form_unmapped" if _starred_empty(page) else "dry_run_ok"
    if application and code in {
        Reason.MISSING_PROFILE_FIELD, Reason.UNKNOWN_REQUIRED_QUESTION,
        Reason.CONSENT_REQUIRED, Reason.VALIDATION_FAILED,
        Reason.MULTI_STEP_DRY_RUN_LIMIT,
    }:
        return "form_unmapped"
    if code == Reason.NAVIGATION_FAILED and page is None:
        return "blocked"
    has_form = page is not None and any(
        c.form_index is not None and c.type not in {"hidden", "submit", "search"}
        for c in page.controls
    )
    if aggregators and (code == Reason.DOMAIN_BLOCKED or not has_form):
        return "aggregator"
    if code == Reason.UNSUPPORTED_SCRIPT or (page is not None and page.has_script and not has_form):
        return "spa"
    return "no_vacancy"


@dataclass(frozen=True)
class NetOptions:
    timeout: float = 15.0
    via_proxy: bool = False
    user_agent: str | None = None


def make_engine(hosts: set[str], net: NetOptions) -> JupiterWebEngine:
    """Движок разведки: всегда read_only.

    via_proxy — только для облачного контейнера, где прямые соединения наружу
    закрыты и всё идёт через HTTPS_PROXY. Закрепление IP при этом теряется
    (соединяется прокси), но проверка политики на каждом переходе и
    редиректе остаётся. Боевой воркер так не ходит.
    """
    engine = JupiterWebEngine(hosts, timeout=net.timeout, read_only=True)
    if net.user_agent:
        engine.user_agent = net.user_agent
    if net.via_proxy:
        engine.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler(),
            urllib.request.HTTPCookieProcessor(engine.cookies),
            _SafeRedirectHandler(engine.assert_reachable),
        )
    return engine


def recon_site(name: str, url: str, endpoints: list[dict], resume: str, net: NetOptions) -> ReconResult:
    profile = profile_for_url(url)
    result = ReconResult(
        name=name, url=url, start_url=url, klass="blocked",
        has_profile=profile is not None,
        has_overrides=bool(profile and profile.field_overrides),
    )
    probe = make_engine({normalize_host(url)}, net)
    endpoint = endpoint_for(name, url, endpoints)
    if endpoint:
        vacancy = vacancy_from_endpoint(probe, endpoint)
        if vacancy:
            result.start_url = vacancy

    engine = make_engine({normalize_host(result.start_url)}, net)
    agent = JupiterAgent(
        set(engine.allowed_hosts), max_steps=10, engine=engine, dry_run=True,
        receipts=ReceiptStore(None),
    )
    candidate = CandidateProfile(values=dict(TEST_CANDIDATE), resume_path=resume)
    try:
        outcome = agent.run(result.start_url, candidate)
    except EngineSecurityError as exc:  # страховка: read_only обязан держать
        result.reason = f"security: {exc}"
        return result
    except Exception as exc:  # один сломанный сайт не должен ронять обход
        result.reason = f"crash: {type(exc).__name__}: {exc}"
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
    result.klass = classify(outcome.status, outcome.reason_code, page, result.aggregator_links)
    if result.klass == "blocked":
        result.block_kind = block_kind(result.reason)
    return result


BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


def block_kind(reason: str) -> str:
    """Почему сайт не отдал страницу — грубо, но по коду, а не по догадке."""
    if "CERTIFICATE_VERIFY_FAILED" in reason:
        return "tls"
    if "Unsupported response type" in reason:
        return "не HTML"
    code = re.search(r"HTTP Error (\d{3})", reason)
    if code and code.group(1) == "404":
        return "404"
    if code or "Connection reset" in reason:
        return f"доступ ({code.group(1) if code else 'reset'})"
    return "сеть"


def render_markdown(results: list[ReconResult], today: str) -> str:
    counts = {klass: 0 for klass in CLASSES}
    for item in results:
        counts[item.klass] += 1
    lines = [
        "# Разведка форм отклика",
        "",
        f"Прогон {today}: `cd jupiter && python3 recon.py --ua-retry --markdown ../docs/разведка-форм.md`",
        "(в облачном контейнере — ещё `--via-proxy`).",
        "Разведчик — Jupiter в dry-run с синтетическим кандидатом: движок с",
        "`read_only=True` пропускает только GET и HEAD, заявки не уходят.",
        "Запросы идут из облачного контейнера, поэтому `blocked` может означать",
        "блок облачного IP или заголовка `User-Agent` Jupiter, а не закрытый сайт.",
        "",
        "## Сводка",
        "",
        "| Класс | Разделов | Что значит |",
        "|---|---:|---|",
    ]
    for klass, meaning in CLASSES.items():
        lines.append(f"| `{klass}` | {counts[klass]} | {meaning} |")
    blocked = [item for item in results if item.klass == "blocked"]
    by_kind: dict[str, int] = {}
    for item in blocked:
        by_kind[item.block_kind] = by_kind.get(item.block_kind, 0) + 1
    ua_opened = [item for item in blocked if item.browser_ua_klass not in ("", "blocked")]
    lines += [f"| **всего** | **{len(results)}** | |", ""]
    if blocked:
        lines += [
            "### Почему `blocked`",
            "",
            "| Причина | Разделов |",
            "|---|---:|",
            *[f"| {kind} | {count} |" for kind, count in sorted(by_kind.items(), key=lambda kv: -kv[1])],
            "",
            f"С браузерной подписью открылись {len(ua_opened)} из {len(blocked)}: "
            "эти сайты режут именно `User-Agent` Jupiter. `tls` — сертификат не "
            "прошёл проверку в среде прогона, это не приговор сайту.",
            "",
        ]
    lines += ["## По разделам", "",
              "| Раздел | Класс | Карта полей | Код остановки | Агрегаторы | Где остановился |",
              "|---|---|---|---|---|---|"]
    order = list(CLASSES)
    for item in sorted(results, key=lambda r: (order.index(r.klass), r.name.lower())):
        overrides = "есть" if item.has_overrides else ("профиль" if item.has_profile else "—")
        where = item.final_url or item.start_url
        code = item.reason_code or item.status or "—"
        if item.klass == "blocked":
            code = item.block_kind + (f"; с браузерной подписью: `{item.browser_ua_klass}`" if item.browser_ua_klass else "")
        lines.append(
            f"| {item.name} | `{item.klass}` | {overrides} | {code} "
            f"| {', '.join(item.aggregator_links) or '—'} | {where} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", nargs="*", help="имена разделов (без учёта регистра)")
    parser.add_argument("--out", help="полный JSON с полями форм")
    parser.add_argument("--markdown", help="сводная таблица для docs/")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--via-proxy", action="store_true", help="ходить через HTTPS_PROXY (облачный контейнер)")
    parser.add_argument("--user-agent", help="подменить подпись Jupiter")
    parser.add_argument(
        "--ua-retry", action="store_true",
        help="повторить blocked с браузерной подписью, чтобы отличить блок подписи от блока IP",
    )
    args = parser.parse_args()

    sites = load_sites()
    if args.only:
        wanted = {name.lower() for name in args.only}
        sites = [site for site in sites if site[0].lower() in wanted or _base_name(site[0]) in wanted]
    endpoints = json.loads(ENDPOINTS_JSON.read_text(encoding="utf-8"))
    net = NetOptions(args.timeout, args.via_proxy, args.user_agent)

    with tempfile.TemporaryDirectory() as tmp:
        resume = Path(tmp) / "resume.pdf"
        resume.write_bytes(b"%PDF-1.4\n% JobToo recon: synthetic resume\n%%EOF\n")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            results = list(pool.map(
                lambda site: recon_site(site[0], site[1], endpoints, str(resume), net),
                sites,
            ))
            if args.ua_retry:
                retry_net = NetOptions(args.timeout, args.via_proxy, BROWSER_UA)
                blocked = [item for item in results if item.klass == "blocked"]
                retried = pool.map(
                    lambda item: recon_site(item.name, item.url, endpoints, str(resume), retry_net),
                    blocked,
                )
                for item, again in zip(blocked, retried):
                    item.browser_ua_klass = again.klass

    for item in results:
        print(f"{item.klass:14} {item.reason_code or item.status:28} {item.name}", file=sys.stderr)
    if args.out:
        Path(args.out).write_text(
            json.dumps([asdict(item) for item in results], ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
    if args.markdown:
        Path(args.markdown).write_text(render_markdown(results, date.today().isoformat()), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
