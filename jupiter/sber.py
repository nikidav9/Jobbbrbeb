#!/usr/bin/env python3
"""Sber application adapter for the public API used by rabota.sber.ru itself.

Sber renders its application form client-side, so the generic HTML engine does
not see a normal <form action=...>. The site's own JavaScript posts JSON to the
public candidate API. We reproduce that documented-on-the-page request without
executing arbitrary JavaScript or adding a browser runtime.
"""
from __future__ import annotations

import base64
import html
import json
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SBER_HOST = "rabota.sber.ru"
SBER_TERMS_URL = "https://rabota.sber.ru/terms"
SBER_APPLICATION_URL = (
    "https://rabota.sber.ru/"
    "public/app-candidate-public-api-gateway/api/v1/application"
)
MAX_RESUME_BYTES = 10 * 1024 * 1024

_NEXT_DATA = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True)
class SberVacancy:
    requisition_id: str
    publication_id: str


def is_sber_page(url: str) -> bool:
    return (urllib.parse.urlsplit(url).hostname or "").lower() == SBER_HOST


def extract_vacancy(page: Any) -> SberVacancy | None:
    """Read the two identifiers that Sber passes to its application widget."""
    if not is_sber_page(str(getattr(page, "url", ""))):
        return None
    source = str(getattr(page, "html", ""))
    match = _NEXT_DATA.search(source)
    if not match:
        return None
    raw = match.group(1)
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        # Some proxies HTML-escape inline JSON; only unescape as a fallback.
        # Doing it before the first parse can turn &quot; inside a JSON string
        # into an unescaped quote and corrupt otherwise valid __NEXT_DATA__.
        try:
            data = json.loads(html.unescape(raw))
        except (ValueError, TypeError):
            return None
    vacancy = (
        data.get("props", {})
        .get("pageProps", {})
        .get("vacancy", {})
    )
    if not isinstance(vacancy, dict):
        return None
    requisition_id = str(vacancy.get("requisitionId") or "").strip()
    publication_id = str(vacancy.get("publicationId") or "").strip()
    if not requisition_id or not publication_id:
        return None
    return SberVacancy(requisition_id, publication_id)


def missing_profile_fields(profile: Any) -> list[str]:
    values = getattr(profile, "values", {}) or {}
    missing: list[str] = []
    for key in ("last_name", "first_name", "email", "phone"):
        if not str(values.get(key) or "").strip():
            missing.append(key)
    path = getattr(profile, "resume_path", None)
    if not path or not Path(path).is_file():
        missing.append("resume")
    return missing


def has_personal_data_consent(profile: Any) -> bool:
    values = getattr(profile, "values", {}) or {}
    return values.get("personal_data_consent") is True


def _phone_for_api(raw: Any) -> str:
    digits = re.sub(r"\D+", "", str(raw or ""))
    if len(digits) == 10:
        return "8" + digits
    if len(digits) == 11 and digits[0] in {"7", "8"}:
        return "8" + digits[1:]
    return digits


def build_payload(page: Any, profile: Any, vacancy: SberVacancy) -> dict[str, str]:
    values = getattr(profile, "values", {}) or {}
    resume_path = Path(str(getattr(profile, "resume_path", "")))
    raw = resume_path.read_bytes()
    if not raw.startswith(b"%PDF"):
        raise ValueError("Selected resume is not a PDF")
    if len(raw) > MAX_RESUME_BYTES:
        raise ValueError("Selected resume is larger than Sber's 10 MB limit")
    encoded = base64.b64encode(raw).decode("ascii")
    return {
        "platform": "pulse",
        "vacancyId": vacancy.requisition_id,
        "publicationId": vacancy.publication_id,
        "lastName": str(values.get("last_name") or "").strip(),
        "firstName": str(values.get("first_name") or "").strip(),
        "mail": str(values.get("email") or "").strip(),
        "base64": "data:application/pdf;base64," + encoded,
        "phone": _phone_for_api(values.get("phone")),
        "locationUrl": str(getattr(page, "url", "")),
        # Sber fills this from saved UTM values in localStorage. Jupiter has no
        # browser localStorage, so an empty analytics field is the faithful value.
        "locationSearch": "",
    }


def interpret_response(status: int, body: object) -> tuple[str, str | None, object]:
    if isinstance(body, dict) and body.get("success") is True and 200 <= status < 300:
        return "submitted", None, body
    message = None
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip() or None
        elif error:
            message = str(error)
    if message == "Candidate has already applied for the job requisition":
        return "duplicate", message, body
    return "rejected", message or f"Sber API returned HTTP {status}", body


def submit_payload(engine: Any, page: Any, payload: dict[str, str]) -> tuple[str, str | None, object]:
    status, body = engine.request_json(
        SBER_APPLICATION_URL,
        method="POST",
        payload=payload,
        headers={
            "Origin": "https://rabota.sber.ru",
            "Referer": str(getattr(page, "url", "")),
        },
    )
    return interpret_response(status, body)


def submit(engine: Any, page: Any, profile: Any) -> tuple[str, str | None, object]:
    """Submit through Sber's public application endpoint."""
    vacancy = extract_vacancy(page)
    if vacancy is None:
        return "rejected", "Sber vacancy identifiers were not found", {}
    return submit_payload(engine, page, build_payload(page, profile, vacancy))
