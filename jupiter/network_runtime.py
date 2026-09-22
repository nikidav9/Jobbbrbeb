#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
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
    headers: dict[str, str] = field(default_factory=dict)
    meta_headers: dict[str, str] = field(default_factory=dict)


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
        raise NetworkProgramError("expected string literal")
    body = token[1:-1]
    body = body.replace(r"\n", "\n")
    body = body.replace(r"\r", "\r")
    body = body.replace(r"\t", "\t")
    body = body.replace(r"\\", "\")
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
        if char in {"'", '"', "`"}:
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
    raise NetworkProgramError("unterminated block")


def _condition_block(source: str, pattern: str) -> str:
    match = re.search(pattern, source, flags=re.DOTALL)
    if not match:
        return ""
    brace = source.find("{", match.end() - 1)
    if brace < 0:
        return ""
    body, _ = _extract_braced(source, brace)
    return body


def _parse_body(options: str) -> tuple[str, str | None]:
    json_form = re.search(
        r"""\bbody\s*:\s*JSON\.stringify\(\s*Object\.fromEntries\(\s*new\s+FormData\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)\s*\)""",
        options,
        flags=re.DOTALL,
    )
    if json_form:
        return "json_form", json_form.group(1)

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
        raise NetworkProgramError("unsupported request body")
    return "none", None


def _parse_headers(options: str) -> tuple[dict[str, str], dict[str, str]]:
    literals: dict[str, str] = {}
    meta_headers: dict[str, str] = {}
    marker = re.search(r"\bheaders\s*:\s*\{", options)
    if not marker:
        return literals, meta_headers

    brace = options.find("{", marker.start())
    block, _ = _extract_braced(options, brace)

    entry = re.compile(
        rf"""(?P<key>{_STRING})\s*:\s*(?P<value>{_STRING}|document\.querySelector\(\s*["']meta\[name=(?:\\?["'])?(?P<meta>[A-Za-z0-9_:-]+)(?:\\?["'])?\]["']\s*\)\.content)""",
        flags=re.DOTALL,
    )
    consumed: list[tuple[int, int]] = []
    for match in entry.finditer(block):
        key = _decode_string(match.group("key"))
        raw = match.group("value").strip()
        if raw.startswith(("'", '"')):
            literals[key] = _decode_string(raw)
        else:
            meta_headers[key] = match.group("meta")
        consumed.append(match.span())

    remainder = block
    for start, end in reversed(consumed):
        remainder = remainder[:start] + remainder[end:]
    if remainder.replace(",", "").strip():
        raise NetworkProgramError("unsupported headers expression")

    return literals, meta_headers


def _fetch_call(source: str) -> tuple[str, str, str, int] | None:
    match = re.search(
        rf"""\b(?:const|let|var)\s+(?P<response>[A-Za-z_$][\w$]*)\s*=\s*await\s+fetch\(\s*(?P<url>{_STRING})""",
        source,
        flags=re.DOTALL,
    )
    if not match:
        return None

    index = match.end()
    while index < len(source) and source[index].isspace():
        index += 1
    options = ""
    if index < len(source) and source[index] == ",":
        index += 1
        while index < len(source) and source[index].isspace():
            index += 1
        if index >= len(source) or source[index] != "{":
            raise NetworkProgramError("fetch options must be an object literal")
        options, end = _extract_braced(source, index)
        index = end
    while index < len(source) and source[index].isspace():
        index += 1
    if index >= len(source) or source[index] != ")":
        raise NetworkProgramError("unsupported fetch call")
    return match.group("response"), match.group("url"), options, index + 1


def _parse_fetch(
    source: str,
) -> tuple[NetworkRequest, str, str, str | None] | None:
    call = _fetch_call(source)
    if call is None:
        return None
    response_name, raw_url, options, _end = call

    method_match = re.search(
        rf"""\bmethod\s*:\s*(?P<method>{_STRING})""",
        options,
        flags=re.DOTALL,
    )
    method = (
        _decode_string(method_match.group("method")).upper()
        if method_match else "GET"
    )
    if method not in {"GET", "POST"}:
        raise NetworkProgramError(f"unsupported fetch method: {method}")

    body_mode, form_ref = _parse_body(options)
    headers, meta_headers = _parse_headers(options)
    request = NetworkRequest(
        url=_decode_string(raw_url),
        method=method,
        body_mode=body_mode,
        form_ref=form_ref,
        api="fetch",
        headers=headers,
        meta_headers=meta_headers,
    )

    response_var = re.escape(response_name)
    success = _condition_block(
        source,
        rf"""\bif\s*\(\s*{response_var}\.ok\s*\)\s*\{{""",
    )
    failure = _condition_block(
        source,
        rf"""\bif\s*\(\s*!\s*{response_var}\.ok\s*\)\s*\{{""",
    )

    json_condition: str | None = None
    json_match = re.search(
        rf"""\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+{response_var}\.json\(\s*\)\s*;?""",
        source,
        flags=re.DOTALL,
    )
    if json_match:
        data_var = re.escape(json_match.group(1))
        cond = re.search(
            rf"""\bif\s*\(\s*{data_var}\.([A-Za-z_$][\w$]*)\s*\)\s*\{{""",
            source,
            flags=re.DOTALL,
        )
        if cond:
            json_condition = cond.group(1)
            success = _condition_block(
                source,
                rf"""\bif\s*\(\s*{data_var}\.{re.escape(json_condition)}\s*\)\s*\{{""",
            )

    return request, success, failure, json_condition


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
        raise NetworkProgramError("XMLHttpRequest.open requires literal method/url")
    method = _decode_string(opened.group("method")).upper()
    if method not in {"GET", "POST"}:
        raise NetworkProgramError(f"unsupported XMLHttpRequest method: {method}")

    send_form = re.search(
        rf"""\b{var}\.send\(\s*new\s+FormData\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)""",
        source,
        flags=re.DOTALL,
    )
    send_empty = re.search(rf"""\b{var}\.send\(\s*\)""", source)
    if send_form:
        body_mode, form_ref = "formdata", send_form.group(1)
    elif send_empty:
        body_mode, form_ref = "none", None
    else:
        raise NetworkProgramError("unsupported XMLHttpRequest body")

    onload = re.search(
        rf"""\b{var}\.onload\s*=\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{{""",
        source,
        flags=re.DOTALL,
    )
    success = ""
    if onload:
        brace = source.find("{", onload.end() - 1)
        success, _ = _extract_braced(source, brace)

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
        request, success, failure, json_condition = parsed_fetch
        response = fetcher(request)
        dom_source = success if response.ok else failure

        if response.ok and json_condition:
            try:
                payload = json.loads(response.text)
            except json.JSONDecodeError as exc:
                raise NetworkProgramError("response.json() received invalid JSON") from exc
            if not isinstance(payload, dict):
                raise NetworkProgramError("response.json() must return an object")
            dom_source = success if bool(payload.get(json_condition)) else failure

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
            "network script is outside Jupiter Network Runtime subset"
        )
    return None
