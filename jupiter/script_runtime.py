#!/usr/bin/env python3
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Callable

from network_runtime import (
    NetworkProgramError,
    NetworkRequest,
    NetworkResponse,
    contains_network_api,
    execute_network_program,
)


BACKTICK = chr(96)


class ScriptRuntimeError(RuntimeError):
    pass


@dataclass
class ScriptDiagnostic:
    kind: str
    detail: str

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "detail": self.detail}


@dataclass
class _Node:
    tag: str | None = None
    text: str = ""
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["_Node"] = field(default_factory=list)
    parent: "_Node | None" = None

    @property
    def is_text(self) -> bool:
        return self.tag is None

    def append(self, child: "_Node") -> None:
        child.parent = self
        self.children.append(child)

    def find_id(self, node_id: str) -> "_Node | None":
        if self.tag is not None and self.attrs.get("id") == node_id:
            return self
        for child in self.children:
            found = child.find_id(node_id)
            if found is not None:
                return found
        return None

    def set_text_content(self, value: str) -> None:
        self.children = []
        self.append(_Node(text=value))

    def set_inner_html(self, fragment: str) -> None:
        parser = _DomParser()
        parser.feed(fragment)
        parser.close()
        self.children = parser.root.children
        for child in self.children:
            child.parent = self

    def append_html(self, fragment: str) -> None:
        parser = _DomParser()
        parser.feed(fragment)
        parser.close()
        for child in parser.root.children:
            self.append(child)

    def serialize(self) -> str:
        if self.is_text:
            return html.escape(self.text, quote=False)
        if self.tag == "__root__":
            return "".join(child.serialize() for child in self.children)

        attrs = "".join(
            f" {name}"
            if value == ""
            else f' {name}="{html.escape(value, quote=True)}"'
            for name, value in self.attrs.items()
        )
        if self.tag in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            return f"<{self.tag}{attrs}>"

        return (
            f"<{self.tag}{attrs}>"
            + "".join(child.serialize() for child in self.children)
            + f"</{self.tag}>"
        )


class _DomParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node(tag="__root__")
        self.stack: list[_Node] = [self.root]

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {name.lower(): (value or "") for name, value in attrs}

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        tag = tag.lower()
        node = _Node(tag=tag, attrs=self._attrs(attrs))
        self.stack[-1].append(node)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append(node)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        self.stack[-1].append(
            _Node(tag=tag.lower(), attrs=self._attrs(attrs))
        )

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].append(_Node(text=data))


@dataclass
class _Handler:
    target_id: str
    event: str
    body: str
    event_var: str


@dataclass
class ScriptRunResult:
    html: str
    diagnostics: list[ScriptDiagnostic]
    unsupported: bool

    def diagnostic_dicts(self) -> list[dict[str, str]]:
        return [item.as_dict() for item in self.diagnostics]


_STRING_RE = r"""(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\x60(?:\\.|[^\x60\\])*\x60)"""

_TARGET_EXPR_RE = r"""(?:[A-Za-z_$][\w$]*|this|document\.getElementById\(\s*["'][^"']+["']\s*\)|document\.querySelector\(\s*["'][^"']+["']\s*\))"""


class JupiterScriptRuntime:
    """
    Deterministic JobToo-owned DOM scripting subset.

    It intentionally is not a general JavaScript VM. It executes only explicit
    DOM mutations and submit listeners that Jupiter understands. Supported
    fetch/XHR is delegated to Jupiter Network Runtime; arbitrary code
    evaluation, timers, navigation and external bundles are never executed.
    """

    FORBIDDEN_TOKENS = (
        "eval(",
        "newfunction",
        "settimeout(",
        "setinterval(",
        "websocket",
        "navigator.",
        "localstorage",
        "sessionstorage",
        "window.location",
        "document.cookie",
        "import(",
    )

    def __init__(self, html_text: str):
        parser = _DomParser()
        parser.feed(html_text)
        parser.close()

        self.root = parser.root
        self.original_html = html_text
        self.bindings: dict[str, str] = {}
        self.handlers: list[_Handler] = []
        self.diagnostics: list[ScriptDiagnostic] = []
        self.unsupported = False
        self._scripts = self._extract_scripts(html_text)

    @staticmethod
    def _extract_scripts(html_text: str) -> list[tuple[str, bool]]:
        scripts: list[tuple[str, bool]] = []
        for match in re.finditer(
            r"<script\b([^>]*)>(.*?)</script\s*>",
            html_text,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            attrs = match.group(1) or ""
            body = match.group(2) or ""
            external = bool(
                re.search(r"\bsrc\s*=", attrs, flags=re.IGNORECASE)
            )
            scripts.append((body, external))
        return scripts

    @staticmethod
    def _decode_string(token: str) -> str:
        token = token.strip()
        if len(token) < 2:
            raise ScriptRuntimeError("invalid string literal")

        quote = token[0]
        if quote not in {"'", '"', BACKTICK} or token[-1] != quote:
            raise ScriptRuntimeError("invalid string literal")

        body = token[1:-1]
        body = body.replace(r"\n", "\n")
        body = body.replace(r"\r", "\r")
        body = body.replace(r"\t", "\t")
        body = body.replace(r"\\", "\\")
        body = body.replace(r"\'", "'")
        body = body.replace(r'\"', '"')
        body = body.replace("\\" + BACKTICK, BACKTICK)
        return body

    def _target_id(self, expr: str, this_id: str | None = None) -> str | None:
        expr = expr.strip()

        direct = re.fullmatch(
            r"""document\.getElementById\(\s*["']([^"']+)["']\s*\)""",
            expr,
        )
        if direct:
            return direct.group(1)

        query = re.fullmatch(
            r"""document\.querySelector\(\s*["'](#[^"']+)["']\s*\)""",
            expr,
        )
        if query:
            return query.group(1)[1:]

        if expr == "this":
            return this_id

        if re.fullmatch(r"[A-Za-z_$][\w$]*", expr):
            return self.bindings.get(expr)

        return None

    def _forbidden(self, source: str) -> list[str]:
        compact = re.sub(r"\s+", "", source.lower())
        return [
            token
            for token in self.FORBIDDEN_TOKENS
            if token in compact
        ]

    def _bind_nodes(self, source: str) -> int:
        count = 0
        pattern = re.compile(
            r"""\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document\.getElementById\(\s*["']([^"']+)["']\s*\)|document\.querySelector\(\s*["'](#[^"']+)["']\s*\))\s*;?""",
            flags=re.DOTALL,
        )
        for match in pattern.finditer(source):
            name = match.group(1)
            node_id = match.group(2) or (match.group(3) or "")[1:]
            if not node_id:
                continue
            self.bindings[name] = node_id
            count += 1
            self.diagnostics.append(
                ScriptDiagnostic("bind", f"{name} -> #{node_id}")
            )
        return count

    @staticmethod
    def _listener_blocks(
        source: str,
    ) -> list[tuple[str, str, str, str]]:
        pattern = re.compile(
            rf"""(?P<target>{_TARGET_EXPR_RE})\.addEventListener\(\s*["'](?P<event>[^"']+)["']\s*,""",
            flags=re.DOTALL,
        )
        found: list[tuple[str, str, str, str]] = []

        for match in pattern.finditer(source):
            cursor = match.end()
            tail = source[cursor:]
            callback = re.match(
                r"""\s*(?:async\s+)?(?:function\s*\(\s*([A-Za-z_$][\w$]*)?\s*\)|\(?\s*([A-Za-z_$][\w$]*)?\s*\)?\s*=>)\s*\{""",
                tail,
                flags=re.DOTALL,
            )
            if not callback:
                continue

            event_var = callback.group(1) or callback.group(2) or "event"
            body_start = cursor + callback.end()
            depth = 1
            quote: str | None = None
            escaped = False
            index = body_start

            while index < len(source):
                char = source[index]

                if quote is not None:
                    if escaped:
                        escaped = False
                    elif char == "\\":
                        escaped = True
                    elif char == quote:
                        quote = None
                    index += 1
                    continue

                if char in {"'", '"', BACKTICK}:
                    quote = char
                    index += 1
                    continue

                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        found.append(
                            (
                                match.group("target"),
                                match.group("event").lower(),
                                event_var,
                                source[body_start:index],
                            )
                        )
                        break

                index += 1

        return found

    def _register_handlers(self, source: str) -> int:
        count = 0
        for target_expr, event, event_var, body in self._listener_blocks(source):
            target_id = self._target_id(target_expr)
            if not target_id:
                continue

            self.handlers.append(
                _Handler(
                    target_id=target_id,
                    event=event,
                    body=body,
                    event_var=event_var,
                )
            )
            count += 1
            self.diagnostics.append(
                ScriptDiagnostic("listener", f"#{target_id}:{event}")
            )
        return count

    def _apply_assignment(
        self,
        target_expr: str,
        prop: str,
        raw_value: str,
        *,
        this_id: str | None = None,
    ) -> bool:
        target_id = self._target_id(target_expr, this_id)
        if not target_id:
            return False

        node = self.root.find_id(target_id)
        if node is None:
            return False

        raw_value = raw_value.strip()
        if raw_value == "true":
            value: Any = True
        elif raw_value == "false":
            value = False
        else:
            value = self._decode_string(raw_value)

        if prop == "innerHTML" and isinstance(value, str):
            node.set_inner_html(value)
        elif prop in {"textContent", "innerText"} and isinstance(value, str):
            node.set_text_content(value)
        elif prop == "value" and isinstance(value, str):
            node.attrs["value"] = value
        elif prop == "hidden" and isinstance(value, bool):
            if value:
                node.attrs["hidden"] = ""
            else:
                node.attrs.pop("hidden", None)
        else:
            return False

        self.diagnostics.append(
            ScriptDiagnostic("dom_mutation", f"#{target_id}.{prop}")
        )
        return True

    def _execute_dom(
        self,
        source: str,
        *,
        this_id: str | None = None,
        event_var: str | None = None,
    ) -> tuple[int, bool]:
        mutations = 0
        prevented = False

        if event_var and re.search(
            rf"\b{re.escape(event_var)}\.preventDefault\(\s*\)",
            source,
        ):
            prevented = True
            self.diagnostics.append(
                ScriptDiagnostic("event", "preventDefault")
            )

        assignment = re.compile(
            rf"""(?P<target>{_TARGET_EXPR_RE})\s*\.\s*(?P<prop>innerHTML|textContent|innerText|value|hidden)\s*=\s*(?P<value>{_STRING_RE}|true|false)\s*;?""",
            flags=re.DOTALL,
        )
        for match in assignment.finditer(source):
            if self._apply_assignment(
                match.group("target"),
                match.group("prop"),
                match.group("value"),
                this_id=this_id,
            ):
                mutations += 1

        insert = re.compile(
            rf"""(?P<target>{_TARGET_EXPR_RE})\.insertAdjacentHTML\(\s*["']beforeend["']\s*,\s*(?P<value>{_STRING_RE})\s*\)\s*;?""",
            flags=re.DOTALL | re.IGNORECASE,
        )
        for match in insert.finditer(source):
            target_id = self._target_id(match.group("target"), this_id)
            node = self.root.find_id(target_id) if target_id else None
            if node is None:
                continue
            node.append_html(
                self._decode_string(match.group("value"))
            )
            mutations += 1
            self.diagnostics.append(
                ScriptDiagnostic(
                    "dom_mutation",
                    f"#{target_id}.insertAdjacentHTML",
                )
            )

        attributes = re.compile(
            rf"""(?P<target>{_TARGET_EXPR_RE})\.(?P<op>setAttribute|removeAttribute)\(\s*["'](?P<name>[^"']+)["'](?:\s*,\s*(?P<value>{_STRING_RE}))?\s*\)\s*;?""",
            flags=re.DOTALL,
        )
        for match in attributes.finditer(source):
            target_id = self._target_id(match.group("target"), this_id)
            node = self.root.find_id(target_id) if target_id else None
            if node is None:
                continue

            name = match.group("name")
            if match.group("op") == "removeAttribute":
                node.attrs.pop(name, None)
            else:
                raw = match.group("value")
                node.attrs[name] = (
                    self._decode_string(raw)
                    if raw is not None
                    else ""
                )

            mutations += 1
            self.diagnostics.append(
                ScriptDiagnostic(
                    "dom_mutation",
                    f"#{target_id}.{match.group('op')}({name})",
                )
            )

        return mutations, prevented

    def bootstrap(self) -> ScriptRunResult:
        for source, external in self._scripts:
            if external:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        "external script src",
                    )
                )
                continue

            if not source.strip():
                continue

            forbidden = self._forbidden(source)
            if forbidden:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        "forbidden API: "
                        + ", ".join(sorted(set(forbidden))),
                    )
                )
                continue

            bindings = self._bind_nodes(source)
            listeners = self._register_handlers(source)
            listener_start = source.find(".addEventListener")
            bootstrap_source = (
                source
                if listener_start < 0
                else source[:listener_start]
            )
            mutations, _ = self._execute_dom(bootstrap_source)

            if mutations:
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "bootstrap",
                        "safe DOM mutations applied",
                    )
                )

            if not bindings and not listeners and not mutations:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        "script is outside Jupiter subset",
                    )
                )

        return ScriptRunResult(
            html=self.root.serialize(),
            diagnostics=list(self.diagnostics),
            unsupported=self.unsupported,
        )

    def handle_event(
        self,
        target_id: str,
        event: str,
        network_fetch: Callable[[NetworkRequest], NetworkResponse] | None = None,
    ) -> tuple[str, bool, list[ScriptDiagnostic]] | None:
        matching = [
            handler
            for handler in self.handlers
            if handler.target_id == target_id
            and handler.event == event.lower()
        ]
        if not matching:
            return None

        prevented = False
        for handler in matching:
            forbidden = self._forbidden(handler.body)
            if forbidden:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        "event handler uses forbidden API: "
                        + ", ".join(sorted(set(forbidden))),
                    )
                )
                continue

            handler_prevented = bool(
                re.search(
                    rf"\b{re.escape(handler.event_var)}\.preventDefault\(\s*\)",
                    handler.body,
                )
            )

            if contains_network_api(handler.body):
                if network_fetch is None:
                    self.unsupported = True
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "unsupported",
                            "network capability is unavailable",
                        )
                    )
                    prevented = prevented or handler_prevented
                    continue

                def resolved_fetch(request: NetworkRequest) -> NetworkResponse:
                    if request.form_ref:
                        request.form_ref = self.bindings.get(
                            request.form_ref,
                            request.form_ref,
                        )
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "network_request",
                            f"{request.api}:{request.method} {request.url}",
                        )
                    )
                    response = network_fetch(request)
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "network_response",
                            f"{request.api}:{response.status} {response.url}",
                        )
                    )
                    return response

                try:
                    execution = execute_network_program(
                        handler.body,
                        resolved_fetch,
                    )
                except NetworkProgramError as exc:
                    self.unsupported = True
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "unsupported",
                            f"network runtime: {exc}",
                        )
                    )
                    prevented = prevented or handler_prevented
                    continue

                mutations = 0
                if execution is not None and execution.dom_source:
                    mutations, _ = self._execute_dom(
                        execution.dom_source,
                        this_id=target_id,
                    )
                if handler_prevented:
                    self.diagnostics.append(
                        ScriptDiagnostic("event", "preventDefault")
                    )
                prevented = prevented or handler_prevented

                if execution is None:
                    self.unsupported = True
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "unsupported",
                            f"network program not understood in #{target_id}:{event}",
                        )
                    )
                elif not mutations and execution.response.ok:
                    self.diagnostics.append(
                        ScriptDiagnostic(
                            "network",
                            "request completed without DOM mutation",
                        )
                    )
                continue

            mutations, did_prevent = self._execute_dom(
                handler.body,
                this_id=target_id,
                event_var=handler.event_var,
            )
            prevented = prevented or did_prevent

            if not mutations and not did_prevent:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        f"no supported operations in #{target_id}:{event}",
                    )
                )

        return (
            self.root.serialize(),
            prevented,
            list(self.diagnostics),
        )

