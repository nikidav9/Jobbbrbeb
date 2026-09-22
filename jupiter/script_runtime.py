#!/usr/bin/env python3
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any


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

    def find_first_tag(self, tag: str) -> "_Node | None":
        if self.tag == tag:
            return self
        for child in self.children:
            found = child.find_first_tag(tag)
            if found is not None:
                return found
        return None

    def text_content(self) -> str:
        if self.is_text:
            return self.text
        return "".join(child.text_content() for child in self.children)

    def set_text_content(self, value: str) -> None:
        self.children = []
        self.append(_Node(text=value))

    def set_inner_html(self, fragment: str) -> None:
        parser = _DomParser(fragment=True)
        parser.feed(fragment)
        parser.close()
        self.children = parser.root.children
        for child in self.children:
            child.parent = self

    def append_html(self, fragment: str) -> None:
        parser = _DomParser(fragment=True)
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
            f' {name}' if value == "" else f' {name}="{html.escape(value, quote=True)}"'
            for name, value in self.attrs.items()
        )
        if self.tag in {
            "area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr",
        }:
            return f"<{self.tag}{attrs}>"
        return (
            f"<{self.tag}{attrs}>"
            + "".join(child.serialize() for child in self.children)
            + f"</{self.tag}>"
        )


class _DomParser(HTMLParser):
    def __init__(self, *, fragment: bool = False):
        super().__init__(convert_charrefs=True)
        self.root = _Node(tag="__root__")
        self.stack: list[_Node] = [self.root]
        self.fragment = fragment

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {k.lower(): (v or "") for k, v in attrs}

    def handle_decl(self, decl: str) -> None:
        if not self.fragment:
            self.stack[-1].append(_Node(text=f"<!{decl}>"))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag=tag.lower(), attrs=self._attrs(attrs))
        self.stack[-1].append(node)
        if tag.lower() not in {
            "area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr",
        }:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag=tag.lower(), attrs=self._attrs(attrs))
        self.stack[-1].append(node)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].append(_Node(text=data))

    def handle_entityref(self, name: str) -> None:
        self.stack[-1].append(_Node(text=html.unescape(f"&{name};")))

    def handle_charref(self, name: str) -> None:
        self.stack[-1].append(_Node(text=html.unescape(f"&#{name};")))


@dataclass
class _Handler:
    target_id: str
    event: str
    body: str
    event_var: str = "event"


@dataclass
class ScriptRunResult:
    html: str
    diagnostics: list[ScriptDiagnostic]
    handlers: list[_Handler]
    unsupported: bool

    def diagnostic_dicts(self) -> list[dict[str, str]]:
        return [item.as_dict() for item in self.diagnostics]


_STRING_RE = r"(?:'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|\`(?:\\.|[^\`\\])*\`)"


class JupiterScriptRuntime:
    """
    Deliberately small, deterministic DOM scripting runtime.

    This is not a general JavaScript VM. It supports a constrained subset that
    is common in simple job application pages and test harnesses:
      - document.getElementById / document.querySelector("#id")
      - const/let/var bindings to those DOM nodes
      - innerHTML / textContent / value / hidden assignments
      - insertAdjacentHTML("beforeend", ...)
      - setAttribute/removeAttribute for non-network DOM mutation
      - addEventListener("submit", callback)
      - event.preventDefault()

    Anything outside the subset is recorded as unsupported. No eval, Function,
    imports, timers, window navigation, fetch/XHR, WebSocket or storage APIs are
    executed here.
    """

    FORBIDDEN_TOKENS = (
        "eval(",
        "new function",
        "function(",
        "settimeout(",
        "setinterval(",
        "fetch(",
        "xmlhttprequest",
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
        self._scripts = self._extract_inline_scripts(html_text)

    @staticmethod
    def _extract_inline_scripts(html_text: str) -> list[str]:
        scripts: list[str] = []
        for match in re.finditer(
            r"<script\b([^>]*)>(.*?)</script\s*>",
            html_text,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            attrs = match.group(1) or ""
            body = match.group(2) or ""
            if re.search(r"\bsrc\s*=", attrs, flags=re.IGNORECASE):
                scripts.append("__EXTERNAL_SCRIPT__")
            else:
                scripts.append(body)
        return scripts

    @staticmethod
    def _decode_string(token: str) -> str:
        token = token.strip()
        if len(token) < 2:
            raise ScriptRuntimeError("invalid string literal")
        quote = token[0]
        if quote not in {"'", '"', "`"} or token[-1] != quote:
            raise ScriptRuntimeError("invalid string literal")
        body = token[1:-1]
        body = re.sub(r"\\n", "\n", body)
        body = re.sub(r"\\r", "\r", body)
        body = re.sub(r"\\t", "\t", body)
        body = body.replace("\\'", "'").replace('\\"', '"').replace("\\`", "`")
        body = body.replace("\\\\", "\\")
        return body

    def _node_for_selector(self, selector: str) -> _Node | None:
        selector = selector.strip()
        if selector.startswith("#"):
            return self.root.find_id(selector[1:])
        return None

    def _target_id_from_expr(self, expr: str) -> str | None:
        expr = expr.strip()
        direct = re.fullmatch(
            r"document\.getElementById\(\s*(['\"])([^'\"]+)\1\s*\)",
            expr,
        )
        if direct:
            return direct.group(2)
        query = re.fullmatch(
            r"document\.querySelector\(\s*(['\"])(#[^'\"]+)\1\s*\)",
            expr,
        )
        if query:
            return query.group(2)[1:]
        if re.fullmatch(r"[A-Za-z_$][\w$]*", expr):
            return self.bindings.get(expr)
        if expr == "this":
            return "__this__"
        return None

    def _bind_nodes(self, source: str) -> None:
        pattern = re.compile(
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
            r"(document\.getElementById\(\s*(['\"])([^'\"]+)\2\s*\)"
            r"|document\.querySelector\(\s*(['\"])(#[^'\"]+)\4\s*\))\s*;?",
            flags=re.DOTALL,
        )
        for match in pattern.finditer(source):
            name = match.group(1)
            node_id = match.group(3) or (match.group(5) or "")[1:]
            if node_id:
                self.bindings[name] = node_id
                self.diagnostics.append(
                    ScriptDiagnostic("bind", f"{name} -> #{node_id}")
                )

    @staticmethod
    def _iter_listener_blocks(source: str) -> list[tuple[str, str, str, str]]:
        out: list[tuple[str, str, str, str]] = []
        pattern = re.compile(
            r"(?P<target>"
            r"[A-Za-z_$][\w$]*"
            r"|document\.getElementById\(\s*(['\"])[^'\"]+\2\s*\)"
            r"|document\.querySelector\(\s*(['\"])[^'\"]+\3\s*\)"
            r")\.addEventListener\(\s*(['\"])(?P<event>[^'\"]+)\4\s*,",
            flags=re.DOTALL,
        )
        for match in pattern.finditer(source):
            cursor = match.end()
            tail = source[cursor:]
            callback = re.match(
                r"\s*(?:function\s*\(\s*([A-Za-z_$][\w$]*)?\s*\)"
                r"|\(?\s*([A-Za-z_$][\w$]*)?\s*\)?\s*=>)\s*\{",
                tail,
                flags=re.DOTALL,
            )
            if not callback:
                continue
            event_var = callback.group(1) or callback.group(2) or "event"
            body_start = cursor + callback.end()
            depth = 1
            i = body_start
            quote: str | None = None
            escaped = False
            while i < len(source):
                ch = source[i]
                if quote is not None:
                    if escaped:
                        escaped = False
                    elif ch == "\\":
                        escaped = True
                    elif ch == quote:
                        quote = None
                    i += 1
                    continue
                if ch in {"'", '"', "`"}:
                    quote = ch
                    i += 1
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        body = source[body_start:i]
                        out.append(
                            (
                                match.group("target"),
                                match.group("event"),
                                event_var,
                                body,
                            )
                        )
                        break
                i += 1
        return out

    def _register_handlers(self, source: str) -> None:
        for target_expr, event, event_var, body in self._iter_listener_blocks(source):
            target_id = self._target_id_from_expr(target_expr)
            if not target_id or target_id == "__this__":
                continue
            self.handlers.append(
                _Handler(
                    target_id=target_id,
                    event=event.lower(),
                    body=body,
                    event_var=event_var,
                )
            )
            self.diagnostics.append(
                ScriptDiagnostic("listener", f"#{target_id}:{event.lower()}")
            )

    def _apply_assignment(self, target_expr: str, prop: str, raw_value: str, *, this_id: str | None = None) -> bool:
        target_id = self._target_id_from_expr(target_expr)
        if target_id == "__this__":
            target_id = this_id
        if not target_id:
            return False
        node = self.root.find_id(target_id)
        if node is None:
            return False

        prop = prop.strip()
        raw_value = raw_value.strip()
        if raw_value in {"true", "false"}:
            value: Any = raw_value == "true"
        elif raw_value.startswith(("'", '"', "`")):
            value = self._decode_string(raw_value)
        else:
            return False

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

    def _execute_dom_statements(self, source: str, *, this_id: str | None = None, event_var: str | None = None) -> tuple[bool, bool]:
        changed = False
        prevented = False

        if event_var:
            if re.search(
                rf"\b{re.escape(event_var)}\.preventDefault\(\s*\)",
                source,
            ):
                prevented = True
                self.diagnostics.append(
                    ScriptDiagnostic("event", "preventDefault")
                )

        assign = re.compile(
            rf"(?P<target>"
            r"[A-Za-z_$][\w$]*"
            r"|this"
            r"|document\.getElementById\(\s*(['\"])[^'\"]+\2\s*\)"
            r"|document\.querySelector\(\s*(['\"])[^'\"]+\3\s*\)"
            r")\s*\.\s*(?P<prop>innerHTML|textContent|innerText|value|hidden)"
            rf"\s*=\s*(?P<value>{_STRING_RE}|true|false)\s*;?",
            flags=re.DOTALL,
        )
        for match in assign.finditer(source):
            changed = (
                self._apply_assignment(
                    match.group("target"),
                    match.group("prop"),
                    match.group("value"),
                    this_id=this_id,
                )
                or changed
            )

        insert = re.compile(
            rf"(?P<target>"
            r"[A-Za-z_$][\w$]*"
            r"|this"
            r"|document\.getElementById\(\s*(['\"])[^'\"]+\2\s*\)"
            r"|document\.querySelector\(\s*(['\"])[^'\"]+\3\s*\)"
            rf")\.insertAdjacentHTML\(\s*(['\"])beforeend\4\s*,\s*(?P<value>{_STRING_RE})\s*\)\s*;?",
            flags=re.DOTALL | re.IGNORECASE,
        )
        for match in insert.finditer(source):
            target_id = self._target_id_from_expr(match.group("target"))
            if target_id == "__this__":
                target_id = this_id
            if not target_id:
                continue
            node = self.root.find_id(target_id)
            if node is None:
                continue
            node.append_html(self._decode_string(match.group("value")))
            changed = True
            self.diagnostics.append(
                ScriptDiagnostic("dom_mutation", f"#{target_id}.insertAdjacentHTML")
            )

        attr = re.compile(
            r"(?P<target>"
            r"[A-Za-z_$][\w$]*"
            r"|this"
            r"|document\.getElementById\(\s*(['\"])[^'\"]+\2\s*\)"
            r"|document\.querySelector\(\s*(['\"])[^'\"]+\3\s*\)"
            r")\.(?P<op>setAttribute|removeAttribute)\(\s*(['\"])(?P<name>[^'\"]+)\4"
            rf"(?:\s*,\s*(?P<value>{_STRING_RE}))?\s*\)\s*;?",
            flags=re.DOTALL,
        )
        for match in attr.finditer(source):
            target_id = self._target_id_from_expr(match.group("target"))
            if target_id == "__this__":
                target_id = this_id
            if not target_id:
                continue
            node = self.root.find_id(target_id)
            if node is None:
                continue
            name = match.group("name")
            if match.group("op") == "removeAttribute":
                node.attrs.pop(name, None)
            else:
                raw = match.group("value")
                node.attrs[name] = self._decode_string(raw) if raw else ""
            changed = True
            self.diagnostics.append(
                ScriptDiagnostic("dom_mutation", f"#{target_id}.{match.group('op')}({name})")
            )

        return changed, prevented

    def _contains_forbidden(self, source: str) -> list[str]:
        lowered = re.sub(r"\s+", "", source.lower())
        return [token for token in self.FORBIDDEN_TOKENS if token.replace(" ", "") in lowered]

    def bootstrap(self) -> ScriptRunResult:
        for script in self._scripts:
            if script == "__EXTERNAL_SCRIPT__":
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic("unsupported", "external script src")
                )
                continue

            forbidden = self._contains_forbidden(script)
            if forbidden:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        "forbidden API: " + ", ".join(sorted(set(forbidden))),
                    )
                )

            self._bind_nodes(script)
            self._register_handlers(script)
            changed, _ = self._execute_dom_statements(script)
            if changed:
                self.diagnostics.append(
                    ScriptDiagnostic("bootstrap", "safe DOM mutations applied")
                )

            stripped = re.sub(
                r"//[^\n]*|/\*.*?\*/",
                "",
                script,
                flags=re.DOTALL,
            )
            stripped = re.sub(
                r"\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*"
                r"(?:document\.getElementById\([^;]+\)|document\.querySelector\([^;]+\))\s*;?",
                "",
                stripped,
            )
            stripped = re.sub(
                r"[^;{}]+\.addEventListener\([^;]+\{.*?\}\s*\)?\s*;?",
                "",
                stripped,
                flags=re.DOTALL,
            )
            stripped = re.sub(
                rf"(?:(?:[A-Za-z_$][\w$]*|this|document\.[^;]+)"
                rf"\.(?:innerHTML|textContent|innerText|value|hidden)\s*=\s*(?:{_STRING_RE}|true|false)\s*;?)",
                "",
                stripped,
                flags=re.DOTALL,
            )
            if stripped.strip() and not forbidden:
                # We do not reject a page merely because extra JS exists; we
                # mark it so the agent can decide whether enough DOM was
                # produced to continue safely.
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic("unsupported", "unparsed script statements remain")
                )

        return ScriptRunResult(
            html=self.root.serialize(),
            diagnostics=list(self.diagnostics),
            handlers=list(self.handlers),
            unsupported=self.unsupported,
        )

    def handle_event(self, target_id: str, event: str) -> tuple[str, bool, list[ScriptDiagnostic]] | None:
        matching = [
            handler
            for handler in self.handlers
            if handler.target_id == target_id and handler.event == event.lower()
        ]
        if not matching:
            return None

        prevented = False
        for handler in matching:
            forbidden = self._contains_forbidden(handler.body)
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
            changed, did_prevent = self._execute_dom_statements(
                handler.body,
                this_id=target_id,
                event_var=handler.event_var,
            )
            prevented = prevented or did_prevent
            if not changed and not did_prevent:
                self.unsupported = True
                self.diagnostics.append(
                    ScriptDiagnostic(
                        "unsupported",
                        f"no supported operations in #{target_id}:{event}",
                    )
                )

        return self.root.serialize(), prevented, list(self.diagnostics)
