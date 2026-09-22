#!/usr/bin/env python3
"""Что мы знаем о кандидате и на каком основании.

Разделение не бюрократия. Факт, предпочтение, сгенерированный текст и
согласие ведут себя по-разному, и смешивать их опасно в конкретную сторону:

- факт нельзя придумать: гражданство, право на работу, образование, права;
- предпочтение можно взять из настроек, но не из воздуха;
- текст можно сочинить, но только из настоящих фактов;
- согласие нельзя подразумевать. «Согласен на обработку персональных данных»
  не равно «хочу в кадровый резерв» и не равно «хочу рекламу».

Отсюда же provenance: по каждому отправленному значению должно быть видно,
откуда оно взялось. Иначе человеку нельзя объяснить, что именно отправили от
его имени.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


class FieldClass:
    FACT = "FACT"
    PREFERENCE = "PREFERENCE"
    GENERATED = "GENERATED"
    CONSENT = "CONSENT"
    LEGAL = "LEGAL"


class Source:
    PROFILE = "PROFILE"
    RESUME = "RESUME"
    USER_PREFERENCE = "USER_PREFERENCE"
    GENERATED = "GENERATED"
    SITE_DEFAULT = "SITE_DEFAULT"
    USER_CONFIRMATION = "USER_CONFIRMATION"


# Вопросы, ответ на которые нельзя вывести. Ошибка здесь — не опечатка в
# анкете, а ложное заявление от имени человека.
LEGAL_KEYS = {
    "citizenship", "work_authorization", "visa_sponsorship", "residence_permit",
    "driving_license", "has_car", "disability", "security_clearance",
    "criminal_record", "military_service", "medical_book",
}

PREFERENCE_KEYS = {
    "desired_salary", "desired_role", "employment", "work_format",
    "relocation", "remote", "schedule", "notice_period", "start_date",
}

GENERATED_KEYS = {"cover_letter", "about", "motivation_text"}


@dataclass(frozen=True)
class ConsentKind:
    key: str
    required_by_law: bool
    patterns: tuple[str, ...]


# Порядок важен: маркетинг и кадровый резерв проверяются раньше, потому что
# их формулировки часто содержат слово «персональных данных» внутри.
CONSENT_KINDS: tuple[ConsentKind, ...] = (
    ConsentKind("marketing_consent", False, (
        "реклам", "маркетинг", "рассылк", "новост", "акци",
        "marketing", "newsletter", "promotion", "advertis",
    )),
    ConsentKind("talent_pool_consent", False, (
        "кадровый резерв", "базу кандидат", "базе кандидат", "базу соискател",
        "будущих вакансi", "будущих вакансий", "другие вакансии",
        "talent pool", "candidate database", "future vacancies",
        "future opportunities",
    )),
    ConsentKind("third_party_consent", False, (
        "третьим лицам", "третьи лица", "партнёрам", "партнерам",
        "third part", "affiliates",
    )),
    ConsentKind("personal_data_consent", True, (
        "обработк персональн", "персональных данных", "персональными данными",
        "обработку данных", "personal data", "processing of personal",
    )),
    ConsentKind("privacy_consent", True, (
        "политик конфиденциальност", "пользовательск соглашен", "условия",
        "privacy policy", "terms", "user agreement", "оферт",
    )),
)

_WORD_RE = re.compile(r"[^0-9a-zа-яё]+", re.IGNORECASE)


def _flat(text: str) -> str:
    return _WORD_RE.sub(" ", (text or "").lower()).strip()


def classify_key(key: str) -> str:
    if key in LEGAL_KEYS:
        return FieldClass.LEGAL
    if key in GENERATED_KEYS:
        return FieldClass.GENERATED
    if key in PREFERENCE_KEYS:
        return FieldClass.PREFERENCE
    if key.endswith("_consent") or key == "consent":
        return FieldClass.CONSENT
    return FieldClass.FACT


def consent_kinds(text: str) -> list[ConsentKind]:
    """Какие согласия просит эта галочка. Их может оказаться несколько."""
    flat = _flat(text)
    found: list[ConsentKind] = []
    for kind in CONSENT_KINDS:
        if any(_flat(pattern) in flat for pattern in kind.patterns):
            found.append(kind)
    return found


@dataclass
class ConsentDecision:
    """Что делать с галочкой: check / skip / ask."""

    action: str
    kinds: list[str]
    reason: str


def decide_consent(text: str, values: dict) -> ConsentDecision:
    """Ставить ли галочку согласия.

    Правило простое и намеренно осторожное: ставим, только если человек дал
    именно это согласие. Смешанную галочку («данные + реклама» одним
    чекбоксом) не ставим сами никогда — это его решение, не наше.
    """
    kinds = consent_kinds(text)
    if not kinds:
        return ConsentDecision("skip", [], "not recognised as a consent")

    names = [kind.key for kind in kinds]
    optional = [kind for kind in kinds if not kind.required_by_law]
    lawful = [kind for kind in kinds if kind.required_by_law]

    if optional and lawful:
        return ConsentDecision(
            "ask", names,
            "one checkbox mixes a required consent with an optional one",
        )

    if optional:
        granted = [
            kind.key for kind in optional
            if values.get(kind.key) is True
        ]
        if len(granted) == len(optional):
            return ConsentDecision("check", names, "granted explicitly")
        return ConsentDecision(
            "skip", names,
            "optional consent was not granted by the candidate",
        )

    # Обязательное согласие: без него отклик не отправить вовсе.
    granted = all(
        values.get(kind.key) is True or values.get("consent") is True
        for kind in lawful
    )
    if granted:
        return ConsentDecision("check", names, "granted explicitly")
    return ConsentDecision(
        "ask", names, "required consent is not recorded in the profile"
    )


def provenance_for(key: str, values: dict) -> dict[str, str]:
    """Откуда взялось значение — в терминах, понятных человеку."""
    field_class = classify_key(key)
    source = {
        FieldClass.PREFERENCE: Source.USER_PREFERENCE,
        FieldClass.GENERATED: Source.GENERATED,
        FieldClass.CONSENT: Source.USER_CONFIRMATION,
    }.get(field_class, Source.PROFILE)
    if key in values and field_class in {FieldClass.FACT, FieldClass.LEGAL}:
        source = Source.PROFILE
    return {"field_class": field_class, "source": source}
