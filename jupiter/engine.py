#!/usr/bin/env python3
from __future__ import annotations

import html
import http.cookiejar
import json
import mimetypes
import secrets
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable

from script_runtime import JupiterScriptRuntime


class EngineError(RuntimeError):
    pass


class EngineSecurityError(EngineError):
    pass


@dataclass
class OptionState:
    label: str
    value: str
    selected: bool = False


@dataclass
class ControlState:
    index: int
    form_index: int | None
    tag: str
    type: str = ""
    name: str = ""
    id: str = ""
    placeholder: str = ""
    aria: str = ""
    label: str = ""
    text: str = ""
    required: bool = False
    disabled: bool = False
    value: str = ""
    checked: bool = False
    accept: str = ""
    options: list[OptionState] = field(default_factory=list)
    file_path: str | None = None


@dataclass
class FormState:
    index: int
    method: str
    action: str
    enctype: str
    id: str = ""
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

    def snapshot(self) -> dict:
        return {
            "url": self.url,
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
                    "label": c.label,
                    "placeholder": c.placeholder,
                    "aria": c.aria,
                    "text": c.text,
                    "required": c.required,
                    "disabled": c.disabled,
                    "value": c.value if c.type != "file" else "",
                    "checked": c.checked,
                    "accept": c.accept,
                    "options": [
                        {"label": o.label, "value": o.value, "selected": o.selected}
                        for o in c.options
                    ],
                    "file_attached": bool(c.file_path),
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
        c = ControlState(
            index=len(self.controls),
            form_index=self.current_form,
            tag=tag,
            type=ctype,
            name=attrs.get("name", ""),
            id=attrs.get("id", ""),
            placeholder=attrs.get("placeholder", ""),
            aria=attrs.get("aria-label", ""),
            required="required" in attrs,
            disabled="disabled" in attrs,
            value=value,
            checked="checked" in attrs,
            accept=attrs.get("accept", ""),
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

        if tag == "form":
            self.form_stack.append(self.current_form)
            form = FormState(
                index=len(self.forms),
                method=(attrs.get("method", "get") or "get").lower(),
                action=attrs.get("action", ""),
                enctype=(attrs.get("enctype", "application/x-www-form-urlencoded")
                         or "application/x-www-form-urlencoded").lower(),
                id=attrs.get("id", ""),
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
                )
            )
            self.current_option = None

        if tag == "select" and self.current_select is not None:
            control = self.controls[self.current_select]
            selected = next((o for o in control.options if o.selected), None)
            if selected is None and control.options:
                selected = control.options[0]
            if selected is not None:
                control.value = selected.value
            self.current_select = None

        if tag == "textarea":
            self.current_textarea = None

        if tag == "button":
            self.current_button = None

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

        if self.label_stack:
            self.label_stack[-1]["parts"].append(data)

        if not self.hidden:
            clean = " ".join(data.split())
            if clean:
                self.text_parts.append(clean)

    def finish(self, html_text: str, status: int, headers: dict[str, str]) -> PageState:
        title = " ".join("".join(self.title_parts).split())
        body_text = " ".join(self.text_parts)
        for c in self.controls:
            c.text = " ".join(c.text.split())
            c.label = " ".join(c.label.split())
            if c.tag == "textarea":
                c.value = c.value.strip()
        return PageState(
            url=self.url,
            status=status,
            headers=headers,
            html=html_text,
            title=title,
            text=body_text,
            controls=self.controls,
            forms=self.forms,
            has_script=self.has_script,
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

    def __init__(
        self,
        allowed_hosts: set[str],
        *,
        timeout: float = 20.0,
        max_response_bytes: int = 5 * 1024 * 1024,
    ):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.timeout = timeout
        self.max_response_bytes = max_response_bytes
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies),
            _SafeRedirectHandler(self.assert_allowed),
        )
        self.page: PageState | None = None
        self.script_runtime: JupiterScriptRuntime | None = None
        self.script_history: list[dict[str, str]] = []
        self.last_submit_mode = "none"

    def assert_allowed(self, url: str) -> None:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise EngineSecurityError(f"Scheme '{parsed.scheme}' is not allowed")
        if parsed.username or parsed.password:
            raise EngineSecurityError("Credentials in URL are not allowed")
        host = (parsed.hostname or "").lower()
        if host not in self.allowed_hosts:
            raise EngineSecurityError(f"Host '{host}' is not allowed for this Jupiter run")

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

    def _parse(
        self,
        *,
        url: str,
        status: int,
        headers: dict[str, str],
        html_text: str,
    ) -> PageState:
        runtime = JupiterScriptRuntime(html_text)
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
        self.assert_allowed(url)
        request_headers = {
            "User-Agent": "JupiterWebEngine/1.0 (+JobToo)",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        }
        request_headers.update(headers or {})
        req = urllib.request.Request(
            url,
            data=data,
            method=method.upper(),
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
        except Exception as exc:
            raise EngineError(f"HTTP request failed: {type(exc).__name__}: {exc}") from exc

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
                if control.file_path:
                    files.append((control.name, Path(control.file_path)))
                continue
            fields.append((control.name, control.value))

        if submit_control and submit_control.name and submit_control.type in {"submit", "image"}:
            if (submit_control.name, submit_control.value) not in fields:
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

    def submit(
        self,
        page: PageState,
        form: FormState,
        submit_control: ControlState | None = None,
    ) -> PageState:
        if self.script_runtime is not None and form.id:
            event_result = self.script_runtime.handle_event(form.id, "submit")
            if event_result is not None:
                html_after, prevented, _diagnostics = event_result
                if prevented:
                    self.last_submit_mode = "script"
                    return self._parse_runtime_dom(
                        url=page.url,
                        status=page.status,
                        headers=page.headers,
                        html_text=html_after,
                    )

        self.last_submit_mode = "http"
        target = urllib.parse.urljoin(page.url, form.action or page.url)
        self.assert_allowed(target)

        parsed = urllib.parse.urlparse(target)
        if parsed.scheme not in {"http", "https"}:
            raise EngineSecurityError("Form action uses an unsupported scheme")

        fields, files = self._successful_controls(page, form, submit_control)
        method = (form.method or "get").upper()

        if method == "GET":
            if files:
                raise EngineError("GET form cannot upload files")
            query = urllib.parse.urlencode(fields, doseq=True)
            parts = list(urllib.parse.urlsplit(target))
            parts[3] = "&".join(filter(None, [parts[3], query]))
            return self.request(urllib.parse.urlunsplit(parts))

        if method != "POST":
            raise EngineError(f"Unsupported form method: {method}")

        if files or "multipart/form-data" in form.enctype:
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
