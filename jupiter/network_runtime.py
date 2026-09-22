#!/usr/bin/env python3
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable


_STRING = r"""(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")"""


class NetworkProgramError(RuntimeError):
    pass


@dataclass
class NetworkRequest:
    url: str
    method: str = "GET"
    body_mode: str = "none"
    form_ref: str | None = None
    api: str = "fetch"


@dataclass
class NetworkResponse:
    status: int
    url: str
    text: str
    headers: dict[str, str]

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


@dataclass
class NetworkExecution:
    request: NetworkRequest
    response: NetworkResponse
    dom_source: str
    api: str


def _decode_string(token: str) -> str:
    token = token.strip()
    if len(token) < 2 or token[0] not in {"'", '"'} or token[-1] != token[0]:
        raise NetworkProgramError("network URL/method must be a string literal")
    body = token[1:-1]
    body = body.replace(r"\n", "\n")
    body = body.replace(r"\r", "\r")
    body = body.replace(r"\t", "\t")
    body = body.replace(r"\\", "\\")
    body = body.replace(r"\'", "'")
    body = body.replace(r'\"', '"')
    return body


def _extract_braced(source: str, brace_index: int) -> tuple[str, int]:
    if brace_index >= len(source) or source[brace_index] != "{":
        raise NetworkProgramError("expected block")

    depth = 1
    quote: str | None = None
    escaped = False
    index = brace_index + 1

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

        if char in {"'", '"', chr(96)}:
            quote = char
            index += 1
            continue

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[brace_index + 1:index], index + 1

        index += 1

    raise NetworkProgramError("unterminated script block")


def _condition_block(source: str, condition_pattern: str) -> str:
    match = re.search(condition_pattern, source, flags=re.DOTALL)
    if not match:
        return ""
    brace = source.find("{", match.end() - 1)
    if brace < 0:
        return ""
    body, _end = _extract_braced(source, brace)
    return body


def _form_body(options: str) -> tuple[str, str | None]:
    encoded = re.search(
        r"""\bbody\s*:\s*new\s+URLSearchParams\(\s*new\s+FormData\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)""",
        options,
        flags=re.DOTALL,
    )
    if encoded:
        return "urlencoded", encoded.group(1)

    formdata = re.search(
        r"""\bbody\s*:\s*new\s+FormData\(\s*([A-Za-z_$][\w$]*)\s*\)""",
        options,
        flags=re.DOTALL,
    )
    if formdata:
        return "formdata", formdata.group(1)

    if re.search(r"\bbody\s*:", options):
        raise NetworkProgramError(
            "only FormData(form) or URLSearchParams(new FormData(form)) bodies are supported"
        )

    return "none", None


def _parse_fetch(source: str) -> tuple[NetworkRequest, str, str] | None:
    match = re.search(
        rf"""\b(?:const|let|var)\s+(?P<response>[A-Za-z_$][\w$]*)\s*=\s*await\s+fetch\(\s*(?P<url>{_STRING})\s*(?:,\s*\{{(?P<options>.*?)\}}\s*)?\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    if not match:
        return None

    options = match.group("options") or ""
    method_match = re.search(
        rf"""\bmethod\s*:\s*(?P<method>{_STRING})""",
        options,
        flags=re.DOTALL,
    )
    method = (
        _decode_string(method_match.group("method")).upper()
        if method_match
        else "GET"
    )
    if method not in {"GET", "POST"}:
        raise NetworkProgramError(f"unsupported fetch method: {method}")

    body_mode, form_ref = _form_body(options)
    request = NetworkRequest(
        url=_decode_string(match.group("url")),
        method=method,
        body_mode=body_mode,
        form_ref=form_ref,
        api="fetch",
    )

    response_var = re.escape(match.group("response"))
    success = _condition_block(
        source,
        rf"""\bif\s*\(\s*{response_var}\.ok\s*\)\s*\{{""",
    )
    failure = _condition_block(
        source,
        rf"""\bif\s*\(\s*!\s*{response_var}\.ok\s*\)\s*\{{""",
    )
    return request, success, failure


def _parse_xhr(source: str) -> tuple[NetworkRequest, str] | None:
    ctor = re.search(
        r"""\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+XMLHttpRequest\(\s*\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    if not ctor:
        return None

    var = re.escape(ctor.group(1))
    opened = re.search(
        rf"""\b{var}\.open\(\s*(?P<method>{_STRING})\s*,\s*(?P<url>{_STRING})\s*\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    if not opened:
        raise NetworkProgramError("XMLHttpRequest.open must use literal method and URL")

    method = _decode_string(opened.group("method")).upper()
    if method not in {"GET", "POST"}:
        raise NetworkProgramError(
            f"unsupported XMLHttpRequest method: {method}"
        )

    send_form = re.search(
        rf"""\b{var}\.send\(\s*new\s+FormData\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    send_empty = re.search(
        rf"""\b{var}\.send\(\s*\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    if send_form:
        body_mode = "formdata"
        form_ref = send_form.group(1)
    elif send_empty:
        body_mode = "none"
        form_ref = None
    else:
        raise NetworkProgramError(
            "XMLHttpRequest.send supports only empty body or FormData(form)"
        )

    onload = re.search(
        rf"""\b{var}\.onload\s*=\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{""",
        source,
        flags=re.DOTALL,
    )
    success = ""
    if onload:
        brace = source.find("{", onload.end() - 1)
        success, _end = _extract_braced(source, brace)

    return (
        NetworkRequest(
            url=_decode_string(opened.group("url")),
            method=method,
            body_mode=body_mode,
            form_ref=form_ref,
            api="xhr",
        ),
        success,
    )


def contains_network_api(source: str) -> bool:
    lowered = source.lower()
    return "fetch(" in lowered or "xmlhttprequest" in lowered


def execute_network_program(
    source: str,
    fetcher: Callable[[NetworkRequest], NetworkResponse],
) -> NetworkExecution | None:
    parsed_fetch = _parse_fetch(source)
    if parsed_fetch is not None:
        request, success, failure = parsed_fetch
        response = fetcher(request)
        dom_source = success if response.ok else failure
        return NetworkExecution(
            request=request,
            response=response,
            dom_source=dom_source,
            api="fetch",
        )

    parsed_xhr = _parse_xhr(source)
    if parsed_xhr is not None:
        request, onload = parsed_xhr
        response = fetcher(request)
        return NetworkExecution(
            request=request,
            response=response,
            dom_source=onload if response.ok else "",
            api="xhr",
        )

    if contains_network_api(source):
        raise NetworkProgramError(
            "network script is outside Jupiter Network Runtime v1 subset"
        )

    return None
