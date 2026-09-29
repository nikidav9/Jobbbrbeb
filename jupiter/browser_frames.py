"""Анкеты внутри iframe: поиск фрейма, прямой адрес, снимок.

Виджеты Huntflow, Potok, HH, Talantix и самописные вставляют анкету в iframe:
на главной странице полей нет, и движок считает, что анкеты нет. Модуль только
находит такие фреймы и снимает их тем же SNAPSHOT_JS; вставить вызовы в
JupiterBrowserEngine (open/_reveal_form) должен движок. Playwright тут не
импортируется: функции принимают готовые Page/Frame.
"""
from __future__ import annotations

import urllib.parse
from dataclasses import dataclass
from typing import Any

# Хосты известных ATS (по суффиксу): анкету с них имеет смысл открыть напрямую.
KNOWN_ATS_HOSTS = (
    "huntflow.ru", "huntflow.io", "potok.io", "hh.ru", "talantix.ru",
    "greenhouse.io", "lever.co", "workable.com", "smartrecruiters.com",
    "teamtailor.com", "recruitee.com", "ashbyhq.com", "bamboohr.com",
)

# Есть ли во фрейме видимая анкета кандидата: считаем видимые поля и те, чьи
# метки (label, placeholder, name, id, aria-label) говорят про имя/телефон/почту.
FRAME_FORM_JS = r"""
() => {
  const visible = el => {
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const nameRe = /имя|фамили|фио|full.?name|first.?name|last.?name|\bname\b|телефон|phone|mobile|тел\./i;
  let fields = 0, personal = 0, contact = 0;
  for (const el of document.querySelectorAll('input,textarea')) {
    const type = (el.type || 'text').toLowerCase();
    if (!['text', 'email', 'tel', 'file', 'textarea', ''].includes(type) && el.tagName !== 'TEXTAREA') continue;
    if (type !== 'file' && !visible(el)) continue;
    fields++;
    if (type === 'email' || type === 'tel') contact++;
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const text = [lab, el.placeholder, el.name, el.id, el.getAttribute('aria-label')].join(' ');
    if (nameRe.test(text)) personal++;
  }
  return { fields, personal, contact };
}
"""


@dataclass
class ApplicationFrame:
    frame: Any
    url: str
    same_origin: bool
    known_ats: bool
    # Адрес для прямого открытия страницей; None — нельзя (нет адреса
    # или хост не разрешён и не известный ATS).
    direct_url: str | None


def _origin(url: str) -> str:
    p = urllib.parse.urlparse(url)
    return f"{p.scheme}://{p.netloc}".lower()


def _host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower()


def is_known_ats(host: str) -> bool:
    host = host.lower()
    return any(host == h or host.endswith("." + h) for h in KNOWN_ATS_HOSTS)


def _looks_like_application(info: dict) -> bool:
    return info["fields"] >= 2 and info["personal"] >= 1 and (
        info["contact"] >= 1 or info["personal"] >= 2
    )


def find_application_frames(page, allowed_hosts: set[str] | None = None) -> list[ApplicationFrame]:
    """Фреймы (same- и cross-origin, любой вложенности) с анкетой кандидата."""
    allowed = {h.lower() for h in (allowed_hosts or set())}
    main_origin = _origin(page.main_frame.url)
    found: list[ApplicationFrame] = []
    for frame in page.frames:
        if frame == page.main_frame or frame.is_detached():
            continue
        try:
            info = frame.evaluate(FRAME_FORM_JS)
        except Exception:  # фрейм закрылся или ещё грузится
            continue
        if not _looks_like_application(info):
            continue
        url = frame.url
        http = url.lower().startswith(("http://", "https://"))
        host = _host(url) if http else ""
        ats = bool(host) and is_known_ats(host)
        found.append(ApplicationFrame(
            frame=frame,
            url=url,
            same_origin=(not http) or _origin(url) == main_origin,
            known_ats=ats,
            direct_url=frame_direct_url(frame, allowed),
        ))
    return found


def frame_direct_url(frame, allowed_hosts: set[str] | None = None) -> str | None:
    """Адрес cross-origin фрейма, если его можно открыть страницей.

    Только http(s) с чужим origin, чей хост разрешён или является известным
    ATS. Для ATS-хоста вне allowed_hosts движок обязан сам решить, добавлять
    ли хост в allowed_hosts (assert_allowed иначе откажет).
    """
    allowed = {h.lower() for h in (allowed_hosts or set())}
    url = frame.url
    if not url.lower().startswith(("http://", "https://")):
        return None
    host = _host(url)
    page_origin = None
    try:
        page_origin = _origin(frame.page.main_frame.url)
    except Exception:
        pass
    if page_origin and _origin(url) == page_origin:
        return None
    if host in allowed or is_known_ats(host):
        return url
    return None


def snapshot_frame(frame, snapshot_js: str, arg: Any) -> dict:
    """Снимок фрейма тем же SNAPSHOT_JS: {'html', 'url', 'virtualForm'}.

    Метки data-jt-ref расставляются внутри фрейма, поэтому заполнять и нажимать
    надо через тот же frame.locator(...), а не через page.locator.
    """
    return frame.evaluate(snapshot_js, arg)
