"""Известные ATS и виджеты, куда анкеты уводят с сайта компании.

Таблица закрытая: в allowed_hosts движка попадает только хост, который
совпал с записью отсюда и куда кандидат может подать анкету без входа.
Произвольные хосты со страницы (аналитика, капча, чужие iframe) не
добавляются никогда. hh.ru и job-борды требуют вход кандидата, поэтому
подавать туда нельзя: их хосты распознаются, но в политику не идут.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

IFRAME = "iframe"      # виджет/форма во фрейме на странице компании
REDIRECT = "redirect"  # отдельная карьерная страница ATS, куда ведёт ссылка
API = "api"            # форма шлёт данные на сторонний API


@dataclass(frozen=True)
class AtsInfo:
    suffix: str        # хост или домен: совпадает сам он и любой его поддомен
    name: str
    kind: str
    can_apply: bool    # можно ли подавать без аккаунта кандидата
    note: str = ""


ATS_TABLE: tuple[AtsInfo, ...] = (
    AtsInfo("huntflow.io", "Huntflow", REDIRECT, True, "страницы вакансий и анкеты"),
    AtsInfo("huntflow.ru", "Huntflow", REDIRECT, True),
    AtsInfo("potok.io", "Potok", REDIRECT, True, "карьерные страницы company.potok.io"),
    AtsInfo("talantix.ru", "Talantix", REDIRECT, True),
    AtsInfo("skillaz.ru", "Skillaz", REDIRECT, True),
    AtsInfo("e-staff.ru", "E-Staff", REDIRECT, True),
    AtsInfo("friend.work", "FriendWork", REDIRECT, True),
    AtsInfo("friendwork.ru", "FriendWork", REDIRECT, True),
    AtsInfo("hrlink.ru", "HRlink", REDIRECT, True),
    AtsInfo("cleverstaff.net", "CleverStaff", REDIRECT, True),
    AtsInfo("forms.yandex.ru", "Яндекс Формы", IFRAME, True),
    AtsInfo("forms.tildaapi.com", "Tilda-формы", API, True, "отправка формы Tilda"),
    AtsInfo("forms.amocrm.ru", "amoCRM-формы", IFRAME, True),
    AtsInfo("amoforms.ru", "amoCRM-формы", IFRAME, True),
    AtsInfo("bitrix24.ru", "Битрикс24 CRM-формы", IFRAME, True, "b24-*.bitrix24.ru"),
    AtsInfo("bitrix24.site", "Битрикс24 сайты", IFRAME, True),
    AtsInfo("greenhouse.io", "Greenhouse", REDIRECT, True),
    AtsInfo("lever.co", "Lever", REDIRECT, True),
    AtsInfo("smartrecruiters.com", "SmartRecruiters", REDIRECT, True),
    AtsInfo("workable.com", "Workable", REDIRECT, True),
    AtsInfo("teamtailor.com", "Teamtailor", REDIRECT, True),
    # Распознаём, но не подаём: нужен вход кандидата.
    AtsInfo("hh.ru", "hh.ru", REDIRECT, False, "нужен вход кандидата"),
    AtsInfo("hhcdn.ru", "hh.ru CDN", API, False, "статика hh.ru"),
    AtsInfo("headhunter.ru", "hh.ru", REDIRECT, False, "нужен вход кандидата"),
    AtsInfo("superjob.ru", "SuperJob", REDIRECT, False, "нужен вход кандидата"),
    AtsInfo("rabota.ru", "Работа.ру", REDIRECT, False, "нужен вход кандидата"),
    AtsInfo("avito.ru", "Авито", REDIRECT, False, "нужен вход кандидата"),
)


def _host(value: str) -> str:
    host = (urlparse(value).hostname if "://" in value else value) or ""
    return host.strip().lower().rstrip(".")


def _match(host: str) -> AtsInfo | None:
    # Самая длинная запись выигрывает: forms.yandex.ru важнее возможного yandex.ru.
    best: AtsInfo | None = None
    for info in ATS_TABLE:
        if host == info.suffix or host.endswith("." + info.suffix):
            if best is None or len(info.suffix) > len(best.suffix):
                best = info
    return best


def ats_for_url(url: str) -> AtsInfo | None:
    host = _host(url)
    return _match(host) if host else None


def extra_allowed_hosts(vacancy_url: str, observed_hosts) -> set[str]:
    """Хосты, которые безопасно добавить в allowed_hosts для этой вакансии.

    Берутся хост самой вакансии и наблюдаемые хосты (виджеты, редиректы),
    но только если они известные ATS, куда можно подавать. Хост возвращается
    как есть, без подстановки поддоменов: политика сверяет буквально."""
    result: set[str] = set()
    for item in (vacancy_url, *(observed_hosts or ())):
        host = _host(str(item))
        info = _match(host) if host else None
        if info is not None and info.can_apply:
            result.add(host)
    return result


# Составные окончания, у которых «домен второго уровня» — это три метки.
# Полного списка публичных суффиксов в stdlib нет; здесь те, что встречаются
# у российских работодателей, и несколько общих.
_TWO_LEVEL_SUFFIXES = {
    "com.ru", "org.ru", "net.ru", "pp.ru", "msk.ru", "spb.ru", "nov.ru",
    "co.uk", "org.uk", "com.au", "com.br", "co.jp", "com.tr", "com.ua", "com.cn",
    "co.kr", "co.in", "com.kz", "org.kz",
}


def registrable_domain(host: str) -> str:
    """Домен «сайта» для хоста: jobs.acme.ru и www.acme.ru -> acme.ru.

    IP-адреса и одиночные имена (localhost) возвращаются как есть: поддоменов
    у них для нашей проверки нет.
    """
    host = _host(host)
    labels = host.split(".")
    if len(labels) < 2 or all(part.isdigit() for part in labels) or ":" in host:
        return host
    tail = ".".join(labels[-2:])
    if tail in _TWO_LEVEL_SUFFIXES and len(labels) >= 3:
        return ".".join(labels[-3:])
    return tail


def same_site(host: str, other: str) -> bool:
    """Тот же регистрируемый домен (поддомены считаются одним сайтом)."""
    a, b = registrable_domain(host), registrable_domain(other)
    return bool(a) and a == b


def is_apply_ats(host: str) -> bool:
    """Известный ATS, куда можно подавать без входа кандидата."""
    info = _match(_host(host))
    return info is not None and info.can_apply
