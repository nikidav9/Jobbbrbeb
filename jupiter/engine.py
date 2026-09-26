#!/usr/bin/env python3
from __future__ import annotations

import html
import http.client
import http.cookiejar
import json
import mimetypes
import re
import os
import socket
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable

from network_runtime import NetworkRequest, NetworkResponse
from policy import NetworkPolicy, PolicyError, is_blocked_address, literal_loopback
from script_runtime import JupiterScriptRuntime


class EngineError(RuntimeError):
    pass


class EngineSecurityError(EngineError):
    pass


class EngineTransportError(EngineError):
    """Ответа не было вовсе: обрыв, таймаут, недоступный хост.

    Отличать это от ответа с кодом 4xx/5xx обязательно. Сервер, ответивший
    четырьмястами, заявку точно не принял. Сервер, оборвавший соединение,
    мог принять её и не успеть сказать — и повторять туда POST нельзя.
    """


@dataclass
class OptionState:
    label: str
    value: str
    selected: bool = False
    disabled: bool = False


@dataclass
class ControlState:
    index: int
    form_index: int | None
    tag: str
    type: str = ""
    name: str = ""
    id: str = ""
    form_attr: str = ""
    placeholder: str = ""
    aria: str = ""
    autocomplete: str = ""
    inputmode: str = ""
    title_attr: str = ""
    label: str = ""
    text: str = ""
    required: bool = False
    disabled: bool = False
    readonly: bool = False
    multiple: bool = False
    value: str = ""
    checked: bool = False
    accept: str = ""
    pattern: str = ""
    minlength: int | None = None
    maxlength: int | None = None
    min_attr: str = ""
    max_attr: str = ""
    step: str = ""
    # Кнопка отправки умеет перебить действие формы. Это не украшение: в одной
    # анкете часто две кнопки — «сохранить черновик» и «откликнуться», — и они
    # ведут на разные адреса.
    formaction: str = ""
    formmethod: str = ""
    formenctype: str = ""
    formnovalidate: bool = False
    # Почему отдельно от disabled: причину надо показывать человеку. Поле,
    # выключенное разделом анкеты, — это не «поле сломано», а «раздел не ваш».
    disabled_by_fieldset: bool = False
    # Заголовок <legend> раздела: ещё одна подсказка о смысле поля, когда у
    # него нет ни label, ни name.
    section: str = ""
    options: list[OptionState] = field(default_factory=list)
    file_path: str | None = None
    file_paths: list[str] = field(default_factory=list)

    @property
    def selected_values(self) -> list[str]:
        """Значения, которые уйдут на сервер. Для multiple их несколько."""
        if self.tag != "select":
            return [self.value]
        chosen = [option.value for option in self.options if option.selected]
        if self.multiple:
            return chosen
        return chosen[:1] if chosen else ([self.value] if self.value else [])


@dataclass
class FormState:
    index: int
    method: str
    action: str
    enctype: str
    id: str = ""
    name: str = ""
    novalidate: bool = False
    control_indices: list[int] = field(default_factory=list)


@dataclass
class PageState:
    url: str
    status: int
    headers: dict[str, str]
    html: str
    title: str
    text: str
    controls: list[ControlState]
    forms: list[FormState]
    has_script: bool
    script_unsupported: bool = False
    script_diagnostics: list[dict[str, str]] = field(default_factory=list)
    base_url: str = ""

    def resolve(self, href: str) -> str:
        """Адрес относительно <base href>, а не относительно адреса страницы.

        Разница не косметическая: у страницы с <base href="/apply/"> форма с
        action="send" уходит на /apply/send, а без учёта base — на /send.
        """
        return urllib.parse.urljoin(self.base_url or self.url, href)

    def snapshot(self) -> dict:
        return {
            "url": self.url,
            "base_url": self.base_url or self.url,
            "status": self.status,
            "title": self.title,
            "text": self.text[:3000],
            "has_script": self.has_script,
            "script_unsupported": self.script_unsupported,
            "script_diagnostics": list(self.script_diagnostics),
            "forms": [
                {
                    "index": f.index,
                    "method": f.method,
                    "action": f.action,
                    "enctype": f.enctype,
                    "id": f.id,
                    "name": f.name,
                    "novalidate": f.novalidate,
                    "controls": list(f.control_indices),
                }
                for f in self.forms
            ],
            "controls": [
                {
                    "index": c.index,
                    "form_index": c.form_index,
                    "tag": c.tag,
                    "type": c.type,
                    "name": c.name,
                    "id": c.id,
                    "form_attr": c.form_attr,
                    "label": c.label,
                    "placeholder": c.placeholder,
                    "aria": c.aria,
                    "autocomplete": c.autocomplete,
                    "inputmode": c.inputmode,
                    "title_attr": c.title_attr,
                    "text": c.text,
                    "section": c.section,
                    "required": c.required,
                    "disabled": c.disabled,
                    "disabled_by_fieldset": c.disabled_by_fieldset,
                    "readonly": c.readonly,
                    "multiple": c.multiple,
                    "value": c.value if c.type != "file" else "",
                    "checked": c.checked,
                    "accept": c.accept,
                    "pattern": c.pattern,
                    "minlength": c.minlength,
                    "maxlength": c.maxlength,
                    "min": c.min_attr,
                    "max": c.max_attr,
                    "step": c.step,
                    "formaction": c.formaction,
                    "formmethod": c.formmethod,
                    "formenctype": c.formenctype,
                    "formnovalidate": c.formnovalidate,
                    "options": [
                        {
                            "label": o.label,
                            "value": o.value,
                            "selected": o.selected,
                            "disabled": o.disabled,
                        }
                        for o in c.options
                    ],
                    "file_attached": bool(c.file_path or c.file_paths),
                }
                for c in self.controls
            ],
        }


_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


class _SemanticParser(HTMLParser):
    def __init__(self, url: str):
        super().__init__(convert_charrefs=True)
        self.url = url
        self.controls: list[ControlState] = []
        self.forms: list[FormState] = []
        self.current_form: int | None = None
        self.form_stack: list[int | None] = []
        self.label_stack: list[dict] = []
        self.current_select: int | None = None
        self.current_option: dict | None = None
        self.current_textarea: int | None = None
        self.current_button: int | None = None
        self.title_parts: list[str] = []
        self.in_title = False
        self.text_parts: list[str] = []
        self.hidden_tags: list[str] = []
        self.has_script = False
        self.base_href = ""
        # Стек разделов анкеты: каждый элемент — (выключен ли, заголовок).
        # disabled у <fieldset> наследуется вглубь, и браузер такие поля вообще
        # не отправляет — значит, и обязательными они не считаются.
        self.fieldset_stack: list[dict] = []
        self.current_legend: int | None = None

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {k.lower(): (v or "") for k, v in attrs}

    @property
    def hidden(self) -> bool:
        return bool(self.hidden_tags)

    def _push_hidden(self, tag: str, attrs: dict[str, str]) -> None:
        style = attrs.get("style", "").replace(" ", "").lower()
        hidden = (
            tag in {"script", "style", "template"}
            or "hidden" in attrs
            or "display:none" in style
            or "visibility:hidden" in style
        )
        if hidden:
            self.hidden_tags.append(tag)

    def _new_control(self, tag: str, attrs: dict[str, str]) -> int:
        ctype = attrs.get("type", "").lower()
        if tag == "button" and not ctype:
            ctype = "submit"
        if tag == "input" and not ctype:
            ctype = "text"
        value = attrs.get("value", "")
        if ctype in {"checkbox", "radio"} and "value" not in attrs:
            value = "on"

        def _int(name: str) -> int | None:
            raw = attrs.get(name, "").strip()
            if not raw.isdigit():
                return None
            return int(raw)

        fieldset_off = any(item["disabled"] for item in self.fieldset_stack)
        section = next(
            (
                item["legend"]
                for item in reversed(self.fieldset_stack)
                if item["legend"]
            ),
            "",
        )
        c = ControlState(
            index=len(self.controls),
            form_index=self.current_form,
            tag=tag,
            type=ctype,
            name=attrs.get("name", ""),
            id=attrs.get("id", ""),
            form_attr=attrs.get("form", ""),
            placeholder=attrs.get("placeholder", ""),
            aria=attrs.get("aria-label", ""),
            autocomplete=attrs.get("autocomplete", ""),
            inputmode=attrs.get("inputmode", ""),
            title_attr=attrs.get("title", ""),
            required=(
                "required" in attrs
                or attrs.get("aria-required", "").lower() == "true"
            ),
            disabled=(
                "disabled" in attrs
                or attrs.get("aria-disabled", "").lower() == "true"
                or fieldset_off
            ),
            disabled_by_fieldset=fieldset_off,
            readonly="readonly" in attrs
            or attrs.get("aria-readonly", "").lower() == "true",
            multiple="multiple" in attrs,
            section=section,
            value=value,
            checked="checked" in attrs,
            accept=attrs.get("accept", ""),
            pattern=attrs.get("pattern", ""),
            minlength=_int("minlength"),
            maxlength=_int("maxlength"),
            min_attr=attrs.get("min", ""),
            max_attr=attrs.get("max", ""),
            step=attrs.get("step", ""),
            formaction=attrs.get("formaction", ""),
            formmethod=(attrs.get("formmethod", "") or "").lower(),
            formenctype=(attrs.get("formenctype", "") or "").lower(),
            formnovalidate="formnovalidate" in attrs,
        )
        self.controls.append(c)
        if self.current_form is not None:
            self.forms[self.current_form].control_indices.append(c.index)
        if self.label_stack:
            self.label_stack[-1]["controls"].append(c.index)
        return c.index

    def handle_starttag(self, tag: str, attrs_raw: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs = self._attrs(attrs_raw)
        if tag == "script":
            self.has_script = True
        self._push_hidden(tag, attrs)

        if tag == "title":
            self.in_title = True
            return

        if tag == "base" and not self.base_href and attrs.get("href"):
            self.base_href = urllib.parse.urljoin(self.url, attrs["href"])
            return

        if tag == "fieldset":
            self.fieldset_stack.append({
                "disabled": "disabled" in attrs,
                "legend": "",
                "parts": [],
            })
            return

        if tag == "legend" and self.fieldset_stack:
            self.current_legend = len(self.fieldset_stack) - 1
            return

        if tag == "form":
            self.form_stack.append(self.current_form)
            form = FormState(
                index=len(self.forms),
                method=(attrs.get("method", "get") or "get").lower(),
                action=attrs.get("action", ""),
                enctype=(attrs.get("enctype", "application/x-www-form-urlencoded")
                         or "application/x-www-form-urlencoded").lower(),
                id=attrs.get("id", ""),
                name=attrs.get("name", ""),
                novalidate="novalidate" in attrs,
            )
            self.forms.append(form)
            self.current_form = form.index
            return

        if tag == "label":
            self.label_stack.append({
                "for": attrs.get("for", ""),
                "parts": [],
                "controls": [],
            })
            return

        if tag == "input":
            self._new_control(tag, attrs)
            return

        if tag == "textarea":
            self.current_textarea = self._new_control(tag, attrs)
            return

        if tag == "select":
            self.current_select = self._new_control(tag, attrs)
            return

        if tag == "option" and self.current_select is not None:
            self.current_option = {
                "value": attrs.get("value"),
                "selected": "selected" in attrs,
                "disabled": "disabled" in attrs,
                "parts": [],
            }
            return

        if tag == "button":
            self.current_button = self._new_control(tag, attrs)
            return

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in _VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag == "title":
            self.in_title = False

        if tag == "option" and self.current_option is not None and self.current_select is not None:
            parts = self.current_option["parts"]
            label = " ".join("".join(parts).split())
            value = self.current_option["value"]
            if value is None:
                value = label
            self.controls[self.current_select].options.append(
                OptionState(
                    label=label,
                    value=value,
                    selected=bool(self.current_option["selected"]),
                    disabled=bool(self.current_option["disabled"]),
                )
            )
            self.current_option = None

        if tag == "select" and self.current_select is not None:
            control = self.controls[self.current_select]
            selected = [o for o in control.options if o.selected]
            if not selected and control.options and not control.multiple:
                # Браузер сам подсвечивает первый пункт у обычного select. У
                # multiple — нет: там пустой выбор законен.
                first = control.options[0]
                first.selected = True
                selected = [first]
            control.value = selected[0].value if selected else ""
            self.current_select = None

        if tag == "textarea":
            self.current_textarea = None

        if tag == "button":
            self.current_button = None

        if tag == "legend" and self.current_legend is not None:
            item = self.fieldset_stack[self.current_legend]
            item["legend"] = " ".join("".join(item["parts"]).split())
            self.current_legend = None

        if tag == "fieldset" and self.fieldset_stack:
            self.fieldset_stack.pop()

        if tag == "label" and self.label_stack:
            label = self.label_stack.pop()
            text_value = " ".join("".join(label["parts"]).split())
            for index in label["controls"]:
                if not self.controls[index].label:
                    self.controls[index].label = text_value
            target = label["for"]
            if target:
                for control in self.controls:
                    if control.id == target and not control.label:
                        control.label = text_value

        if tag == "form":
            self.current_form = self.form_stack.pop() if self.form_stack else None

        if self.hidden_tags and tag == self.hidden_tags[-1]:
            self.hidden_tags.pop()

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)

        if self.current_option is not None:
            self.current_option["parts"].append(data)

        if self.current_textarea is not None:
            self.controls[self.current_textarea].value += data

        if self.current_button is not None:
            self.controls[self.current_button].text += data

        if self.current_legend is not None:
            self.fieldset_stack[self.current_legend]["parts"].append(data)

        if self.label_stack:
            self.label_stack[-1]["parts"].append(data)

        if not self.hidden:
            clean = " ".join(data.split())
            if clean:
                self.text_parts.append(clean)

    def finish(self, html_text: str, status: int, headers: dict[str, str]) -> PageState:
        title = " ".join("".join(self.title_parts).split())
        body_text = " ".join(self.text_parts)
        form_ids = {
            form.id: form.index
            for form in self.forms
            if form.id
        }
        for c in self.controls:
            c.text = " ".join(c.text.split())
            c.label = " ".join(c.label.split())
            if c.tag == "textarea":
                c.value = c.value.strip()
            if c.form_index is None and c.form_attr in form_ids:
                c.form_index = form_ids[c.form_attr]
                form = self.forms[c.form_index]
                if c.index not in form.control_indices:
                    form.control_indices.append(c.index)
        return PageState(
            url=self.url,
            base_url=self.base_href or self.url,
            status=status,
            headers=headers,
            html=html_text,
            title=title,
            text=body_text,
            controls=self.controls,
            forms=self.forms,
            has_script=self.has_script,
        )


def _pinned_connection(base, pinned_ip: str | None):
    """Соединение ровно на тот адрес, который прошёл проверку.

    Между проверкой DNS и подключением остаётся окно, в которое бьёт DNS
    rebinding: первый ответ безобидный, второй указывает внутрь сети. Окно
    закрывается тем, что подключаемся по уже проверенному адресу, а имя
    оставляем для заголовка Host и для TLS.
    """

    class _Pinned(base):
        def connect(self):
            target = pinned_ip or self.host
            self.sock = socket.create_connection(
                (target, self.port), self.timeout, self.source_address
            )
            if getattr(self, "_tunnel_host", None):
                self._tunnel()
            context = getattr(self, "_context", None)
            if context is not None:
                self.sock = context.wrap_socket(
                    self.sock, server_hostname=self.host
                )

    return _Pinned


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, pins: dict[str, str]):
        super().__init__()
        self.pins = pins

    def http_open(self, req):
        host = (req.host or "").split(":")[0].lower()
        return self.do_open(
            _pinned_connection(http.client.HTTPConnection, self.pins.get(host)),
            req,
        )


# Т-Банк, Альфа-Банк и Точка подписаны центром Минцифры (Russian Trusted CA),
# которого нет в системном списке, и без него их анкеты не открыть даже из
# Москвы. Решение владельца 26.09.2026 — то же, что у сборщика вакансий
# (php-proxy/safe_url.php, JT_RU_CA_HOSTS): для этих доменов и их поддоменов
# доверяем ТОЛЬКО этому центру (он заменяет системный список, а не дополняет),
# для остальных сайтов не меняется ничего. Проверка сертификата и имени хоста
# остаётся включённой.
RU_CA_HOSTS = ("tbank.ru", "alfabank.ru", "tochka.com")
_RU_CA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ru_trusted_ca.pem")
_ru_ca_context: ssl.SSLContext | None = None


def needs_ru_ca(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == s or host.endswith("." + s) for s in RU_CA_HOSTS)


def ru_ca_context() -> ssl.SSLContext:
    global _ru_ca_context
    if _ru_ca_context is None:
        # cafile вместо системного списка: create_default_context не грузит
        # системные корни, когда ему дан свой файл.
        _ru_ca_context = ssl.create_default_context(cafile=_RU_CA_FILE)
    return _ru_ca_context


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, pins: dict[str, str]):
        super().__init__()
        self.pins = pins

    def https_open(self, req):
        host = (req.host or "").split(":")[0].lower()
        return self.do_open(
            _pinned_connection(http.client.HTTPSConnection, self.pins.get(host)),
            req,
            context=ru_ca_context() if needs_ru_ca(host) else self._context,
        )


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, validator: Callable[[str], None]):
        super().__init__()
        self.validator = validator

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        resolved = urllib.parse.urljoin(req.full_url, newurl)
        self.validator(resolved)
        return super().redirect_request(req, fp, code, msg, headers, resolved)


class JupiterWebEngine:
    """
    Agent-native HTTP/HTML runtime.

    No browser process, Playwright, Selenium, external AI, or ATS integration.
    It intentionally does not execute arbitrary JavaScript. A JS-only page is
    surfaced to the agent as action_required instead of pretending success.
    """

    # Атрибут, а не литерал в запросе: разведка сверяет, режет ли сайт именно
    # нашу подпись. Боевой воркер её не меняет.
    user_agent = "JupiterWebEngine/1.0 (+JobToo)"

    def __init__(
        self,
        allowed_hosts: set[str],
        *,
        timeout: float = 20.0,
        max_response_bytes: int = 5 * 1024 * 1024,
        read_only: bool = False,
        allow_private_addresses: bool | None = None,
    ):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        # Внутренние адреса разрешены, только если петлю или частный адрес
        # вписали в список ПРИ СОЗДАНИИ движка. Позже список пополняется
        # адресом запуска, и выводить разрешение из него нельзя: стартовый
        # адрес разрешил бы себя сам.
        self.allow_private_addresses = (
            any(
                literal_loopback(host) or is_blocked_address(host.strip("[]"))
                for host in self.allowed_hosts
            )
            if allow_private_addresses is None
            else allow_private_addresses
        )
        self.timeout = timeout
        self.max_response_bytes = max_response_bytes
        self.read_only = read_only
        self.cookies = http.cookiejar.CookieJar()
        # Адреса, прошедшие проверку: по ним и подключаемся.
        self._pins: dict[str, str] = {}
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies),
            _PinnedHTTPHandler(self._pins),
            _PinnedHTTPSHandler(self._pins),
            _SafeRedirectHandler(self.assert_reachable),
        )
        self.page: PageState | None = None
        self.script_runtime: JupiterScriptRuntime | None = None
        self.script_history: list[dict[str, str]] = []
        self.last_submit_mode = "none"

    def assert_allowed(self, url: str) -> None:
        """Имя разрешено: схема, отсутствие логина в адресе, список хостов."""
        self._check(url, resolve=False)

    def assert_reachable(self, url: str) -> None:
        """Туда можно идти — и вот по какому IP.

        Проверка имени сама по себе ничего не стоит: куда указывает домен,
        решает чужая сторона. Поэтому перед каждым запросом адрес резолвится,
        внутренние сети и метаданные облака отсекаются, а результат
        запоминается — на него и пойдёт соединение.
        """
        self._check(url, resolve=True)

    def _check(self, url: str, *, resolve: bool) -> None:
        policy = NetworkPolicy(
            self.allowed_hosts, allow_private=self.allow_private_addresses
        )
        try:
            addresses = policy.check_url(url, resolve=resolve)
        except PolicyError as exc:
            raise EngineSecurityError(str(exc)) from exc
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        if addresses:
            self._pins[host] = addresses[0]

    def _decode(self, raw: bytes, headers) -> str:
        charset = None
        try:
            charset = headers.get_content_charset()
        except Exception:
            charset = None
        for candidate in [charset, "utf-8", "windows-1251", "latin-1"]:
            if not candidate:
                continue
            try:
                return raw.decode(candidate)
            except (LookupError, UnicodeDecodeError):
                continue
        return raw.decode("utf-8", errors="replace")

    @staticmethod
    def _origin(url: str) -> tuple[str, str, int | None]:
        parsed = urllib.parse.urlparse(url)
        return (parsed.scheme.lower(), (parsed.hostname or "").lower(), parsed.port)

    @staticmethod
    def _meta_content(html_text: str, name: str) -> str | None:
        for match in re.finditer(r"<meta\b[^>]*>", html_text, flags=re.IGNORECASE):
            attrs = {
                key.lower(): value
                for key, _quote, value in re.findall(
                    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2""",
                    match.group(0),
                    flags=re.DOTALL,
                )
            }
            if attrs.get("name") == name and attrs.get("content") is not None:
                return attrs["content"]
        return None

    def _load_external_script(self, page_url: str, src: str) -> str:
        target = urllib.parse.urljoin(page_url, src)
        self.assert_reachable(target)
        if self._origin(target) != self._origin(page_url):
            raise EngineSecurityError("External scripts must be same-origin")

        req = urllib.request.Request(
            target,
            method="GET",
            headers={
                "User-Agent": self.user_agent,
                "Accept": "application/javascript,text/javascript;q=0.9,text/plain;q=0.5",
            },
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                final_url = response.geturl()
                self.assert_allowed(final_url)
                if self._origin(final_url) != self._origin(page_url):
                    raise EngineSecurityError(
                        "External script redirect escaped same-origin"
                    )
                content_type = (
                    response.headers.get("Content-Type") or ""
                ).lower()
                if content_type and not (
                    "javascript" in content_type
                    or "ecmascript" in content_type
                    or "text/plain" in content_type
                ):
                    raise EngineSecurityError(
                        f"External script type is not allowed: {content_type}"
                    )
                limit = 256 * 1024
                raw = response.read(limit + 1)
                if len(raw) > limit:
                    raise EngineError("External script is too large")
                return self._decode(raw, response.headers)
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(
                f"External script load failed: {type(exc).__name__}: {exc}"
            ) from exc

    def _parse(
        self,
        *,
        url: str,
        status: int,
        headers: dict[str, str],
        html_text: str,
    ) -> PageState:
        runtime = JupiterScriptRuntime(
            html_text,
            external_loader=lambda src: self._load_external_script(url, src),
        )
        script_result = runtime.bootstrap()
        semantic_html = script_result.html

        parser = _SemanticParser(url)
        parser.feed(semantic_html)
        parser.close()
        page = parser.finish(semantic_html, status, headers)
        page.script_unsupported = script_result.unsupported
        page.script_diagnostics = script_result.diagnostic_dicts()
        self._record_script_diagnostics(url, page.script_diagnostics)
        self.script_runtime = runtime if page.has_script else None
        self.page = page
        return page

    def _record_script_diagnostics(
        self,
        url: str,
        diagnostics: list[dict[str, str]],
    ) -> None:
        existing = {
            (item.get("url", ""), item.get("kind", ""), item.get("detail", ""))
            for item in self.script_history
        }
        for item in diagnostics:
            record = {
                "url": url,
                "kind": str(item.get("kind", "")),
                "detail": str(item.get("detail", "")),
            }
            key = (record["url"], record["kind"], record["detail"])
            if key not in existing:
                self.script_history.append(record)
                existing.add(key)

    def _parse_runtime_dom(
        self,
        *,
        url: str,
        status: int,
        headers: dict[str, str],
        html_text: str,
    ) -> PageState:
        parser = _SemanticParser(url)
        parser.feed(html_text)
        parser.close()
        page = parser.finish(html_text, status, headers)
        if self.script_runtime is not None:
            page.script_unsupported = self.script_runtime.unsupported
            page.script_diagnostics = [
                item.as_dict() for item in self.script_runtime.diagnostics
            ]
            self._record_script_diagnostics(url, page.script_diagnostics)
        self.page = page
        return page

    def load_html(self, html_text: str, logical_url: str) -> PageState:
        self.assert_allowed(logical_url)
        return self._parse(
            url=logical_url,
            status=200,
            headers={"content-type": "text/html; charset=utf-8"},
            html_text=html_text,
        )

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> PageState:
        self.assert_reachable(url)
        method = method.upper()
        if self.read_only and method not in {"GET", "HEAD"}:
            raise EngineSecurityError(
                f"Read-only Jupiter engine blocked mutating request: {method}"
            )
        request_headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        }
        request_headers.update(headers or {})
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers=request_headers,
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                final_url = response.geturl()
                self.assert_allowed(final_url)
                content_type = (response.headers.get("Content-Type") or "").lower()
                if content_type and not (
                    "text/html" in content_type
                    or "application/xhtml+xml" in content_type
                    or "text/plain" in content_type
                ):
                    raise EngineError(f"Unsupported response type: {content_type}")
                raw = response.read(self.max_response_bytes + 1)
                if len(raw) > self.max_response_bytes:
                    raise EngineError("Response is too large")
                text = self._decode(raw, response.headers)
                headers_dict = {k.lower(): v for k, v in response.headers.items()}
                return self._parse(
                    url=final_url,
                    status=int(getattr(response, "status", 200)),
                    headers=headers_dict,
                    html_text=text,
                )
        except EngineError:
            raise
        except urllib.error.HTTPError as exc:
            # Код состояния есть — значит запрос дошёл и был обработан.
            raise EngineError(
                f"HTTP request failed: HTTPError: {exc}"
            ) from exc
        except Exception as exc:
            raise EngineTransportError(
                f"HTTP transport failed: {type(exc).__name__}: {exc}"
            ) from exc

    def request_json(
        self,
        url: str,
        *,
        method: str = "GET",
        payload: dict | list | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, object]:
        """JSON request with the same network/read-only policy as HTML navigation.

        This exists for employer public APIs used by their own application UI.
        It does not execute page JavaScript and it never weakens read_only.
        """
        self.assert_reachable(url)
        method = method.upper()
        if self.read_only and method not in {"GET", "HEAD"}:
            raise EngineSecurityError(
                f"Read-only Jupiter engine blocked mutating request: {method}"
            )
        request_headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json",
        }
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request_headers.update(headers or {})
        req = urllib.request.Request(
            url, data=data, method=method, headers=request_headers,
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                final_url = response.geturl()
                self.assert_allowed(final_url)
                raw = response.read(self.max_response_bytes + 1)
                if len(raw) > self.max_response_bytes:
                    raise EngineError("Response is too large")
                try:
                    body = json.loads(raw.decode("utf-8", errors="strict") or "null")
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise EngineError("Employer API returned invalid JSON") from exc
                return int(getattr(response, "status", 200)), body
        except EngineError:
            raise
        except urllib.error.HTTPError as exc:
            raw = exc.read(self.max_response_bytes + 1)
            if len(raw) > self.max_response_bytes:
                raise EngineError("Response is too large") from exc
            try:
                body = json.loads(raw.decode("utf-8", errors="replace") or "null")
            except json.JSONDecodeError:
                body = {"error": {"message": str(exc)}}
            return int(exc.code), body
        except Exception as exc:
            raise EngineTransportError(
                f"HTTP transport failed: {type(exc).__name__}: {exc}"
            ) from exc

    def open(self, url: str) -> PageState:
        return self.request(url)

    @staticmethod
    def _successful_controls(
        page: PageState,
        form: FormState,
        submit_control: ControlState | None,
    ) -> tuple[list[tuple[str, str]], list[tuple[str, Path]]]:
        fields: list[tuple[str, str]] = []
        files: list[tuple[str, Path]] = []

        for index in form.control_indices:
            control = page.controls[index]
            if control.disabled or not control.name:
                continue
            if control.type in {"reset", "button"}:
                continue
            if control.type in {"submit", "image"} and control is not submit_control:
                continue
            if control.type in {"checkbox", "radio"} and not control.checked:
                continue
            if control.type == "file":
                for path in control.file_paths or (
                    [control.file_path] if control.file_path else []
                ):
                    files.append((control.name, Path(path)))
                continue
            if control.tag == "select":
                # multiple отдаёт столько пар name=value, сколько выбрано.
                # Одно значение вместо трёх — это молча отправленная не та
                # анкета, а не ошибка отправки.
                for value in control.selected_values:
                    fields.append((control.name, value))
                continue
            fields.append((control.name, control.value))

        if submit_control and submit_control.name and submit_control.type in {"submit", "image"}:
            if submit_control.type == "image":
                # У кнопки-картинки браузер шлёт координаты клика, а не value.
                # Серверы, которые по ним отличают отправку от перезагрузки,
                # без этих пар анкету не принимают.
                fields.extend([
                    (f"{submit_control.name}.x", "0"),
                    (f"{submit_control.name}.y", "0"),
                ])
            elif (submit_control.name, submit_control.value) not in fields:
                fields.append((submit_control.name, submit_control.value))

        return fields, files

    @staticmethod
    def _multipart(
        fields: list[tuple[str, str]],
        files: list[tuple[str, Path]],
    ) -> tuple[bytes, str]:
        boundary = "----JupiterBoundary" + secrets.token_hex(16)
        chunks: list[bytes] = []

        for name, value in fields:
            chunks.extend([
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode("utf-8"),
                b"\r\n",
            ])

        for name, path in files:
            if not path.is_file():
                raise EngineError(f"Upload file does not exist: {path}")
            filename = path.name.replace('"', "")
            ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            chunks.extend([
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{filename}"\r\n'
                ).encode(),
                f"Content-Type: {ctype}\r\n\r\n".encode(),
                path.read_bytes(),
                b"\r\n",
            ])

        chunks.append(f"--{boundary}--\r\n".encode())
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    def _script_network_fetch(
        self,
        page: PageState,
        form: FormState,
        network_request: NetworkRequest,
    ) -> NetworkResponse:
        target = page.resolve(network_request.url)
        self.assert_reachable(target)

        method = network_request.method.upper()
        if self.read_only and method not in {"GET", "HEAD"}:
            raise EngineSecurityError(
                f"Read-only Jupiter engine blocked script request: {method}"
            )
        if method not in {"GET", "POST"}:
            raise EngineSecurityError(
                f"Script network method '{method}' is not allowed"
            )

        if network_request.form_ref:
            if not form.id or network_request.form_ref != form.id:
                raise EngineSecurityError(
                    "Script network request attempted to read a different form"
                )

        fields, files = self._successful_controls(page, form, None)
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json,text/plain,text/html;q=0.8,*/*;q=0.1",
        }
        safe_headers = {
            "accept",
            "content-type",
            "x-csrf-token",
            "x-xsrf-token",
            "x-requested-with",
        }
        for key, value in network_request.headers.items():
            if key.lower() not in safe_headers:
                raise EngineSecurityError(
                    f"Script request header is not allowed: {key}"
                )
            headers[key] = value
        for key, meta_name in network_request.meta_headers.items():
            if key.lower() not in safe_headers:
                raise EngineSecurityError(
                    f"Script request header is not allowed: {key}"
                )
            meta_value = self._meta_content(page.html, meta_name)
            if meta_value is None:
                raise EngineSecurityError(
                    f"Required meta token is missing: {meta_name}"
                )
            headers[key] = meta_value
        data: bytes | None = None

        if network_request.body_mode == "formdata":
            if method != "POST":
                raise EngineSecurityError(
                    "FormData script requests require POST"
                )
            data, content_type = self._multipart(fields, files)
            headers["Content-Type"] = content_type
        elif network_request.body_mode == "urlencoded":
            if files:
                raise EngineSecurityError(
                    "URL-encoded script request cannot include uploaded files"
                )
            if method != "POST":
                raise EngineSecurityError(
                    "URL-encoded script requests require POST"
                )
            data = urllib.parse.urlencode(fields, doseq=True).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif network_request.body_mode == "json_form":
            if files:
                raise EngineSecurityError(
                    "JSON form request cannot include uploaded files"
                )
            if method != "POST":
                raise EngineSecurityError(
                    "JSON form requests require POST"
                )
            payload = {name: value for name, value in fields}
            data = json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif network_request.body_mode != "none":
            raise EngineSecurityError(
                f"Unsupported script body mode: {network_request.body_mode}"
            )

        req = urllib.request.Request(
            target,
            data=data,
            method=method,
            headers=headers,
        )

        response = None
        try:
            response = self.opener.open(req, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            response = exc
        except EngineSecurityError:
            raise
        except Exception as exc:
            raise EngineError(
                f"Script network request failed: {type(exc).__name__}: {exc}"
            ) from exc

        try:
            final_url = response.geturl()
            self.assert_allowed(final_url)
            content_type = (
                response.headers.get("Content-Type") or ""
            ).lower()
            if content_type and not (
                "application/json" in content_type
                or "+json" in content_type
                or "text/plain" in content_type
                or "text/html" in content_type
            ):
                raise EngineSecurityError(
                    f"Script network response type is not allowed: {content_type}"
                )
            raw = response.read(min(self.max_response_bytes, 1024 * 1024) + 1)
            if len(raw) > min(self.max_response_bytes, 1024 * 1024):
                raise EngineError("Script network response is too large")
            text = self._decode(raw, response.headers)
            response_headers = {
                key.lower(): value
                for key, value in response.headers.items()
            }
            return NetworkResponse(
                status=int(getattr(response, "status", response.getcode())),
                url=final_url,
                text=text,
                headers=response_headers,
            )
        finally:
            try:
                response.close()
            except Exception:
                pass

    def submit(
        self,
        page: PageState,
        form: FormState,
        submit_control: ControlState | None = None,
    ) -> PageState:
        if self.read_only:
            raise EngineSecurityError(
                "Read-only Jupiter engine blocked form submission"
            )
        if self.script_runtime is not None and form.id:
            event_result = self.script_runtime.handle_event(
                form.id,
                "submit",
                network_fetch=lambda request: self._script_network_fetch(
                    page,
                    form,
                    request,
                ),
            )
            if event_result is not None:
                html_after, prevented, diagnostics = event_result
                if prevented:
                    self.last_submit_mode = (
                        "script_network"
                        if any(
                            item.kind == "network_response"
                            for item in diagnostics
                        )
                        else "script"
                    )
                    return self._parse_runtime_dom(
                        url=page.url,
                        status=page.status,
                        headers=page.headers,
                        html_text=html_after,
                    )

        self.last_submit_mode = "http"
        # Кнопка отправки главнее формы: formaction/formmethod/formenctype
        # перебивают её атрибуты. Иначе «откликнуться» уходит туда же, куда
        # «сохранить черновик».
        action = (submit_control.formaction if submit_control else "") or form.action
        target = page.resolve(action or page.url)
        self.assert_allowed(target)

        parsed = urllib.parse.urlparse(target)
        if parsed.scheme not in {"http", "https"}:
            raise EngineSecurityError("Form action uses an unsupported scheme")

        fields, files = self._successful_controls(page, form, submit_control)
        method = (
            (submit_control.formmethod if submit_control else "")
            or form.method
            or "get"
        ).upper()
        enctype = (
            (submit_control.formenctype if submit_control else "")
            or form.enctype
        )

        if method == "GET":
            if files:
                raise EngineError("GET form cannot upload files")
            query = urllib.parse.urlencode(fields, doseq=True)
            parts = list(urllib.parse.urlsplit(target))
            parts[3] = "&".join(filter(None, [parts[3], query]))
            return self.request(urllib.parse.urlunsplit(parts))

        if method != "POST":
            raise EngineError(f"Unsupported form method: {method}")

        if files or "multipart/form-data" in enctype:
            body, content_type = self._multipart(fields, files)
        else:
            body = urllib.parse.urlencode(fields, doseq=True).encode("utf-8")
            content_type = "application/x-www-form-urlencoded"

        return self.request(
            target,
            method="POST",
            data=body,
            headers={"Content-Type": content_type},
        )

    def export_cookies(self) -> list[dict[str, str]]:
        """Куки в простом виде — чтобы пережить паузу на действие человека."""
        return [
            {
                "name": cookie.name,
                "value": cookie.value or "",
                "domain": cookie.domain,
                "path": cookie.path,
            }
            for cookie in self.cookies
        ]

    def import_cookies(self, items: list[dict[str, str]]) -> None:
        for item in items or []:
            name = str(item.get("name") or "")
            if not name:
                continue
            self.cookies.set_cookie(http.cookiejar.Cookie(
                version=0,
                name=name,
                value=str(item.get("value") or ""),
                port=None,
                port_specified=False,
                domain=str(item.get("domain") or ""),
                domain_specified=bool(item.get("domain")),
                domain_initial_dot=str(item.get("domain") or "").startswith("."),
                path=str(item.get("path") or "/"),
                path_specified=True,
                secure=False,
                # Сессионная кука: истекает вместе с процессом, на диске
                # дольше нужного не живёт.
                expires=None,
                discard=True,
                comment=None,
                comment_url=None,
                rest={},
            ))

    def semantic_snapshot(self) -> dict:
        if not self.page:
            return {"script_history": list(self.script_history)}
        snapshot = self.page.snapshot()
        snapshot["script_history"] = list(self.script_history)
        return snapshot


def snapshot_json(page: PageState) -> str:
    return json.dumps(page.snapshot(), ensure_ascii=False, indent=2)


def html_escape_snapshot(page: PageState) -> str:
    return html.escape(snapshot_json(page))
