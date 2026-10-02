"""HR-почта на странице вакансии — для отклика письмом (п.4, 01.10.2026).

Замер 01.10.2026: у 39 из 189 сайтов, где Юпитер не нашёл анкету, есть
почта для резюме (hr@, job@, rabota@…). Решение владельца: такой отклик шлёт
сервер с личного адреса кандидата в JobToo (php-proxy/jupiter_email_apply.php).

Здесь только находка адреса. Строго: почта на домене самой компании (тот же
зарегистрированный домен, что у вакансии) и по смыслу — для резюме: HR-имя
ящика или слова о резюме рядом. Чужие домены (gmail, подрядчики) не берём —
отправить резюме постороннему хуже, чем не отправить. Только stdlib.
"""
from __future__ import annotations

import html
import re
import urllib.parse

_EMAIL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
_MAILTO = re.compile(r"""mailto:([^"'?\s>]+)""", re.IGNORECASE)
_HR_LOCAL = re.compile(
    r"^(hr|job|jobs|career|careers|cv|resume|rabota|work|vacanc\w*|hiring|recruit\w*|"
    r"personal|kadr\w*|talent\w*|team|join|people|staff|otbor|podbor|hh)([._-]\w+)?$"
)
_CONTEXT = re.compile(r"резюме|\bcv\b|ваканси|откли|кандидат|карьер|трудоустро|resume|vacanc|career", re.I)
# Без HR-имени ящика (info@, личный адрес) — только с прямой просьбой о резюме
# рядом: «карьера» в меню рядом с info@ — ещё не приглашение.
_STRONG = re.compile(r"резюме|\bcv\b|resume|откли", re.I)
_NEVER_LOCAL = re.compile(r"^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|dpo|pd|"
                          r"press|pr|media|smi|sales|sale|order|zakaz|partner\w*|tender\w*|support|help)$")
_TWO_LEVEL = {"com.ru", "net.ru", "org.ru", "msk.ru", "spb.ru", "co.uk", "com.ua"}


def registrable(host: str) -> str:
    parts = (host or "").lower().strip(".").split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in _TWO_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def same_company(email: str, vacancy_url: str) -> bool:
    domain = email.rsplit("@", 1)[-1].lower()
    host = (urllib.parse.urlsplit(vacancy_url).hostname or "").lower()
    return bool(host) and registrable(domain) == registrable(host)


def find_hr_email(page_html: str, page_text: str, vacancy_url: str) -> str | None:
    """Адрес для резюме на домене компании или None."""
    source = html.unescape(page_html or "")
    text = html.unescape(page_text or "")
    found: list[tuple[int, str]] = []
    seen: set[str] = set()
    candidates = [urllib.parse.unquote(m) for m in _MAILTO.findall(source)] + _EMAIL.findall(text)
    for raw in candidates:
        match = _EMAIL.fullmatch(raw.strip().strip(".,;:"))
        if not match:
            continue
        email = match.group(0).lower()
        if email in seen:
            continue
        seen.add(email)
        local = email.split("@", 1)[0]
        if _NEVER_LOCAL.match(local) or not same_company(email, vacancy_url):
            continue
        hr = bool(_HR_LOCAL.match(local))
        score = 2 if hr else 0
        for hay in (text, source):
            at = hay.lower().find(email)
            if at < 0:
                continue
            near = hay[max(0, at - 160):at + 160]
            if (_CONTEXT if hr else _STRONG).search(near):
                score += 1
                break
        if score:
            found.append((score, email))
    if not found:
        return None
    return max(found, key=lambda item: item[0])[1]
