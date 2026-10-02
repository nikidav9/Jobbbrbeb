"""Отклик на карьерных сайтах Huntflow (*.huntflow.io) через их же API.

П.3 «адаптеры систем откликов» (01.10.2026): Huntflow — самая частая система
откликов у компаний ленты (32 источника сбора из ~180: Emex, MobileUp, KTS,
MST, iiko, Flowwow…), остальные встречаются единицами. Анкета у всех
компаний одна и та же, страница собирается скриптом (Nuxt), а сам скрипт шлёт:

- GET  /api/vacancy/{slug}           — карточка вакансии (id, архив);
- POST /api/vacancy/{id}/upload      — файл резюме (multipart, поле file) → id;
- POST /api/vacancy/{id}/response    — JSON {name, surname, phone, email,
  letter?, url?, file?, agreement: true}; 400 — {data: [{path, message}]},
  «Too Frequent Responses For a Vacancy» — уже откликались.

Повторяем ровно этот запрос, без чужого JavaScript. agreement — галочка
согласия на обработку ПДн работодателем: ставится только по поручению
человека (personal_data_consent, как у Сбера). Только stdlib.
"""
from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SUFFIX = ".huntflow.io"
MAX_RESUME_BYTES = 10 * 1024 * 1024
RESUME_TYPES = (".pdf", ".doc", ".docx", ".rtf", ".odt")
DUPLICATE_MESSAGE = "Too Frequent Responses For a Vacancy"
_VACANCY_PATH = re.compile(r"^/vacancy/([A-Za-z0-9_-]+)/?$")


@dataclass(frozen=True)
class HuntflowVacancy:
    origin: str  # https://company.huntflow.io
    slug: str


def parse_url(url: str) -> HuntflowVacancy | None:
    """Адрес вакансии на карьерном сайте Huntflow или None."""
    parts = urllib.parse.urlsplit(str(url or ""))
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host.endswith(SUFFIX) or host == SUFFIX[1:]:
        return None
    match = _VACANCY_PATH.match(parts.path)
    if not match:
        return None
    return HuntflowVacancy(f"https://{host}", match.group(1))


def missing_profile_fields(profile: Any) -> list[str]:
    values = getattr(profile, "values", {}) or {}
    return [key for key in ("first_name", "last_name", "phone", "email")
            if not str(values.get(key) or "").strip()]


def has_consent(profile: Any) -> bool:
    return (getattr(profile, "values", {}) or {}).get("personal_data_consent") is True


def phone_for_api(raw: Any) -> str:
    """Сайт склеивает код страны (+7) с номером из поля — отдаём так же."""
    digits = re.sub(r"\D+", "", str(raw or ""))
    if len(digits) == 11 and digits[0] in "78":
        return "+7" + digits[1:]
    if len(digits) == 10:
        return "+7" + digits
    return str(raw or "").strip()


def resume_file(profile: Any) -> Path | None:
    """Резюме, которое сайт примет: свой тип файла и не больше 10 МБ."""
    raw = getattr(profile, "resume_path", None)
    if not raw:
        return None
    path = Path(str(raw))
    try:
        ok = path.is_file() and path.suffix.lower() in RESUME_TYPES \
            and path.stat().st_size <= MAX_RESUME_BYTES
    except OSError:
        return None
    return path if ok else None


def build_payload(profile: Any, file_id: int | None) -> dict[str, Any]:
    values = getattr(profile, "values", {}) or {}
    payload: dict[str, Any] = {
        "name": str(values.get("first_name") or "").strip()[:255],
        "surname": str(values.get("last_name") or "").strip()[:255],
        "phone": phone_for_api(values.get("phone")),
        "email": str(values.get("email") or "").strip()[:255],
        "agreement": True,
    }
    letter = str(values.get("cover_letter") or "").strip()
    if letter:
        payload["letter"] = letter[:10000]
    if file_id is not None:
        payload["file"] = file_id
    return payload


def vacancy_id(status: int, body: object) -> tuple[int | None, bool]:
    """(id, в архиве) из ответа карточки; id None — вакансии нет."""
    if status != 200 or not isinstance(body, dict):
        return None, False
    raw = body.get("id")
    if not isinstance(raw, int) or isinstance(raw, bool):
        return None, False
    return raw, bool(body.get("is_archived") or body.get("archived_at"))


def uploaded_file_id(status: int, body: object) -> int | None:
    if not 200 <= status < 300 or not isinstance(body, dict):
        return None
    raw = body.get("id")
    return raw if isinstance(raw, int) and not isinstance(raw, bool) else None


def interpret_response(status: int, body: object) -> tuple[str, str, list[str]]:
    """(итог, сообщение, поля): submitted | duplicate | needs_fix | rejected."""
    if 200 <= status < 300:
        return "submitted", "", []
    errors = body.get("data") if isinstance(body, dict) else None
    errors = [e for e in errors if isinstance(e, dict)] if isinstance(errors, list) else []
    messages = [str(e.get("message") or "")[:200] for e in errors]
    if DUPLICATE_MESSAGE in messages:
        return "duplicate", DUPLICATE_MESSAGE, []
    fields = [str(e.get("path") or "")[:40] for e in errors if e.get("path")]
    if status == 400 and fields:
        return "needs_fix", "; ".join(m for m in messages if m)[:300], fields
    message = messages[0] if messages and messages[0] else ""
    if not message and isinstance(body, dict):
        message = str(body.get("message") or body.get("statusMessage") or "")[:200]
    return "rejected", message or f"Huntflow API returned HTTP {status}", []
