#!/usr/bin/env python3
"""Доказательства отправки и защита от повторной подачи.

Две вещи, без которых нельзя включать настоящую отправку.

Первая: нажатие — не успех. И HTTP 200 — не успех. Работодатель мог вернуть
ту же форму с ошибкой, и страница при этом честно отдаст двести. Поэтому
статус submitted ставится не по факту запроса, а по собранным доказательствам
с весами.

Вторая: один отклик — один раз. Повторная подача одному работодателю хуже
любой несовместимости: она видна человеку на той стороне и выглядит как спам.
Отпечаток отклика считается до отправки, и уже отправленное не отправляется
снова — даже если адрес отличается рекламными метками.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Порог, выше которого отклик считается поданным. Подобран так, что ни одно
# доказательство в одиночку, кроме сильных, его не берёт.
CONFIRM_THRESHOLD = 0.8

# Метки рекламных кампаний. Один и тот же отклик, пришедший из рассылки и из
# ленты, обязан считаться одним и тем же.
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_referrer", "gclid", "yclid", "fbclid", "ysclid", "_openstat",
    "from", "ref", "referrer", "source",
}

_CONFIRM_PATH_RE = re.compile(
    r"/(thank[-_]?you|thanks|success|spasibo|confirm(ation)?|applied|sent|done)"
    r"(?:/|$|\?)",
    re.IGNORECASE,
)
_CONFIRM_QUERY_RE = re.compile(
    r"\b(applied|success|submitted|sent)=(1|true|yes|ok)\b",
    re.IGNORECASE,
)

_APPLICATION_ID_RE = re.compile(
    r"(?:"
    r"номер\s+(?:заявки|отклика|обращения)|"
    r"заявк\w*\s*№|"
    r"application\s+(?:id|number|reference)|"
    r"reference\s+number"
    r")\s*[:#№]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,31})",
    re.IGNORECASE,
)

_JSON_TRUE_KEYS = ("accepted", "success", "ok", "submitted", "created")

# Маркеры успеха регулярками (02.10.2026): подстроки не находили «Заявка
# успешно отправлена», «Спасибо! Данные успешно отправлены» (Tilda), «Резюме
# успешно отправлено». Применяются к нормализованному тексту (нижний регистр,
# без знаков препинания) — см. normalize_text. «Не было до отправки» работает
# так же, как у подстрок: учитываются только совпадения, которых до клика не
# было.
_SUBJECT = r"(?:отклик|заявк|резюме|анкет|данные|обращени)\w*"
# Слова между подлежащим и глаголом не должны делать фразу условной:
# «заявка будет отправлена» — обещание, а не подтверждение.
_FILLER = (r"(?:(?!(?:будет|будут|не|бы|можно|нужно|надо|чтобы|если|после|перед|как|"
           r"когда|можете|может|должна|должен)\b)\w+\s+)")
_SENT = r"(?:отправлен|принят|получен|доставлен)\w*"
# Продолжения, которые обращают фразу в не-подтверждение: «данные отправлены
# с ошибкой», «отправлено на ваш номер», «отправлено… код». \b нужен, чтобы
# откат \w* к середине слова не обходил запрет.
_NOT_AFTER = r"\b(?!\s+(?:с\s+ошибк|на\s+ваш|номер|код))"
SUCCESS_PATTERNS: tuple[str, ...] = (
    rf"\b{_SUBJECT}\s+{_FILLER}{{0,2}}(?:успешно\s+)?{_SENT}{_NOT_AFTER}",
    r"\bспасибо\s+(?:за\s+)?(?:ваш\w*\s+)?(?:отклик|заявк|резюме|анкет|обращени)",
    r"\bвы\s+уже\s+(?:откликнулись|отправляли|подавали\s+заявку)",
    r"\b(?:your\s+)?application\s+(?:has\s+been\s+|was\s+)?(?:successfully\s+)?(?:received|submitted|sent)",
    r"\bthank\s+you\s+for\s+(?:applying|your\s+(?:application|submission))",
)
_SUCCESS_RES = tuple(re.compile(p) for p in SUCCESS_PATTERNS)


def normalize_text(value: str | None) -> str:
    """Та же нормализация, что agent.normalize (нижний регистр, без знаков)."""
    if not value:
        return ""
    value = value.lower().replace("_", " ").replace("-", " ")
    value = re.sub(r"[^0-9a-zа-яё+./\[\] ]+", " ", value, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", value).strip()


def find_success_phrase(norm_text: str, norm_before: str = "") -> str:
    """Первая фраза-подтверждение в нормализованном тексте, которой не было
    до отправки. Пусто — нет."""
    for rx in _SUCCESS_RES:
        for match in rx.finditer(norm_text):
            phrase = match.group(0)
            if phrase not in norm_before:
                return phrase
    return ""


@dataclass
class SubmissionEvidence:
    """Одно доказательство. confidence=0 — не доказательство, а запись в журнал."""

    type: str
    value: str
    confidence: float
    source_url: str
    timestamp: float = field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "value": self.value[:300],
            "confidence": round(self.confidence, 2),
            "source_url": self.source_url,
            "timestamp": self.timestamp,
        }


def canonical_url(url: str) -> str:
    """Адрес без рекламных меток, якоря и регистра хоста."""
    parsed = urllib.parse.urlsplit((url or "").strip())
    query = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in _TRACKING_PARAMS
    ]
    query.sort()
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunsplit((
        parsed.scheme.lower(),
        (parsed.netloc or "").lower(),
        path,
        urllib.parse.urlencode(query, doseq=True),
        "",
    ))


def form_signature(control_names: list[str], action: str) -> str:
    names = ",".join(sorted(name for name in control_names if name))
    return f"{canonical_url(action)}|{names}"


@dataclass(frozen=True)
class ApplicationFingerprint:
    candidate_id: str
    employer: str
    vacancy_url: str
    apply_url: str
    form_signature: str

    @classmethod
    def build(
        cls,
        *,
        candidate_id: str,
        vacancy_url: str,
        apply_url: str,
        control_names: list[str],
        action: str,
    ) -> "ApplicationFingerprint":
        employer = (urllib.parse.urlsplit(vacancy_url).hostname or "").lower()
        return cls(
            candidate_id=candidate_id.strip().lower(),
            employer=employer,
            vacancy_url=canonical_url(vacancy_url),
            apply_url=canonical_url(apply_url),
            form_signature=form_signature(control_names, action),
        )

    def key(self) -> str:
        raw = "|".join([
            self.candidate_id, self.employer, self.vacancy_url,
            self.apply_url, self.form_signature,
        ])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def as_dict(self) -> dict[str, str]:
        return {
            "key": self.key(),
            "candidate_id": self.candidate_id,
            "employer": self.employer,
            "vacancy_url": self.vacancy_url,
            "apply_url": self.apply_url,
            "form_signature": self.form_signature,
        }


@dataclass
class Receipt:
    key: str
    status: str                       # submitted | submission_unknown
    apply_url: str
    submitted_at: float = field(default_factory=time.time)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    external_application_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "status": self.status,
            "apply_url": self.apply_url,
            "submitted_at": self.submitted_at,
            "evidence": self.evidence,
            "external_application_id": self.external_application_id,
        }


class ReceiptStore:
    """Журнал поданных откликов.

    Файл, а не база: у Jupiter ещё нет своего хранилища, а решение о том,
    куда это переедет, принимается вместе с моделью application. Интерфейс
    здесь нарочно узкий, чтобы переезд был заменой класса.
    """

    def __init__(self, path: str | None = None):
        self.path = Path(path) if path else None
        self._items: dict[str, Receipt] = {}
        if self.path and self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = {}
            for key, item in (raw or {}).items():
                if isinstance(item, dict):
                    self._items[key] = Receipt(
                        key=key,
                        status=str(item.get("status", "")),
                        apply_url=str(item.get("apply_url", "")),
                        submitted_at=float(item.get("submitted_at", 0) or 0),
                        evidence=list(item.get("evidence", [])),
                        external_application_id=item.get("external_application_id"),
                    )

    def find(self, key: str) -> Receipt | None:
        return self._items.get(key)

    def record(self, receipt: Receipt) -> None:
        self._items[receipt.key] = receipt
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(
                    {k: v.as_dict() for k, v in self._items.items()},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        except OSError:
            # Журнал не записался — но в памяти отметка есть, и в этом прогоне
            # повтора не будет. Ронять из-за диска уже отправленный отклик
            # было бы хуже.
            pass


def _maybe_json(text: str) -> Any | None:
    stripped = (text or "").strip()
    if not stripped.startswith(("{", "[")):
        return None
    try:
        return json.loads(stripped)
    except ValueError:
        return None


def collect_evidence(
    *,
    before_url: str,
    before_text: str,
    after_url: str,
    after_text: str,
    after_status: int,
    success_markers: tuple[str, ...],
    form_gone: bool,
    normalize,
    success_patterns: bool = False,
) -> list[SubmissionEvidence]:
    """Собрать доказательства того, что отклик действительно принят.

    success_patterns=True — дополнительно искать SUCCESS_PATTERNS (регулярки).
    """
    evidence: list[SubmissionEvidence] = []
    before_norm = normalize(before_text)
    after_norm = normalize(after_text)

    # HTTP-ответ записываем, но веса не даём. Двести — это «сервер ответил»,
    # а не «заявку приняли»: та же форма с ошибкой отдаёт ровно столько же.
    evidence.append(SubmissionEvidence(
        "HTTP_RESPONSE", str(after_status), 0.0, after_url,
    ))

    for marker in success_markers:
        if marker in after_norm and marker not in before_norm:
            # Ключевое здесь — «и не было до отправки». Сайт, у которого
            # «спасибо за отклик» висит в подвале на каждой странице, иначе
            # подтверждал бы что угодно.
            evidence.append(SubmissionEvidence("DOM_TEXT", marker, 0.8, after_url))
            break
    else:
        phrase = find_success_phrase(after_norm, before_norm) if success_patterns else ""
        if phrase:
            evidence.append(SubmissionEvidence("DOM_TEXT", phrase[:120], 0.8, after_url))

    match = _APPLICATION_ID_RE.search(after_text or "")
    if match:
        evidence.append(SubmissionEvidence(
            "APPLICATION_ID", match.group(1), 0.9, after_url,
        ))

    if canonical_url(after_url) != canonical_url(before_url) and (
        _CONFIRM_PATH_RE.search(after_url) or _CONFIRM_QUERY_RE.search(after_url)
    ):
        evidence.append(SubmissionEvidence("URL", after_url, 0.75, after_url))

    payload = _maybe_json(after_text)
    if isinstance(payload, dict):
        for key in _JSON_TRUE_KEYS:
            if payload.get(key) is True:
                evidence.append(SubmissionEvidence(
                    "JSON", f"{key}=true", 0.85, after_url,
                ))
                break
        for key in ("application_id", "applicationId", "id", "reference"):
            value = payload.get(key)
            if isinstance(value, (str, int)) and str(value).strip():
                evidence.append(SubmissionEvidence(
                    "APPLICATION_ID", str(value), 0.9, after_url,
                ))
                break

    if form_gone:
        # Само по себе исчезновение формы ничего не доказывает: её убирает и
        # редирект на страницу входа. Только в связке с чем-то ещё.
        evidence.append(SubmissionEvidence("FORM_GONE", "target form", 0.35, after_url))

    return evidence


def score_evidence(evidence: list[SubmissionEvidence]) -> float:
    """Вес самого сильного доказательства плюс надбавка за подтверждение."""
    # Отказ API страницы перевешивает любой текст: «спасибо» может висеть на
    # экране, пока сервер ответил «телефон неверный».
    if any(item.type == "API_ERROR" for item in evidence):
        return 0.0
    positives = [item.confidence for item in evidence if item.confidence > 0]
    if not positives:
        return 0.0
    # round: 0.7 + 0.1 в плавающей точке даёт 0.7999999999999999 и не дотягивает
    # до порога 0.8.
    return round(min(1.0, max(positives) + 0.1 * (len(positives) - 1)), 6)


def is_confirmed(evidence: list[SubmissionEvidence]) -> bool:
    return score_evidence(evidence) >= CONFIRM_THRESHOLD
