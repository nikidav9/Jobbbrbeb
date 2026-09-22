#!/usr/bin/env python3
"""Данные, которые SPA кладёт в страницу рядом с пустой разметкой.

Зачем это нужно. На React/Next/Nuxt-сайте в первичном HTML формы нет, и ссылки
на анкету тоже часто нет: её строит браузер из состояния, пришедшего в
<script>. Jupiter такую страницу раньше объявлял UNSUPPORTED_SCRIPT и на этом
заканчивал — хотя нужный адрес лежал в разметке открытым текстом.

Чего этот модуль НЕ делает: он не исполняет React и не восстанавливает
компоненты. Он только читает уже готовый JSON и достаёт из него адреса. Если
адреса там нет, честный ответ прежний — нужен человек.

Всё найденное — недоверенные данные работодателя. Адрес отсюда проходит ту же
политику хостов, что и любой другой: модуль ничего не открывает сам.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass
from typing import Any, Iterator

# Столько же, сколько у внешнего скрипта в движке: больше — уже не состояние
# страницы, а выгрузка базы.
MAX_SCRIPT_BYTES = 256 * 1024
MAX_DEPTH = 12
MAX_CANDIDATES = 200

_SCRIPT_RE = re.compile(
    r"<script\b([^>]*)>([\s\S]*?)</script\s*>",
    re.IGNORECASE,
)
_ATTR_RE = re.compile(
    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2""",
    re.DOTALL,
)
# window.__NUXT__ = {...}; window.__INITIAL_STATE__ = {...}
_ASSIGNED_STATE_RE = re.compile(
    r"""(?:window|self|globalThis)\s*\.\s*"""
    r"""(__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__)"""
    r"""\s*=\s*""",
)

_SAFE_SCHEMES = {"http", "https"}

# Шаблон маршрута, а не адрес. В __NEXT_DATA__ всегда лежит ключ page вида
# "/vacancy/[id]", и по очкам он легко обыгрывает настоящую ссылку на анкету:
# слово «vacancy» в нём есть, а страницы по нему нет — только 404.
_ROUTE_TEMPLATE_RE = re.compile(r"[\[\]{}]|/:[A-Za-z_]")


@dataclass
class SpaPayload:
    kind: str
    source: str
    data: Any

    def as_diagnostic(self) -> dict[str, str]:
        return {"kind": self.kind, "source": self.source}


def _attrs(raw: str) -> dict[str, str]:
    return {k.lower(): v for k, _q, v in _ATTR_RE.findall(raw)}


def _balanced_object(text: str, start: int) -> str | None:
    """Кусок от `{` до парной `}`, с учётом строк и экранирования."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    quote = ""
    index = start
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
        index += 1
    return None


def _load(text: str) -> Any | None:
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def extract_payloads(html: str) -> list[SpaPayload]:
    """Разобрать встроенный JSON. Что не разобралось — молча пропускаем."""
    payloads: list[SpaPayload] = []
    for match in _SCRIPT_RE.finditer(html or ""):
        raw_attrs, body = match.groups()
        if len(body.encode("utf-8", "ignore")) > MAX_SCRIPT_BYTES:
            continue
        attrs = _attrs(raw_attrs)
        script_type = attrs.get("type", "").lower()
        script_id = attrs.get("id", "")

        if script_id == "__NEXT_DATA__":
            data = _load(body)
            if data is not None:
                payloads.append(SpaPayload("next_data", "__NEXT_DATA__", data))
            continue

        if "ld+json" in script_type:
            data = _load(body)
            if data is not None:
                payloads.append(SpaPayload("ld_json", "application/ld+json", data))
            continue

        if script_type in {"application/json", "text/json"}:
            data = _load(body)
            if data is not None:
                source = script_id or attrs.get("data-name", "") or "application/json"
                payloads.append(SpaPayload("embedded_json", source, data))
            continue

        # Присваивание состояния в обычном скрипте. Берём только тот случай,
        # когда справа лежит настоящий JSON: у Nuxt там бывает функция, и
        # исполнять её мы не будем — это был бы тот самый произвольный JS.
        assigned = _ASSIGNED_STATE_RE.search(body)
        if assigned:
            brace = body.find("{", assigned.end())
            if brace != -1:
                chunk = _balanced_object(body, brace)
                data = _load(chunk) if chunk else None
                if data is not None:
                    payloads.append(
                        SpaPayload("assigned_state", assigned.group(1), data)
                    )
    return payloads


def _walk(node: Any, path: str, depth: int) -> Iterator[tuple[str, str]]:
    if depth > MAX_DEPTH:
        return
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else str(key)
            yield from _walk(value, child, depth + 1)
    elif isinstance(node, list):
        for index, value in enumerate(node[:50]):
            yield from _walk(value, f"{path}[{index}]", depth + 1)
    elif isinstance(node, str):
        yield path, node


def _looks_like_url(value: str) -> bool:
    value = value.strip()
    if not value or len(value) > 2048 or any(c.isspace() for c in value):
        return False
    if _ROUTE_TEMPLATE_RE.search(value):
        return False
    if value.startswith(("http://", "https://", "//")):
        return True
    # Относительный путь. Одиночный «/» и якоря не интересны.
    return value.startswith("/") and len(value) > 1 and not value.startswith("//")


def url_candidates(
    payloads: list[SpaPayload],
    base_url: str,
) -> list[tuple[str, str]]:
    """Адреса из состояния страницы с подсказкой — путём до значения.

    Путь важен не меньше самого адреса: по ключу applyUrl видно намерение
    там, где по самому адресу не видно ничего.
    """
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for payload in payloads:
        for path, value in _walk(payload.data, "", 0):
            if len(found) >= MAX_CANDIDATES:
                return found
            if not _looks_like_url(value):
                continue
            absolute = urllib.parse.urljoin(base_url, value.strip())
            parsed = urllib.parse.urlparse(absolute)
            if parsed.scheme.lower() not in _SAFE_SCHEMES:
                continue
            if parsed.username or parsed.password:
                continue
            if absolute in seen:
                continue
            seen.add(absolute)
            found.append((absolute, f"{payload.kind}.{path}" if path else payload.kind))
    return found
